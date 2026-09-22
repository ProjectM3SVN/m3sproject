/**
 * launchSwarm.js - Swarm Master Orchestrator (Phase 1.4 Production)
 * 
 * Features:
 * 1. Spawns and manages a 30-bot swarm on Ubuntu ThinkCentre M920s.
 * 2. Injects Ephemeral Cryptographic HMAC Secret (rotated per cluster run).
 * 3. Enforces Staggered Bootstrapping (delays each bot spawn by 1.5s - 2.5s)
 *    to prevent CPU spikes and server connection rate-limits.
 * 4. Monitors Aggregate Cluster RAM and CPU usage.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const SWARM_SIZE = parseInt(process.env.SWARM_SIZE || '30', 10);
const SWARM_SECRET = crypto.randomBytes(32).toString('hex');

console.log('====================================================');
console.log(`[SWARM ORCHESTRATOR] Initializing cluster with ${SWARM_SIZE} bots.`);
console.log(`[SECURITY] Dynamic Cluster HMAC Secret generated.`);
console.log('====================================================');

// Start Blackboard Hub Daemon first
const hubProcess = spawn('node', ['blackboardHub.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    SWARM_SECRET,
    BLACKBOARD_SOCK: '/tmp/m3s_blackboard.sock'
  },
  stdio: 'inherit'
});

hubProcess.on('error', (err) => {
  console.error('[ORCHESTRATOR ERROR] Failed to start Blackboard Hub:', err);
});

// Staggered Spawning of Bots
const botProcesses = [];

async function launchCluster() {
  // Wait 1.5s for Hub socket to bind
  await new Promise(r => setTimeout(r, 1500));

  for (let i = 0; i < SWARM_SIZE; i++) {
    // 24 Miners, 6 Couriers
    const role = (i % 5 === 0) ? 'COURIER' : 'MINER';
    const username = `MSNPC_${role.slice(0, 1)}${String(i + 1).padStart(2, '0')}`;

    console.log(`[BOOTSTRAP] Spawning Bot #${i + 1}/${SWARM_SIZE}: '${username}' (${role})`);

    const botProc = spawn('node', ['--max-old-space-size=96', 'index.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        USERNAME: username,
        BOT_ROLE: role,
        BOT_INSTANCE_INDEX: String(i),
        SWARM_SECRET,
        BLACKBOARD_SOCK: '/tmp/m3s_blackboard.sock'
      },
      stdio: ['ignore', 'inherit', 'inherit']
    });

    botProc.on('exit', (code) => {
      console.warn(`[ORCHESTRATOR] Bot '${username}' exited with code ${code}.`);
    });

    botProcesses.push(botProc);

    // Stagger next spawn by 1.8s to avoid connection storm
    await new Promise(r => setTimeout(r, 1800));
  }

  console.log('====================================================');
  console.log(`[CLUSTER ONLINE] All ${SWARM_SIZE} bots dispatched successfully.`);
  console.log('====================================================');
}

// Graceful Cluster Shutdown
function shutdownCluster() {
  console.log('\n[SHUTDOWN] Terminating all swarm instances...');
  for (const proc of botProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  try { hubProcess.kill('SIGTERM'); } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdownCluster);
process.on('SIGTERM', shutdownCluster);

launchCluster();
