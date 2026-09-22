/**
 * swarmLogistics.js - Custom Mineflayer Plugin (Phase 1.4 Hardened)
 * 
 * Hardening:
 * 1. ZERO STDOUT COORDINATE LEAK: Coordinates of transfer chests are strictly kept in-memory
 *    and transmitted via Unix Domain Socket only. Zero console.log of raw coordinates.
 * 2. AUTOMATIC TRACE CLEANUP: Courier breaks the transfer chest and picks it up immediately
 *    after withdrawing ores. Defeats Storage ESP radar mods of opponent base hunters.
 */
const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;

const VALUABLE_ORES = new Set([
  'raw_iron', 'iron_ingot', 'raw_gold', 'gold_ingot',
  'raw_copper', 'copper_ingot', 'diamond', 'coal',
  'lapis_lazuli', 'redstone', 'emerald', 'ancient_debris'
]);

function swarmLogisticsPlugin(bot, options = {}) {
  const config = options.config || {};
  const logisticsConfig = config.logistics || {};
  const zoneRadius = logisticsConfig.zoneRadius || 24;
  const oreFullThreshold = logisticsConfig.oreFullSlotsThreshold || 18;

  let hiddenChestPos = null;
  let isAwaitingCourier = false;
  let currentMission = null;

  function handleZoneConflict() {
    if (!bot.entity || !bot.pathfinder) return;

    const angle = Math.random() * Math.PI * 2;
    const offsetDist = 60;
    const newX = Math.floor(bot.entity.position.x + Math.cos(angle) * offsetDist);
    const newZ = Math.floor(bot.entity.position.z + Math.sin(angle) * offsetDist);

    console.log('[LOGISTICS] Relocating to non-overlapping mining sector...');
    bot.pathfinder.setGoal(new goals.GoalXZ(newX, newZ));

    setTimeout(() => {
      if (bot.entity && bot.swarmBus) {
        bot.swarmBus.claimZone(bot.entity.position.floored(), zoneRadius);
      }
    }, 15000);
  }

  async function checkMinerOreSaturation() {
    if (bot.swarmBus && bot.swarmBus.getRole() !== 'MINER') return;
    if (isAwaitingCourier || !bot.entity) return;

    const items = bot.inventory.items();
    const oreCount = items.filter(i => VALUABLE_ORES.has(i.name)).length;

    if (oreCount >= oreFullThreshold) {
      console.warn(`[MINER LOGISTICS] Ore inventory nearing capacity (${oreCount}/${oreFullThreshold} slots). Initiating stealth courier request.`);
      await prepareTransferChestAndRequest();
    }
  }

  async function prepareTransferChestAndRequest() {
    let chestBlock = bot.findBlock({
      matching: (b) => b.name === 'chest',
      maxDistance: 4
    });

    if (!chestBlock) {
      const chestItem = bot.inventory.items().find(i => i.name === 'chest');
      if (chestItem) {
        const placeBase = bot.entity.position.floored().offset(1, -1, 0);
        const refBlock = bot.blockAt(placeBase);
        if (refBlock && refBlock.boundingBox !== 'empty') {
          try {
            await bot.equip(chestItem, 'hand');
            await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
            chestBlock = bot.blockAt(placeBase.offset(0, 1, 0));
          } catch {}
        }
      }
    }

    if (chestBlock) {
      hiddenChestPos = chestBlock.position;
      try {
        const chest = await bot.openChest(chestBlock);
        const ores = bot.inventory.items().filter(i => VALUABLE_ORES.has(i.name));
        for (const ore of ores) {
          try {
            await chest.deposit(ore.type, null, ore.count);
          } catch {}
        }
        chest.close();
        // Silent success - NO console.log of coordinates
        console.log('[MINER LOGISTICS] Stashed ores into secret transfer container.');
      } catch (err) {
        console.error('[MINER LOGISTICS] Container deposit error:', err.message);
      }
    }

    isAwaitingCourier = true;
    if (bot.swarmBus) {
      // Dispatched purely over local Unix Domain Socket
      bot.swarmBus.requestCourier(hiddenChestPos || bot.entity.position.floored());
    }
  }

  function onCourierOffloadDone() {
    isAwaitingCourier = false;
    hiddenChestPos = null;
    console.log('[MINER LOGISTICS] Transfer verified. Resuming extraction.');
  }

  // Courier: Execute Mission + Trace Deletion (Break Chest)
  async function executeCourierMission(minerName, destination) {
    if (currentMission) return;
    currentMission = { minerName, destination };

    console.log(`[COURIER RUN] Moving to secret transfer point for miner '${minerName}'`);
    bot.pathfinder.setGoal(new goals.GoalNear(destination.x, destination.y, destination.z, 2));

    const checkArrival = setInterval(async () => {
      if (!bot.entity) {
        clearInterval(checkArrival);
        return;
      }

      const dist = bot.entity.position.distanceTo(destination);
      if (dist <= 3.5) {
        clearInterval(checkArrival);
        bot.pathfinder.stop();

        const chestBlock = bot.findBlock({
          matching: (b) => b.name === 'chest',
          maxDistance: 5
        });

        if (chestBlock) {
          try {
            console.log('[COURIER RUN] Transfer point reached. Withdrawing cargo...');
            const chest = await bot.openChest(chestBlock);
            for (const item of chest.containerItems()) {
              try {
                await chest.withdraw(item.type, null, item.count);
              } catch {}
            }
            chest.close();
            console.log('[COURIER RUN] Cargo secured.');

            // Trace Deletion: Break and collect the transfer chest (Anti-ESP)
            if (bot.canDigBlock(chestBlock)) {
              if (bot.stealth && bot.stealth.smoothLookAt) {
                await bot.stealth.smoothLookAt(chestBlock.position.offset(0.5, 0.5, 0.5), 180);
              }
              await bot.dig(chestBlock);
              console.log('[COURIER TRACE-CLEANUP] Transfer container dismantled and collected. Anti-ESP clean.');
            }
          } catch (err) {
            console.error('[COURIER ERROR] Error clearing transfer point:', err.message);
          }
        }

        if (bot.swarmBus) {
          bot.swarmBus.reportCourierComplete(minerName);
        }
        currentMission = null;
      }
    }, 1500);
  }

  bot.once('spawn', () => {
    setTimeout(() => {
      if (bot.entity && bot.swarmBus && bot.swarmBus.getRole() === 'MINER') {
        bot.swarmBus.claimZone(bot.entity.position.floored(), zoneRadius);
      }
    }, 5000);

    setInterval(checkMinerOreSaturation, 10000);
  });

  bot.swarmLogistics = {
    handleZoneConflict,
    checkMinerOreSaturation,
    onCourierOffloadDone,
    executeCourierMission,
    isAwaitingCourier: () => isAwaitingCourier
  };
}

module.exports = swarmLogisticsPlugin;
