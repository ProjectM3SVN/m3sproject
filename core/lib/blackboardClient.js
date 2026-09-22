/**
 * blackboardClient.js - Custom Mineflayer Plugin (Phase 1.2)
 * Connects individual MSNPC instance to the Swarm Blackboard (/tmp/m3s_blackboard.sock).
 * - Transmits periodic heartbeats with telemetry without blocking Mineflayer loop.
 * - Receives swarm threat alerts from other bots (e.g. Hostile player seen 80m away).
 * - If connection to blackboard fails, silently falls back to standalone operation.
 */
const net = require('net');

function blackboardClientPlugin(bot, options = {}) {
  const config = options.config || {};
  const socketPath = (config.blackboard && config.blackboard.socketPath) || '/tmp/m3s_blackboard.sock';
  const heartbeatIntervalMs = (config.blackboard && config.blackboard.heartbeatIntervalMs) || 3000;

  let client = null;
  let heartbeatTimer = null;
  let isConnected = false;
  let reconnectTimer = null;

  function connectToBlackboard() {
    if (client) {
      try { client.destroy(); } catch {}
    }

    client = net.createConnection(socketPath);

    client.on('connect', () => {
      isConnected = true;
      console.log(`[BLACKBOARD CLIENT] Linked to Swarm Blackboard at ${socketPath}`);
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
          const packet = JSON.parse(line.trim());
          handleSwarmBroadcast(packet);
        } catch {
          // Ignore JSON parse anomalies
        }
      }
    });

    client.on('error', () => {
      isConnected = false;
      stopHeartbeat();
      scheduleReconnect();
    });

    client.on('close', () => {
      isConnected = false;
      stopHeartbeat();
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToBlackboard();
    }, 5000);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!isConnected || !client) return;
      if (!bot.getTelemetry) return;

      const payload = {
        type: 'HEARTBEAT',
        bot: bot.username,
        telemetry: bot.getTelemetry()
      };

      try {
        client.write(JSON.stringify(payload) + '\n');
      } catch {
        // Socket write issue handled by error listener
      }
    }, heartbeatIntervalMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function handleSwarmBroadcast(packet) {
    if (packet.type === 'ALERT_THREAT') {
      const threat = packet.threat;
      if (!threat || !bot.entity) return;

      // Check distance to reported threat
      if (threat.pos) {
        const dist = bot.entity.position.distanceTo(threat.pos);
        console.warn(`[SWARM ALERT] Peer reported threat '${threat.target}' at ${dist.toFixed(1)}m away!`);

        // If threat is within 64 blocks, raise defensive readiness
        if (dist <= 64) {
          bot.setControlState('sneak', true);
          if (dist <= 24 && bot.threatRadar && bot.threatRadar.executeSelfEntomb) {
            bot.threatRadar.executeSelfEntomb();
          }
        }
      }
    }
  }

  function reportThreat(threatData) {
    if (!isConnected || !client) return;
    const packet = {
      type: 'REPORT_THREAT',
      bot: bot.username,
      threat: threatData
    };
    try {
      client.write(JSON.stringify(packet) + '\n');
    } catch {}
  }

  function reportPOI(poiData) {
    if (!isConnected || !client) return;
    const packet = {
      type: 'REPORT_POI',
      bot: bot.username,
      poi: poiData
    };
    try {
      client.write(JSON.stringify(packet) + '\n');
    } catch {}
  }

  bot.once('spawn', () => {
    connectToBlackboard();
  });

  bot.once('end', () => {
    stopHeartbeat();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (client) {
      try { client.destroy(); } catch {}
    }
  });

  bot.blackboard = {
    reportThreat,
    reportPOI,
    isConnected: () => isConnected
  };
}

module.exports = blackboardClientPlugin;
