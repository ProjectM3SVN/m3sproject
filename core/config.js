const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Ensure dynamic ephemeral secret if not injected by parent supervisor
if (!process.env.SWARM_SECRET) {
  process.env.SWARM_SECRET = crypto.randomBytes(32).toString('hex');
}

// Parse SOCKS5 proxy pool
const proxyPoolRaw = process.env.SOCKS5_PROXY_POOL || process.env.SOCKS5_PROXY || '';
const proxyList = proxyPoolRaw.split(',').map(p => p.trim()).filter(Boolean);

const config = {
  connection: {
    host: process.env.HOST || 'play.f3f5.net',
    port: parseInt(process.env.PORT || '25698', 10), // Port SRV chính thức của f3f5.net
    username: process.env.USERNAME || `M3S_${Math.floor(1000 + Math.random() * 9000)}`,
    authType: process.env.AUTH_TYPE || 'offline',
    version: process.env.MC_VERSION || '1.20.4', // Hỗ trợ dải 1.7.2 - 1.20.4+
    role: process.env.BOT_ROLE || 'SCOUT',
    instanceIndex: parseInt(process.env.BOT_INSTANCE_INDEX || '0', 10),
  },
  network: {
    proxyPool: proxyList,
    socks5Proxy: proxyList.length > 0 ? proxyList[0] : null,
  },
  security: {
    swarmSecret: process.env.SWARM_SECRET,
  },
  authChat: {
    password: process.env.AUTH_PASSWORD || 'M3sSwarmPass2026',
    registerIfNew: process.env.REGISTER_IF_NEW !== 'false',
    delayMs: 2000,
  },
  stealth: {
    brand: process.env.CLIENT_BRAND || 'vanilla',
    minJitterMs: parseInt(process.env.JITTER_MIN || '55', 10),
    maxJitterMs: parseInt(process.env.JITTER_MAX || '95', 10),
    aimStepDurationMs: 25,
    noiseDegree: 0.15,
  },
  thresholds: {
    panicDistance: 16,
    sneakDistance: 32,
    radarScanDistance: 36,
    lowHpThreshold: 14,
    threatEntombScore: 75,
  },
  resource: {
    entityPurgeDistance: 48,
    purgeIntervalMs: 4000,
  },
  reconnect: {
    minWaitMs: 30000,
    maxWaitMs: 75000,
    backoffMultiplier: 1.25,
  },
  blackboard: {
    socketPath: process.env.BLACKBOARD_SOCK || '/tmp/m3s_blackboard.sock',
    heartbeatIntervalMs: 2500,
  },
  logistics: {
    zoneRadius: parseInt(process.env.MINING_ZONE_RADIUS || '24', 10),
    oreFullSlotsThreshold: parseInt(process.env.DISPATCH_ORE_SLOTS || '18', 10),
    safeChestTtlMs: 120000,
  }
};

module.exports = config;
