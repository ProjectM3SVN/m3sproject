#!/usr/bin/env bash
# ==============================================================================
# Project M3S: Master Archival Daemon
# Script: /mnt/hdd/m3s_archive/scripts/run_archival_daemon.sh
# Objective:
#   - Continuous background runner executing packager and cloud uploader
#   - Runs packaging cycle every 30 minutes
#   - Runs upload cycle every 60 minutes
#   - Monitors disk usage on /mnt/hdd/ to ensure headroom > 50GB
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/archival.conf"

if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${CONFIG_FILE}"
else
  echo "[ERROR] Config file not found at: ${CONFIG_FILE}" >&2
  exit 1
fi

LOG_FILE="${LOG_DIR}/daemon_$(date +'%Y-%m-%d').log"

log() {
  local level="$1"
  shift
  local msg="$*"
  local timestamp
  timestamp="$(date +'%Y-%m-%d %H:%M:%S')"
  echo "[${timestamp}] [${level}] ${msg}" | tee -a "${LOG_FILE}"
}

# Apply idle scheduling
if command -v ionice >/dev/null 2>&1; then
  ionice -c "${IO_NICE_CLASS:-3}" -p $$ 2>/dev/null || true
fi
renice -n "${CPU_NICE_LEVEL:-19}" -p $$ >/dev/null 2>&1 || true

log "INFO" "========================================================"
log "INFO" "Project M3S: Master Archival Daemon Started."
log "INFO" "Monitoring: ${WATCH_DIR}"
log "INFO" "========================================================"

PACKAGE_SCRIPT="${SCRIPT_DIR}/package_replays.sh"
UPLOAD_SCRIPT="${SCRIPT_DIR}/upload_to_ia.sh"

chmod +x "${PACKAGE_SCRIPT}" "${UPLOAD_SCRIPT}"

CHECK_INTERVAL_SEC=1800 # 30 minutes
UPLOAD_INTERVAL_SEC=3600 # 60 minutes

last_upload_time=0

while true; do
  current_time=$(date +%s)

  # Check free disk space on /mnt/hdd
  avail_kb=$(df -k /mnt/hdd | awk 'NR==2 {print $4}')
  avail_gb=$(( avail_kb / 1024 / 1024 ))

  if [[ $avail_gb -lt 50 ]]; then
    log "WARN" "Low disk space on /mnt/hdd (${avail_gb}GB available). Forcing emergency purge..."
    # Force clean uploaded files older than 2 days
    find "${STAGING_DIR}" -type f -name "*.tar.gz" -mtime +2 -exec rm -f {} + 2>/dev/null || true
  else
    log "INFO" "Disk space healthy: ${avail_gb}GB available on /mnt/hdd."
  fi

  # Run Packaging Job
  log "INFO" "Triggering Replay Packaging Task..."
  if bash "${PACKAGE_SCRIPT}"; then
    log "INFO" "Packaging task executed cleanly."
  else
    log "WARN" "Packaging task returned non-zero status."
  fi

  # Run Upload Job if interval reached
  if (( current_time - last_upload_time >= UPLOAD_INTERVAL_SEC )); then
    log "INFO" "Triggering Internet Archive Cloud Upload Task..."
    if bash "${UPLOAD_SCRIPT}"; then
      log "INFO" "Upload task executed cleanly."
      last_upload_time=$current_time
    else
      log "WARN" "Upload task returned non-zero status."
    fi
  fi

  log "INFO" "Sleeping for ${CHECK_INTERVAL_SEC}s until next cycle..."
  sleep "${CHECK_INTERVAL_SEC}"
done
