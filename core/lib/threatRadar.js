/**
 * threatRadar.js - Custom Mineflayer Plugin (Phase 1.2 Extended)
 * - Scans entities within 36 blocks and scores threat (0-100).
 * - Reports spotted hostiles to the Swarm Blackboard for peer alerts.
 * - Threat > 75: Forces sneak, executes Self-Entomb sequence (casing around footing & overhead).
 * - Quits gracefully if damaged while entombed.
 */
const Vec3 = require('vec3').Vec3;

const HIGH_THREAT_ITEMS = new Set([
  'end_crystal',
  'respawn_anchor',
  'tnt',
  'netherite_sword',
  'diamond_sword',
  'netherite_pickaxe',
  'bow',
  'crossbow',
  'splash_potion'
]);

const LETHAL_SURROUND_ENTITIES = new Set([
  'end_crystal',
  'tnt',
  'tnt_minecart',
  'wither_skull'
]);

function threatRadarPlugin(bot, options = {}) {
  const config = options.config || {};
  const thresholds = config.thresholds || {};
  const scanDistance = thresholds.radarScanDistance || 36;
  const panicDistance = thresholds.panicDistance || 16;
  const sneakDistance = thresholds.sneakDistance || 32;
  const entombScoreThreshold = thresholds.threatEntombScore || 75;

  let currentThreatScore = 0;
  let isEntombed = false;
  let isEntombing = false;
  let scanInterval = null;
  let previousHealth = 20;

  function calculateThreatScore() {
    if (!bot.entity) return 0;
    const botPos = bot.entity.position;
    let maxScore = 0;

    // Scan for lethal entities first (Crystals, TNT)
    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity === bot.entity || !entity.position) continue;
      const name = entity.name ? entity.name.toLowerCase() : '';
      if (LETHAL_SURROUND_ENTITIES.has(name)) {
        const d = botPos.distanceTo(entity.position);
        if (d <= 14) {
          // Report lethal threat to swarm blackboard
          if (bot.blackboard && bot.blackboard.reportThreat) {
            bot.blackboard.reportThreat({
              target: name,
              pos: entity.position,
              weapon: 'EXPLOSIVE_OBJECT'
            });
          }
          return 100;
        }
      }
    }

    // Scan players
    const players = Object.values(bot.entities).filter(
      e => e.type === 'player' && e !== bot.entity && e.position
    );

    for (const player of players) {
      const dist = botPos.distanceTo(player.position);
      if (dist > scanDistance) continue;

      let score = 0;

      // Distance factor (0-50 pts)
      if (dist <= panicDistance) {
        score += 50;
      } else if (dist <= sneakDistance) {
        const factor = (sneakDistance - dist) / (sneakDistance - panicDistance);
        score += Math.round(20 + factor * 30);
      } else {
        score += Math.round(10 * (1 - (dist - sneakDistance) / (scanDistance - sneakDistance)));
      }

      // Equipment inspection (0-50 pts)
      const held = player.heldItem ? player.heldItem.name.toLowerCase() : null;
      if (held) {
        if (HIGH_THREAT_ITEMS.has(held)) {
          score += (held === 'end_crystal' || held === 'respawn_anchor') ? 50 : 35;
        } else if (held.includes('sword') || held.includes('axe') || held.includes('pickaxe')) {
          score += 20;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        // Broadcast high threat player to swarm blackboard
        if (score >= 60 && bot.blackboard && bot.blackboard.reportThreat) {
          bot.blackboard.reportThreat({
            target: player.username || 'unknown_hostile',
            pos: player.position,
            weapon: held || 'bare_hands'
          });
        }
      }
    }

    return Math.min(100, maxScore);
  }

  async function executeSelfEntomb() {
    if (isEntombing || isEntombed || !bot.entity) return;
    isEntombing = true;
    console.warn(`[THREAT RADAR] Threat score ${currentThreatScore} > ${entombScoreThreshold}! Executing Self-Entomb Sequence.`);

    if (bot.pathfinder && bot.pathfinder.isMoving()) {
      bot.pathfinder.stop();
    }
    bot.setControlState('sneak', true);

    const preferredBlocks = ['obsidian', 'crying_obsidian', 'cobblestone', 'cobbled_deepslate', 'dirt', 'netherrack'];
    const itemToPlace = bot.inventory.items().find(i => preferredBlocks.includes(i.name));

    if (!itemToPlace) {
      console.warn('[THREAT RADAR] No building blocks available for entomb casing. Holding sneak.');
      isEntombing = false;
      return;
    }

    try {
      await bot.equip(itemToPlace, 'hand');

      const standingPos = bot.entity.position.floored();
      const targetOffsets = [
        new Vec3(0, 2, 0),  // Overhead roof
        new Vec3(1, 0, 0),  // East
        new Vec3(-1, 0, 0), // West
        new Vec3(0, 0, 1),  // South
        new Vec3(0, 0, -1), // North
        new Vec3(1, 1, 0),  // East upper
        new Vec3(-1, 1, 0), // West upper
        new Vec3(0, 1, 1),  // South upper
        new Vec3(0, 1, -1), // North upper
      ];

      for (const offset of targetOffsets) {
        const placeTarget = standingPos.plus(offset);
        const existingBlock = bot.blockAt(placeTarget);

        if (existingBlock && (existingBlock.boundingBox === 'empty' || existingBlock.name === 'air')) {
          const neighbors = [
            { pos: placeTarget.offset(0, -1, 0), face: new Vec3(0, 1, 0) },
            { pos: placeTarget.offset(0, 1, 0), face: new Vec3(0, -1, 0) },
            { pos: placeTarget.offset(1, 0, 0), face: new Vec3(-1, 0, 0) },
            { pos: placeTarget.offset(-1, 0, 0), face: new Vec3(1, 0, 0) },
            { pos: placeTarget.offset(0, 0, 1), face: new Vec3(0, 0, -1) },
            { pos: placeTarget.offset(0, 0, -1), face: new Vec3(0, 0, 1) },
          ];

          for (const n of neighbors) {
            const refBlock = bot.blockAt(n.pos);
            if (refBlock && refBlock.boundingBox !== 'empty' && refBlock.name !== 'air') {
              if (bot.stealth && bot.stealth.smoothLookAt) {
                await bot.stealth.smoothLookAt(refBlock.position.offset(0.5, 0.5, 0.5), 120);
              }
              try {
                await bot.placeBlock(refBlock, n.face);
              } catch {
                // Placement collision fallback
              }
              break;
            }
          }
        }
      }

      isEntombed = true;
      console.log('[THREAT RADAR] Self-Entomb complete. Fortified inside casing.');
    } catch (err) {
      console.error('[THREAT RADAR] Error during entomb placement:', err.message);
    } finally {
      isEntombing = false;
    }
  }

  function handleHealthChange() {
    const currentHp = bot.health || 20;
    const hpDrop = previousHealth - currentHp;

    if (isEntombed && hpDrop > 0) {
      console.warn(`[THREAT RADAR] Damage sustained (-${hpDrop} HP) while entombed! Initiating emergency exit.`);
      try {
        bot.quit('Emergency Entomb Breach Evacuation');
      } catch {
        bot.end();
      }
    }
    previousHealth = currentHp;
  }

  function startRadar() {
    previousHealth = bot.health || 20;
    bot.on('health', handleHealthChange);

    scanInterval = setInterval(async () => {
      if (!bot.entity) return;
      currentThreatScore = calculateThreatScore();

      if (currentThreatScore > entombScoreThreshold) {
        await executeSelfEntomb();
      } else if (currentThreatScore > 35) {
        bot.setControlState('sneak', true);
      } else if (!isEntombed) {
        bot.setControlState('sneak', false);
      }
    }, 800);
  }

  function stopRadar() {
    if (scanInterval) clearInterval(scanInterval);
    bot.removeListener('health', handleHealthChange);
  }

  bot.once('spawn', startRadar);
  bot.once('end', stopRadar);

  bot.threatRadar = {
    getScore: () => currentThreatScore,
    isEntombed: () => isEntombed,
    executeSelfEntomb,
    stopRadar
  };
}

module.exports = threatRadarPlugin;
