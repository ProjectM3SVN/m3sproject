/**
 * inventoryPurge.js - Custom Mineflayer Plugin (Phase 1.1)
 * Aggressively purges inventory garbage on Anarchy servers:
 * - Drops useless junk (seeds, poisonous potato, dirt overflow, flowers, rotten flesh, etc.)
 * - Keeps essential items (tools, food, building blocks, valuable ores, crystals).
 * - Avoids inventory saturation to ensure bot always has space for tools & survival blocks.
 */

const JUNK_ITEMS = new Set([
  'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'poisonous_potato', 'rotten_flesh', 'spider_eye',
  'gravel', 'flint', 'andesite', 'diorite', 'granite', 'tuff',
  'string', 'bone', 'feather', 'glass_bottle', 'bowl'
]);

function inventoryPurgePlugin(bot, options = {}) {
  let isPurging = false;

  async function purgeGarbage() {
    if (isPurging || !bot.inventory) return;
    isPurging = true;

    try {
      const items = bot.inventory.items();
      let dirtCount = 0;
      let cobbleCount = 0;

      for (const item of items) {
        let shouldToss = false;

        // 1. Direct Junk
        if (JUNK_ITEMS.has(item.name)) {
          shouldToss = true;
        }
        // 2. Dirt saturation (> 64 blocks is redundant)
        else if (item.name === 'dirt' || item.name === 'grass_block') {
          dirtCount += item.count;
          if (dirtCount > 64) shouldToss = true;
        }
        // 3. Cobblestone saturation (> 128 blocks)
        else if (item.name === 'cobblestone' || item.name === 'cobbled_deepslate') {
          cobbleCount += item.count;
          if (cobbleCount > 128) shouldToss = true;
        }

        if (shouldToss) {
          try {
            if (bot.stealth && bot.stealth.actionJitter) {
              await bot.stealth.actionJitter();
            }
            await bot.toss(item.type, null, item.count);
          } catch {
            // Drop interrupted
          }
        }
      }
    } catch (err) {
      console.error('[INVENTORY PURGE Exception]', err.message);
    } finally {
      isPurging = false;
    }
  }

  // Hook periodic check
  let purgeTimer = null;
  bot.once('spawn', () => {
    purgeTimer = setInterval(purgeGarbage, 12000); // Check every 12s
  });

  bot.once('end', () => {
    if (purgeTimer) clearInterval(purgeTimer);
  });

  bot.inventoryPurge = {
    purgeGarbage
  };
}

module.exports = inventoryPurgePlugin;
