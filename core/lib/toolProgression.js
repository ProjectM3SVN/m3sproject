/**
 * toolProgression.js - Custom Mineflayer Plugin (Phase 1.1)
 * Manages tool crafting lifecycle:
 * - Wood -> Stone -> Iron tool tiers (Pickaxe, Axe, Sword).
 * - Handles Planks -> Sticks -> Crafting Table creation and placement.
 * - Places crafting table nearby when needed, crafts recipes, and re-collects table.
 */
const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;

const TOOL_TIERS = {
  WOOD: 1,
  STONE: 2,
  IRON: 3
};

function toolProgressionPlugin(bot, options = {}) {
  const mcData = require('minecraft-data')(bot.version);
  let isCrafting = false;

  function getCurrentToolTier(toolType = 'pickaxe') {
    const items = bot.inventory.items();
    if (items.some(i => i.name === `iron_${toolType}`)) return TOOL_TIERS.IRON;
    if (items.some(i => i.name === `stone_${toolType}`)) return TOOL_TIERS.STONE;
    if (items.some(i => i.name === `wooden_${toolType}`)) return TOOL_TIERS.WOOD;
    return 0;
  }

  function countItem(name) {
    return bot.inventory.items()
      .filter(i => i.name === name || (name === 'planks' && i.name.endsWith('_planks')) || (name === 'log' && (i.name.endsWith('_log') || i.name.endsWith('_wood'))))
      .reduce((acc, cur) => acc + cur.count, 0);
  }

  async function craftRecipe(recipeName, count = 1, craftingTableBlock = null) {
    const recipeItem = mcData.itemsByName[recipeName];
    if (!recipeItem) {
      console.warn(`[TOOL PROGRESSION] Unknown recipe item: ${recipeName}`);
      return false;
    }

    const recipes = bot.recipesFor(recipeItem.id, null, 1, craftingTableBlock);
    if (!recipes || recipes.length === 0) {
      return false;
    }

    try {
      if (bot.stealth && bot.stealth.actionJitter) {
        await bot.stealth.actionJitter();
      }
      await bot.craft(recipes[0], count, craftingTableBlock);
      return true;
    } catch (err) {
      console.error(`[TOOL PROGRESSION] Error crafting ${recipeName}:`, err.message);
      return false;
    }
  }

  async function ensurePlanks(minPlanks = 4) {
    if (countItem('planks') >= minPlanks) return true;

    const logItem = bot.inventory.items().find(i => i.name.endsWith('_log') || i.name.endsWith('_wood'));
    if (!logItem) return false;

    // Convert 1-2 logs into planks (2x2 inventory crafting)
    const plankItemName = logItem.name.replace(/_log|_wood/, '_planks');
    return await craftRecipe(plankItemName, 1, null);
  }

  async function ensureSticks(minSticks = 4) {
    if (countItem('stick') >= minSticks) return true;
    if (countItem('planks') < 2) {
      const ok = await ensurePlanks(2);
      if (!ok) return false;
    }
    return await craftRecipe('stick', 1, null);
  }

  async function withCraftingTable(actionFn) {
    // 1. Check if a crafting table is already placed within 4 blocks
    let tableBlock = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 4
    });

    let placedTable = false;
    let placedTablePos = null;

    if (!tableBlock) {
      // 2. Check if we have a table in inventory
      let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

      if (!tableItem) {
        // Need to craft crafting_table in 2x2
        await ensurePlanks(4);
        const crafted = await craftRecipe('crafting_table', 1, null);
        if (!crafted) return false;
        tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
      }

      if (!tableItem) return false;

      // 3. Place crafting table on solid ground adjacent to bot
      const groundPos = bot.entity.position.floored().offset(1, -1, 0);
      const targetPos = bot.entity.position.floored().offset(1, 0, 0);
      const groundBlock = bot.blockAt(groundPos);
      const targetBlock = bot.blockAt(targetPos);

      if (groundBlock && groundBlock.boundingBox !== 'empty' && targetBlock && targetBlock.boundingBox === 'empty') {
        try {
          await bot.equip(tableItem, 'hand');
          if (bot.stealth && bot.stealth.smoothLookAt) {
            await bot.stealth.smoothLookAt(groundPos.offset(0.5, 0.5, 0.5), 180);
          }
          await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
          placedTable = true;
          placedTablePos = targetPos;
          tableBlock = bot.blockAt(targetPos);
        } catch {
          return false;
        }
      } else {
        return false;
      }
    }

    if (!tableBlock) return false;

    // Run the crafting actions
    let result = false;
    try {
      result = await actionFn(tableBlock);
    } finally {
      // 4. Re-collect placed table if we put it down
      if (placedTable && placedTablePos) {
        const blk = bot.blockAt(placedTablePos);
        if (blk && blk.name === 'crafting_table' && bot.canDigBlock(blk)) {
          try {
            if (bot.stealth && bot.stealth.smoothLookAt) {
              await bot.stealth.smoothLookAt(placedTablePos.offset(0.5, 0.5, 0.5), 180);
            }
            await bot.dig(blk);
          } catch {
            // Ignore if interrupted
          }
        }
      }
    }

    return result;
  }

  async function checkAndUpgradeTools() {
    if (isCrafting || !bot.entity) return;
    isCrafting = true;

    try {
      const pickTier = getCurrentToolTier('pickaxe');

      // TIER 1: Upgrade to Wooden Pickaxe
      if (pickTier < TOOL_TIERS.WOOD) {
        if (countItem('planks') < 3 && countItem('log') > 0) {
          await ensurePlanks(3);
        }
        if (countItem('planks') >= 3) {
          await ensureSticks(2);
          await withCraftingTable(async (table) => {
            return await craftRecipe('wooden_pickaxe', 1, table);
          });
        }
      }
      // TIER 2: Upgrade to Stone Pickaxe/Sword/Axe
      else if (pickTier < TOOL_TIERS.STONE) {
        const cobbleCount = countItem('cobblestone') + countItem('cobbled_deepslate');
        if (cobbleCount >= 3) {
          await ensureSticks(2);
          await withCraftingTable(async (table) => {
            await craftRecipe('stone_pickaxe', 1, table);
            if (cobbleCount >= 5) await craftRecipe('stone_sword', 1, table);
            if (cobbleCount >= 8) await craftRecipe('stone_axe', 1, table);
            return true;
          });
        }
      }
      // TIER 3: Check Iron Pickaxe
      else if (pickTier < TOOL_TIERS.IRON) {
        const ironCount = countItem('iron_ingot');
        if (ironCount >= 3) {
          await ensureSticks(2);
          await withCraftingTable(async (table) => {
            await craftRecipe('iron_pickaxe', 1, table);
            if (ironCount >= 5) await craftRecipe('iron_sword', 1, table);
            return true;
          });
        }
      }
    } catch (err) {
      console.error('[TOOL PROGRESSION Exception]', err.message);
    } finally {
      isCrafting = false;
    }
  }

  bot.toolProgression = {
    getCurrentToolTier,
    checkAndUpgradeTools,
    withCraftingTable,
    craftRecipe
  };
}

module.exports = toolProgressionPlugin;
