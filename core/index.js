/**
 * Project M3S - Core Agent (Phase 1.4 Production Hardened)
 * 
 * Production Optimizations:
 * 1. Staggered Tick Execution: Offsets FSM loop start by (instanceIndex * 85ms)
 *    to prevent 30 bots from hitting pathfinder/raycast ticks on the exact same millisecond.
 * 2. Proxy Fallback Rotation: Automatically rotates SOCKS5 proxy from pool upon connection drop.
 * 3. Trace Cleanup & Anti-Leak: Zero stdout coordinates, break empty chests.
 */
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('./config');

// Modular plugins
const stealthEnginePlugin = require('./lib/stealthEngine');
const resourceGovernorPlugin = require('./lib/resourceGovernor');
const threatRadarPlugin = require('./lib/threatRadar');
const survivalFSMPlugin = require('./lib/survivalFSM');
const toolProgressionPlugin = require('./lib/toolProgression');
const inventoryPurgePlugin = require('./lib/inventoryPurge');
const ipcServerPlugin = require('./lib/ipcServer');
const swarmBusClientPlugin = require('./lib/swarmBusClient');
const swarmLogisticsPlugin = require('./lib/swarmLogistics');
const rlEnginePlugin = require('./lib/rlEngine');

let reconnectAttempts = 0;
let currentProxyIndex = 0;

function getNextProxy() {
  const pool = config.network.proxyPool;
  if (!pool || pool.length === 0) return null;
  const proxy = pool[currentProxyIndex % pool.length];
  currentProxyIndex++;
  return proxy;
}

function createCoreAgent() {
  const { host, port, username, authType, version, role, instanceIndex } = config.connection;
  console.log(`[CORE INIT] Launching '${username}' (Instance #${instanceIndex}, Role: ${role})...`);

  const botOptions = {
    host,
    port,
    username,
    auth: authType,
    skipValidation: true,
    hideErrors: false
  };

  if (version) {
    botOptions.version = version;
  }

  // SOCKS5 Tunneling with Fallback Pool
  const activeProxy = getNextProxy();
  if (activeProxy) {
    const safeProxy = activeProxy.replace(/:[^:@]+@/, ':****@');
    console.log(`[NETWORK] SOCKS5 Routing via: ${safeProxy}`);
    const agent = new SocksProxyAgent(activeProxy);
    botOptions.connect = (client) => {
      agent.callback({ host, port }, null, (err, socket) => {
        if (err) {
          console.error('[NETWORK SOCKS5 FAIL] Rotating proxy fallback...', err.message);
          client.emit('error', err);
          return;
        }
        client.setSocket(socket);
        client.emit('connect');
      });
    };
  }

  const bot = mineflayer.createBot(botOptions);

  // 1. Attach Modular Plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin((b) => resourceGovernorPlugin(b, { config }));
  bot.loadPlugin((b) => stealthEnginePlugin(b, { config }));
  bot.loadPlugin((b) => swarmBusClientPlugin(b, { config }));
  bot.loadPlugin((b) => rlEnginePlugin(b, { config }));
  bot.loadPlugin((b) => swarmLogisticsPlugin(b, { config }));
  bot.loadPlugin((b) => threatRadarPlugin(b, { config }));
  bot.loadPlugin((b) => toolProgressionPlugin(b, { config }));
  bot.loadPlugin((b) => inventoryPurgePlugin(b, { config }));
  bot.loadPlugin((b) => survivalFSMPlugin(b, { config }));
  bot.loadPlugin((b) => ipcServerPlugin(b, { config }));

  // 2. Lifecycle Handlers with Staggered Tick Offset
  bot.once('spawn', () => {
    reconnectAttempts = 0;
    
    // Staggered initialization offset (instanceIndex * 85ms)
    const staggerDelay = (instanceIndex % 30) * 85;
    console.log(`[SPAWN OK] Agent '${username}' online. Staggering execution loop by +${staggerDelay}ms.`);

    setTimeout(() => {
      try {
        const mcData = require('minecraft-data')(bot.version);
        const move = new Movements(bot, mcData);
        move.canDig = true;
        move.allow1by1towers = false;
        move.allowParkour = true;
        move.dontMineUnderFallingBlocks = true;

        const hazardousBlocks = ['lava', 'flowing_lava', 'fire', 'soul_fire', 'wither_rose', 'cactus', 'cobweb', 'powder_snow'];
        for (const bName of hazardousBlocks) {
          const b = mcData.blocksByName[bName];
          if (b) move.blocksToAvoid.add(b.id);
        }
        bot.pathfinder.setMovements(move);
      } catch (err) {
        console.warn('[PATHFINDER CONFIG]', err.message);
      }

      handleAuthChat(bot);
    }, staggerDelay);
  });

  bot.on('kicked', (reason) => {
    console.warn(`[KICKED] Agent '${username}' was kicked. Reason:`, reason);
  });

  bot.on('error', (err) => {
    console.error(`[AGENT ERROR] '${username}':`, err.message);
  });

  bot.on('end', () => {
    console.log(`[SESSION END] Disconnected '${username}'. Rotating proxy for next attempt.`);
    scheduleReconnect();
  });
}

function handleAuthChat(bot) {
  const { password, registerIfNew, delayMs } = config.authChat;
  if (!password) return;

  bot.on('message', (jsonMsg) => {
    const raw = jsonMsg.toString().toLowerCase();
    if (raw.includes('/register') && registerIfNew) {
      setTimeout(() => {
        bot.chat(`/register ${password} ${password}`);
        console.log('[AUTH] Issued /register command.');
      }, delayMs);
    } else if (raw.includes('/login')) {
      setTimeout(() => {
        bot.chat(`/login ${password}`);
        console.log('[AUTH] Issued /login command.');
      }, delayMs);
    }
  });
}

function scheduleReconnect() {
  reconnectAttempts++;
  const { minWaitMs, maxWaitMs, backoffMultiplier } = config.reconnect;
  const baseJitter = minWaitMs + Math.random() * (maxWaitMs - minWaitMs);
  const backoff = Math.min(baseJitter * Math.pow(backoffMultiplier, reconnectAttempts - 1), 180000);

  console.log(`[RECONNECT] Backoff ${(backoff / 1000).toFixed(1)}s (Attempt #${reconnectAttempts})...`);
  setTimeout(() => {
    createCoreAgent();
  }, backoff);
}

// Global Process Fault Tolerance
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] at:', promise, 'reason:', reason);
});

createCoreAgent();
