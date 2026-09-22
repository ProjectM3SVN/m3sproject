/**
 * swarmBusClient.js - Dynamic Port / Unix Socket Fallback
 */
const net = require('net');
const fs = require('fs');

function swarmBusClientPlugin(bot, options = {}) {
  const config = options.config || {};
  const socketPath = (config.blackboard && config.blackboard.socketPath) || '/tmp/m3s_blackboard.sock';
  const role = (config.connection && config.connection.role) || 'MINER';
  const heartbeatMs = (config.blackboard && config.blackboard.heartbeatIntervalMs) || 2500;

  let client = null;
  let heartbeatTimer = null;
  let isConnected = false;
  let currentZoneId = null;
  let myRank = 99;
  let isAlpha = false;

  function resolveEndpoint() {
    // Check if endpoint file was written by hub
    if (fs.existsSync('/tmp/m3s_hub_endpoint.json')) {
      try {
        const ep = JSON.parse(fs.readFileSync('/tmp/m3s_hub_endpoint.json', 'utf8'));
        if (ep.type === 'tcp') return { port: ep.port, host: ep.host || '127.0.0.1' };
        if (ep.type === 'unix') return { path: ep.path };
      } catch {}
    }
    return { path: socketPath };
  }

  function connect() {
    if (client) {
      try { client.destroy(); } catch {}
    }

    const endpoint = resolveEndpoint();
    client = net.createConnection(endpoint);

    client.on('connect', () => {
      isConnected = true;
      console.log(`[SWARM BUS] Connected to Swarm Ledger at ${endpoint.port ? `127.0.0.1:${endpoint.port}` : endpoint.path} (Role: ${role})`);
      startHeartbeat();
    });

    let buffer = '';
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          handleIncomingMessage(msg);
        } catch {}
      }
    });

    client.on('error', () => {
      isConnected = false;
      stopHeartbeat();
      setTimeout(connect, 3000);
    });

    client.on('close', () => {
      isConnected = false;
      stopHeartbeat();
      setTimeout(connect, 3000);
    });
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!isConnected || !client) return;

      const payload = {
        action: 'HEARTBEAT',
        bot: bot.username,
        role: role,
        telemetry: bot.getTelemetry ? bot.getTelemetry() : null
      };

      try {
        client.write(JSON.stringify(payload) + '\n');
      } catch {}
    }, heartbeatMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function handleIncomingMessage(msg) {
    const action = msg.action || '';

    if (msg.ack === 'HEARTBEAT' || msg.ack === 'SCORE_VERIFIED') {
      if (msg.rank !== undefined) myRank = msg.rank;
      if (msg.isAlpha !== undefined) isAlpha = msg.isAlpha;
    }

    if (action === 'ALERT_THREAT_PROPAGATION') {
      const threat = msg.threat;
      if (!threat || !threat.pos || !bot.entity) return;

      const myPos = bot.entity.position;
      const dx = myPos.x - threat.pos.x;
      const dz = myPos.z - threat.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      console.warn(`[SWARM WARNING] Peer spotted hostile at (${threat.pos.x.toFixed(1)}, ${threat.pos.z.toFixed(1)}), ${dist.toFixed(1)}m from me!`);

      if (dist <= 64) {
        bot.setControlState('sprint', false);
        bot.setControlState('sneak', true);

        if (dist <= 24 && bot.threatRadar && bot.threatRadar.executeSelfEntomb) {
          bot.threatRadar.executeSelfEntomb();
        }
      }
    } else if (action === 'CLAIM_ZONE_RESULT') {
      if (msg.status === 'OK') {
        currentZoneId = msg.zoneId;
        console.log(`[SWARM LOGISTICS] Exclusive zone claimed: ${currentZoneId} (Radius: ${msg.grantedRadius || 24}m)`);
      } else {
        console.warn(`[SWARM LOGISTICS] Zone claim REJECTED: ${msg.reason}. Relocating...`);
        if (bot.swarmLogistics && bot.swarmLogistics.handleZoneConflict) {
          bot.swarmLogistics.handleZoneConflict();
        }
      }
    } else if (action === 'DISPATCH_MISSION') {
      console.log(`[COURIER ACTIVE] Received dispatch order: Head to miner '${msg.miner}'`);
      if (bot.swarmLogistics && bot.swarmLogistics.executeCourierMission) {
        bot.swarmLogistics.executeCourierMission(msg.miner, msg.destination);
      }
    } else if (action === 'COURIER_OFFLOAD_SUCCESS') {
      console.log(`[MINER LOGISTICS] Courier '${msg.courier}' successfully cleared inventory chest.`);
      if (bot.swarmLogistics && bot.swarmLogistics.onCourierOffloadDone) {
        bot.swarmLogistics.onCourierOffloadDone();
      }
    }
  }

  function claimZone(center, radius = 24) {
    if (!isConnected || !client) return;
    const packet = {
      action: 'CLAIM_ZONE',
      bot: bot.username,
      center,
      radius
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
  }

  function releaseCurrentZone() {
    if (!isConnected || !client || !currentZoneId) return;
    const packet = {
      action: 'RELEASE_ZONE',
      bot: bot.username,
      zoneId: currentZoneId
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
    currentZoneId = null;
  }

  function broadcastThreat(threatData) {
    if (!isConnected || !client) return;
    const packet = {
      action: 'BROADCAST_THREAT',
      bot: bot.username,
      threat: threatData
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
  }

  function requestCourier(pos) {
    if (!isConnected || !client) return;
    const packet = {
      action: 'REQUEST_COURIER',
      miner: bot.username,
      pos
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
  }

  function reportCourierComplete(minerName) {
    if (!isConnected || !client) return;
    const packet = {
      action: 'COURIER_TASK_COMPLETE',
      courier: bot.username,
      miner: minerName
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
  }

  function reportScoreUpdate(proof) {
    if (!isConnected || !client) return;
    const packet = {
      action: 'UPDATE_SCORE',
      proof
    };
    try { client.write(JSON.stringify(packet) + '\n'); } catch {}
  }

  bot.once('spawn', connect);
  bot.once('end', () => {
    releaseCurrentZone();
    stopHeartbeat();
    if (client) {
      try { client.destroy(); } catch {}
    }
  });

  bot.swarmBus = {
    claimZone,
    releaseCurrentZone,
    broadcastThreat,
    requestCourier,
    reportCourierComplete,
    reportScoreUpdate,
    isConnected: () => isConnected,
    getRole: () => role,
    getRank: () => myRank,
    isAlpha: () => isAlpha
  };
}

module.exports = swarmBusClientPlugin;
