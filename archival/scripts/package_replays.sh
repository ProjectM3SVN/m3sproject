#!/usr/bin/env bash
# ==============================================================================
# Project M3S: Replay Batch Packager & Parallel Compression
# Script: /mnt/hdd/m3s_archive/scripts/package_replays.sh
# Objective:
#   - Scans WATCH_DIR for completed .mcpr files (older than BATCH_TIME_WINDOW_MIN)
#   - Groups them by timestamp bucket (YYYY-MM-DD_HH)
#   - Archives and compresses via multi-threaded pigz
#   - Enforces ionice -c 3 (idle) and nice -n 19 to protect Mineflayer bots
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

mkdir -p "${STAGING_DIR}" "${PROCESSED_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/packaging_$(date +'%Y-%m-%d').log"

log() {
  local level="$1"
  shift
  local msg="$*"
  local timestamp
  timestamp="$(date +'%Y-%m-%d %H:%M:%S')"
  echo "[${timestamp}] [${level}] ${msg}" | tee -a "${LOG_FILE}"
}

# Ensure background low priority execution
if command -v ionice >/dev/null 2>&1; then
  ionice -c "${IO_NICE_CLASS:-3}" -p $$ 2>/dev/null || true
fi
renice -n "${CPU_NICE_LEVEL:-19}" -p $$ >/dev/null 2>&1 || true

log "INFO" "Starting Replay Mod Packaging Job..."

# Identify completed .mcpr files older than BATCH_TIME_WINDOW_MIN (not being currently written)
COMPLETED_FILES=()
while IFS= read -r -d '' file; do
  COMPLETED_FILES+=("$file")
done < <(find "${WATCH_DIR}" -maxdepth 2 -type f -name "*.mcpr" -mmin +"${BATCH_TIME_WINDOW_MIN:-60}" -print0 2>/dev/null)

if [[ ${#COMPLETED_FILES[@]} -eq 0 ]]; then
  log "INFO" "No completed .mcpr files found ready for packaging. Exiting."
  exit 0
fi

log "INFO" "Found ${#COMPLETED_FILES[@]} files eligible for archival."

# Group files by timestamp tag (YYYYMMDD_HH)
declare -A FILE_GROUPS

for file in "${COMPLETED_FILES[@]}"; do
  file_mtime="$(date -r "$file" +'%Y%m%d_%H')"
  FILE_GROUPS["${file_mtime}"]+="${file}$"$'\n'
done

for group_tag in "${!FILE_GROUPS[@]}"; do
  archive_name="m3s_replays_${group_tag}.tar.gz"
  archive_tarball="${STAGING_DIR}/${archive_name}"
  manifest_file="${STAGING_DIR}/m3s_replays_${group_tag}.manifest.json"

  log "INFO" "Creating archive: ${archive_name}"

  # Read group files into an array
  IFS=$'\n' read -rd '' -a group_file_list <<< "${FILE_GROUPS[$group_tag]}" || true

  # Build manifest
  file_count=${#group_file_list[@]}
  start_time="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  # Create tar with pigz
  tmp_tar_list=$(mktemp)
  for f in "${group_file_list[@]}"; do
    [[ -n "$f" ]] && echo "$f" >> "$tmp_tar_list"
  done

  # Multi-threaded compression restricted to PIGZ_THREADS
  PIGZ_CMD="pigz -p ${PIGZ_THREADS:-4}"
  if ! command -v pigz >/dev/null 2>&1; then
    log "WARN" "pigz not found, falling back to standard gzip."
    PIGZ_CMD="gzip"
  fi

  log "INFO" "Compressing ${file_count} files via ${PIGZ_CMD}..."
  if tar --use-compress-program="${PIGZ_CMD}" -cf "${archive_tarball}" -T "${tmp_tar_list}"; then
    archive_size_bytes=$(stat -c%s "${archive_tarball}")
    archive_sha256=$(sha256sum "${archive_tarball}" | awk '{print $1}')
    
    # Write JSON manifest
    cat <<EOF > "${manifest_file}"
{
  "archive_name": "${archive_name}",
  "group_tag": "${group_tag}",
  "file_count": ${file_count},
  "size_bytes": ${archive_size_bytes},
  "sha256": "${archive_sha256}",
  "packaged_at": "${start_time}",
  "files": [
$(awk '{printf "    \"%s\"%s\n", $0, (NR==1?"":",")}' "$tmp_tar_list" | tac)
  ]
}
EOF

    log "INFO" "Archive created successfully: ${archive_name} (${archive_size_bytes} bytes). SHA256: ${archive_sha256}"

    # Move source files to PROCESSED_DIR to keep raw_packets clean
    for f in "${group_file_list[@]}"; do
      if [[ -n "$f" && -f "$f" ]]; then
        rel_name="$(basename "$f")"
        mv "$f" "${PROCESSED_DIR}/${rel_name}"
      fi
    done
  else
    log "ERROR" "Failed to create archive ${archive_name}!"
  fi

  rm -f "${tmp_tar_list}"
done

log "INFO" "Packaging job completed."
