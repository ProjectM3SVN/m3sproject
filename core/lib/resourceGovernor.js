/**
 * resourceGovernor.js - Custom Mineflayer Plugin
 * - Discards heavy non-critical server packets to keep RSS RAM < 50MB.
 * - Aggressive Entity Garbage Collection beyond 48 blocks.
 * - Exposes bot.getTelemetry() for lightweight observability.
 */

function resourceGovernorPlugin(bot, options = {}) {
  const config = options.config || {};
  const maxDistance = (config.resource && config.resource.entityPurgeDistance) || 48;
  const purgeIntervalMs = (config.resource && config.resource.purgeIntervalMs) || 4000;
  const client = bot._client;

  // 1. Packet Listener Stripping
  const discardedPackets = [
    'sound_effect',
    'named_sound_effect',
    'particle',
    'world_particles',
    'level_particles',
    'experience',
    'ambient_sound',
    'explosion'
  ];

  for (const pName of discardedPackets) {
    try {
      client.removeAllListeners(pName);
      client.on(pName, () => {});
    } catch {
      // Protocol version compatibility guard
    }
  }

  // 2. Aggressive Entity Garbage Collector
  const maxDistSq = maxDistance * maxDistance;
  const gcTimer = setInterval(() => {
    if (!bot.entity || !bot.entities) return;
    const botPos = bot.entity.position;

    for (const [id, entity] of Object.entries(bot.entities)) {
      if (!entity || entity === bot.entity) continue;
      // Do not strip player entities (needed by threatRadar)
      if (entity.type === 'player') continue;

      if (entity.position) {
        const distSq = botPos.distanceSquared(entity.position);
        if (distSq > maxDistSq) {
          delete bot.entities[id];
        }
      }
    }
  }, purgeIntervalMs);

  bot.once('end', () => clearInterval(gcTimer));

  // 3. Lightweight State Serialization
  bot.getTelemetry = function () {
    const pos = bot.entity ? bot.entity.position : null;
    return {
      username: bot.username,
      position: pos ? { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) } : null,
      health: bot.health || 0,
      food: bot.food || 0,
      activeThreatLevel: bot.threatRadar ? bot.threatRadar.getScore() : 0,
      isEntombed: bot.threatRadar ? bot.threatRadar.isEntombed : false,
      fsmState: bot.survivalFSM ? bot.survivalFSM.getState() : 'UNINITIALIZED',
      rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1))
    };
  };
}

module.exports = resourceGovernorPlugin;
