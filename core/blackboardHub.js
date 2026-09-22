/**
 * blackboardHub.js - Phase 1.4 Hardened with Dynamic Port / Socket Fallback
 */
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_SOCKET_PATH = process.env.BLACKBOARD_SOCK || '/tmp/m3s_blackboard.sock';
const DEFAULT_TCP_PORT = parseInt(process.env.BLACKBOARD_TCP_PORT || '28555', 10);
const SWARM_SECRET = process.env.SWARM_SECRET || 'm3s_secure_swarm_salt_99';

class SwarmBlackboardHub {
  constructor(socketPath = DEFAULT_SOCKET_PATH, initialPort = DEFAULT_TCP_PORT) {
    this.socketPath = socketPath;
    this.currentPort = initialPort;
    this.clients = new Map();

    this.ledger = {
      bots: {},
      leaderboard: {},
      claimedZones: {},
      threats: {},
      dispatchRequests: [],
      activeDeliveries: {}
    };

    this.server = null;
    this.isTcpMode = process.env.BLACKBOARD_USE_TCP === 'true' || process.platform === 'win32';
  }

  start() {
    this.server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const packet = JSON.parse(line.trim());
            this.handlePacket(socket, packet);
          } catch (err) {
            socket.write(JSON.stringify({ status: 'ERROR', error: err.message }) + '\n');
          }
        }
      });

      socket.on('close', () => this.handleClientDisconnect(socket));
      socket.on('error', () => this.handleClientDisconnect(socket));
    });

    if (this.isTcpMode) {
      this.listenTcp(this.currentPort);
    } else {
      this.listenUnixSocket(this.socketPath);
    }

    setInterval(() => this.housekeeping(), 5000);
  }

  listenUnixSocket(sockPath) {
    if (fs.existsSync(sockPath)) {
      try { fs.unlinkSync(sockPath); } catch {}
    }

    this.server.once('error', (err) => {
      console.warn(`[SWARM BUS] Unix socket ${sockPath} error (${err.message}). Falling back to TCP mode...`);
      this.isTcpMode = true;
      this.listenTcp(this.currentPort);
    });

    this.server.listen(sockPath, () => {
      console.log(`[SWARM BUS] Blackboard Ledger Server listening on Unix Socket: ${sockPath}`);
      try { fs.writeFileSync('/tmp/m3s_hub_endpoint.json', JSON.stringify({ type: 'unix', path: sockPath })); } catch {}
    });
  }

  listenTcp(port) {
    this.server.removeAllListeners('error');
    this.server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        console.warn(`[PORT CONFLICT] Port ${port} is in use! Automatically shifting to ${nextPort}...`);
        this.currentPort = nextPort;
        this.listenTcp(nextPort);
      } else {
        console.error('[SWARM BUS ERROR]', err.message);
      }
    });

    this.server.listen(port, '127.0.0.1', () => {
      console.log(`[SWARM BUS] Blackboard Ledger Server listening on TCP 127.0.0.1:${port}`);
      try { fs.writeFileSync('/tmp/m3s_hub_endpoint.json', JSON.stringify({ type: 'tcp', host: '127.0.0.1', port })); } catch {}
    });
  }

  handleClientDisconnect(socket) {
    const botName = this.clients.get(socket);
    if (botName) {
      console.log(`[SWARM BUS] Bot '${botName}' disconnected.`);
      this.releaseBotZones(botName);
      delete this.ledger.bots[botName];
      this.clients.delete(socket);
    }
  }

  verifyMeritProof(proof) {
    if (!proof || !proof.bot || proof.score === undefined || !proof.proofHash) return false;
    const expectedPayload = `${proof.bot}:${proof.score}:${proof.oresMined}:${proof.survivalTicks}`;
    const calculatedHmac = crypto.createHmac('sha256', SWARM_SECRET).update(expectedPayload).digest('hex');
    return calculatedHmac === proof.proofHash;
  }

  updateRanks() {
    const sorted = Object.entries(this.ledger.leaderboard)
      .sort((a, b) => b[1].score - a[1].score);

    sorted.forEach(([botName, entry], index) => {
      const rank = index + 1;
      entry.rank = rank;
      if (this.ledger.bots[botName]) {
        this.ledger.bots[botName].rank = rank;
        this.ledger.bots[botName].isAlpha = (rank === 1 && entry.score > 0);
      }
    });
  }

  handlePacket(socket, packet) {
    const action = packet.action ? packet.action.toUpperCase() : '';

    switch (action) {
      case 'HEARTBEAT': {
        const { bot, role, telemetry } = packet;
        if (!bot) return;

        this.clients.set(socket, bot);
        const currentRank = (this.ledger.leaderboard[bot] && this.ledger.leaderboard[bot].rank) || 99;

        this.ledger.bots[bot] = {
          role: role || 'MINER',
          pos: telemetry ? telemetry.position : null,
          health: telemetry ? telemetry.health : 20,
          food: telemetry ? telemetry.food : 20,
          rssMb: telemetry ? telemetry.rssMb : 0,
          rank: currentRank,
          isAlpha: currentRank === 1,
          lastSeen: Date.now(),
          socket
        };

        if (role === 'COURIER' && !this.ledger.activeDeliveries[bot]) {
          this.tryDispatchCourier(bot, socket);
        }

        socket.write(JSON.stringify({ 
          status: 'OK', 
          ack: 'HEARTBEAT', 
          rank: currentRank,
          isAlpha: currentRank === 1
        }) + '\n');
        break;
      }

      case 'UPDATE_SCORE': {
        const { proof } = packet;
        if (!this.verifyMeritProof(proof)) {
          console.warn(`[ANTI-CHEAT ALERT] Rejected invalid HMAC merit proof from '${proof ? proof.bot : 'unknown'}'!`);
          socket.write(JSON.stringify({ status: 'REJECTED', error: 'ANTI_CHEAT_HASH_MISMATCH' }) + '\n');
          return;
        }

        this.ledger.leaderboard[proof.bot] = {
          score: proof.score,
          oresMined: proof.oresMined,
          survivalTicks: proof.survivalTicks,
          lastUpdated: Date.now()
        };

        this.updateRanks();

        const myRank = this.ledger.leaderboard[proof.bot].rank;
        console.log(`[LEADERBOARD] Verified '${proof.bot}': Score=${proof.score} (Rank #${myRank})`);

        socket.write(JSON.stringify({ 
          status: 'OK', 
          ack: 'SCORE_VERIFIED', 
          rank: myRank,
          isAlpha: myRank === 1
        }) + '\n');
        break;
      }

      case 'CLAIM_ZONE': {
        const { bot, center } = packet;
        const botRank = (this.ledger.bots[bot] && this.ledger.bots[bot].rank) || 99;
        
        let effectiveRadius = 24;
        if (botRank === 1) effectiveRadius = 32;
        else if (this.ledger.leaderboard[bot] && this.ledger.leaderboard[bot].score < 0) effectiveRadius = 16;

        const result = this.tryClaimZone(bot, center, effectiveRadius);
        socket.write(JSON.stringify({
          status: result.success ? 'OK' : 'REJECTED',
          action: 'CLAIM_ZONE_RESULT',
          zoneId: result.zoneId,
          grantedRadius: effectiveRadius,
          reason: result.reason
        }) + '\n');
        break;
      }

      case 'RELEASE_ZONE': {
        const { bot, zoneId } = packet;
        if (zoneId && this.ledger.claimedZones[zoneId] && this.ledger.claimedZones[zoneId].owner === bot) {
          delete this.ledger.claimedZones[zoneId];
          socket.write(JSON.stringify({ status: 'OK', ack: 'ZONE_RELEASED' }) + '\n');
        }
        break;
      }

      case 'BROADCAST_THREAT': {
        const { bot, threat } = packet;
        if (threat && threat.pos) {
          const threatId = `threat_${bot}_${Date.now()}`;
          this.ledger.threats[threatId] = {
            ...threat,
            reporter: bot,
            timestamp: Date.now()
          };

          this.broadcastToSwarm({
            action: 'ALERT_THREAT_PROPAGATION',
            threatId,
            threat
          }, socket);

          socket.write(JSON.stringify({ status: 'OK', ack: 'THREAT_BROADCASTED' }) + '\n');
        }
        break;
      }

      case 'REQUEST_COURIER': {
        const { miner, pos } = packet;
        const botRank = (this.ledger.bots[miner] && this.ledger.bots[miner].rank) || 99;
        const isPriority = botRank <= 3;

        // Zero-coordinate leak in console
        console.log(`[LOGISTICS] Miner '${miner}' (Rank #${botRank}, Priority: ${isPriority}) requested courier.`);

        const existingIdx = this.ledger.dispatchRequests.findIndex(r => r.miner === miner);
        if (existingIdx === -1) {
          const reqItem = {
            miner,
            pos,
            rank: botRank,
            timestamp: Date.now(),
            status: 'PENDING'
          };

          if (isPriority) {
            this.ledger.dispatchRequests.unshift(reqItem);
          } else {
            this.ledger.dispatchRequests.push(reqItem);
          }
        }

        this.matchCourierRequests();
        socket.write(JSON.stringify({ status: 'OK', ack: 'COURIER_REQUEST_QUEUED', isPriority }) + '\n');
        break;
      }

      case 'COURIER_TASK_COMPLETE': {
        const { courier, miner } = packet;
        console.log(`[LOGISTICS] Courier '${courier}' completed offload for '${miner}'`);
        delete this.ledger.activeDeliveries[courier];
        
        const minerBot = this.ledger.bots[miner];
        if (minerBot && minerBot.socket) {
          try {
            minerBot.socket.write(JSON.stringify({
              action: 'COURIER_OFFLOAD_SUCCESS',
              courier
            }) + '\n');
          } catch {}
        }
        
        const courierBot = this.ledger.bots[courier];
        if (courierBot && courierBot.socket) {
          this.tryDispatchCourier(courier, courierBot.socket);
        }
        socket.write(JSON.stringify({ status: 'OK', ack: 'COURIER_FREE' }) + '\n');
        break;
      }

      default:
        socket.write(JSON.stringify({ status: 'ERROR', error: `Unknown action: ${action}` }) + '\n');
        break;
    }
  }

  tryClaimZone(bot, center, radius) {
    if (!center || center.x === undefined) {
      return { success: false, reason: 'Invalid coordinates' };
    }

    for (const [zId, zone] of Object.entries(this.ledger.claimedZones)) {
      if (zone.owner === bot) continue;

      const dx = center.x - zone.center.x;
      const dz = center.z - zone.center.z;
      const distSq = dx * dx + dz * dz;
      const minDistance = radius + zone.radius;

      if (distSq < minDistance * minDistance) {
        return {
          success: false,
          zoneId: zId,
          reason: `Overlaps with zone owned by ${zone.owner}`
        };
      }
    }

    const newZoneId = `zone_${bot}_${Date.now()}`;
    this.ledger.claimedZones[newZoneId] = {
      center,
      radius,
      owner: bot,
      timestamp: Date.now()
    };

    return { success: true, zoneId: newZoneId };
  }

  releaseBotZones(bot) {
    for (const [zId, zone] of Object.entries(this.ledger.claimedZones)) {
      if (zone.owner === bot) {
        delete this.ledger.claimedZones[zId];
      }
    }
  }

  matchCourierRequests() {
    if (this.ledger.dispatchRequests.length === 0) return;

    for (const [bName, botInfo] of Object.entries(this.ledger.bots)) {
      if (botInfo.role === 'COURIER' && !this.ledger.activeDeliveries[bName]) {
        this.tryDispatchCourier(bName, botInfo.socket);
      }
    }
  }

  tryDispatchCourier(courierName, socket) {
    if (this.ledger.dispatchRequests.length === 0) return;

    const request = this.ledger.dispatchRequests.shift();
    this.ledger.activeDeliveries[courierName] = {
      miner: request.miner,
      pos: request.pos,
      timestamp: Date.now()
    };

    try {
      socket.write(JSON.stringify({
        action: 'DISPATCH_MISSION',
        miner: request.miner,
        destination: request.pos
      }) + '\n');
      console.log(`[LOGISTICS] Dispatched Courier '${courierName}' -> Miner '${request.miner}' (Rank #${request.rank})`);
    } catch {
      this.ledger.dispatchRequests.unshift(request);
      delete this.ledger.activeDeliveries[courierName];
    }
  }

  broadcastToSwarm(payload, excludeSocket = null) {
    const raw = JSON.stringify(payload) + '\n';
    for (const [sock] of this.clients.entries()) {
      if (sock !== excludeSocket && !sock.destroyed) {
        try { sock.write(raw); } catch {}
      }
    }
  }

  housekeeping() {
    const now = Date.now();
    for (const [id, threat] of Object.entries(this.ledger.threats)) {
      if (now - threat.timestamp > 30000) delete this.ledger.threats[id];
    }
    for (const [id, zone] of Object.entries(this.ledger.claimedZones)) {
      if (now - zone.timestamp > 300000) delete this.ledger.claimedZones[id];
    }
    for (const [bName, bInfo] of Object.entries(this.ledger.bots)) {
      if (now - bInfo.lastSeen > 15000) {
        this.releaseBotZones(bName);
        delete this.ledger.bots[bName];
      }
    }
  }
}

if (require.main === module) {
  const hub = new SwarmBlackboardHub();
  hub.start();
}

module.exports = SwarmBlackboardHub;
