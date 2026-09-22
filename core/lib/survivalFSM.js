/**
 * survivalFSM.js - Custom Mineflayer Plugin (Phase 1.1 Extended)
 * Finite State Machine managing:
 * - IDLE_EXPLORE: Natural wandering with pauses.
 * - EAT: Retreats 3 blocks, consumes food from hotbar/inventory, restores prior item.
 * - BASIC_HARVEST: Obtains logs/cobblestone & checks tool progression triggers.
 */
const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;

const FSM_STATES = {
  IDLE_EXPLORE: 'IDLE_EXPLORE',
  EAT: 'EAT',
  BASIC_HARVEST: 'BASIC_HARVEST',
  SUSPENDED: 'SUSPENDED'
};

const NOURISHING_FOODS = new Set([
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'baked_potato', 'bread', 'apple',
  'golden_carrot', 'golden_apple', 'carrot'
]);

function survivalFSMPlugin(bot, options = {}) {
  const config = options.config || {};
  const thresholds = config.thresholds || {};
  const lowHp = thresholds.lowHpThreshold || 14;

  let currentState = FSM_STATES.IDLE_EXPLORE;
  let isRunning = false;
  let fsmTimer = null;
  let lastHeldItemSlot = null;

  function startFSM() {
    isRunning = true;
    runFsmCycle();
  }

  function stopFSM() {
    isRunning = false;
    if (fsmTimer) clearTimeout(fsmTimer);
  }

  async function runFsmCycle() {
    if (!isRunning) return;

    // If entombed by threatRadar, suspend normal wandering
    if (bot.threatRadar && bot.threatRadar.isEntombed()) {
      currentState = FSM_STATES.SUSPENDED;
      fsmTimer = setTimeout(runFsmCycle, 1500);
      return;
    }

    try {
      evaluateTransitions();
      await executeState();
    } catch (err) {
      console.error('[SURVIVAL FSM Exception]', err.message);
    }

    if (isRunning) {
      const delay = Math.floor(700 + Math.random() * 500);
      fsmTimer = setTimeout(runFsmCycle, delay);
    }
  }

  function evaluateTransitions() {
    const food = bot.food !== undefined ? bot.food : 20;
    const hp = bot.health !== undefined ? bot.health : 20;

    // 1. Need Food
    if (food <= 14 || hp <= lowHp) {
      const availableFood = bot.inventory.items().find(i => NOURISHING_FOODS.has(i.name));
      if (availableFood) {
        currentState = FSM_STATES.EAT;
        return;
      }
    }

    // 2. Tool Tier Progression Check (Phase 1.1)
    if (bot.toolProgression) {
      const pickTier = bot.toolProgression.getCurrentToolTier('pickaxe');
      if (pickTier < 2) { // Less than stone pickaxe
        currentState = FSM_STATES.BASIC_HARVEST;
        return;
      }
    }

    // Default
    currentState = FSM_STATES.IDLE_EXPLORE;
  }

  async function executeState() {
    switch (currentState) {
      case FSM_STATES.EAT:
        await handleEat();
        break;
      case FSM_STATES.BASIC_HARVEST:
        await handleHarvest();
        break;
      case FSM_STATES.IDLE_EXPLORE:
      default:
        await handleExplore();
        break;
    }
  }

  async function handleEat() {
    const foodItem = bot.inventory.items().find(i => NOURISHING_FOODS.has(i.name));
    if (!foodItem) {
      currentState = FSM_STATES.IDLE_EXPLORE;
      return;
    }

    // 1. Retreat 3 blocks backward
    if (bot.entity && bot.pathfinder) {
      const yaw = bot.entity.yaw;
      const retreatVec = new Vec3(Math.sin(yaw) * 3, 0, Math.cos(yaw) * 3);
      const retreatGoal = bot.entity.position.plus(retreatVec).floored();
      try {
        bot.pathfinder.setGoal(new goals.GoalNear(retreatGoal.x, retreatGoal.y, retreatGoal.z, 1));
        await new Promise(r => setTimeout(r, 600));
        bot.pathfinder.stop();
      } catch {
        // Fallback
      }
    }

    lastHeldItemSlot = bot.quickBarSlot;

    try {
      await bot.equip(foodItem, 'hand');
      if (bot.stealth && bot.stealth.actionJitter) {
        await bot.stealth.actionJitter();
      }

      if (bot.stealth && bot.stealth.smoothLook && bot.entity) {
        await bot.stealth.smoothLook(bot.entity.yaw, 0.35, 180);
      }

      await bot.consume();

      if (lastHeldItemSlot !== null && bot.setQuickBarSlot) {
        bot.setQuickBarSlot(lastHeldItemSlot);
      }
    } catch {
      // Interrupted
    }
  }

  async function handleHarvest() {
    const targets = ['oak_log', 'birch_log', 'spruce_log', 'cobblestone', 'stone', 'dirt'];
    const block = bot.findBlock({
      matching: (b) => targets.includes(b.name),
      maxDistance: 7
    });

    if (block && bot.canDigBlock(block)) {
      try {
        if (bot.stealth && bot.stealth.smoothLookAt) {
          await bot.stealth.smoothLookAt(block.position.offset(0.5, 0.5, 0.5), 250);
        }
        await bot.dig(block);

        // Check if we can upgrade tools now
        if (bot.toolProgression && bot.toolProgression.checkAndUpgradeTools) {
          await bot.toolProgression.checkAndUpgradeTools();
        }
      } catch {
        // Fallback
      }
    } else {
      await handleExplore();
    }
  }

  async function handleExplore() {
    if (!bot.entity || !bot.pathfinder) return;

    if (Math.random() < 0.12) {
      const pauseYaw = bot.entity.yaw + (Math.random() - 0.5) * 1.4;
      const pausePitch = (Math.random() - 0.5) * 0.3;
      if (bot.stealth && bot.stealth.smoothLook) {
        await bot.stealth.smoothLook(pauseYaw, pausePitch, 350);
      }
      await new Promise(r => setTimeout(r, Math.floor(1200 + Math.random() * 1500)));
      return;
    }

    if (!bot.pathfinder.isMoving()) {
      const radius = 7 + Math.random() * 8;
      const angle = Math.random() * Math.PI * 2;
      const targetX = Math.floor(bot.entity.position.x + radius * Math.cos(angle));
      const targetZ = Math.floor(bot.entity.position.z + radius * Math.sin(angle));
      const targetY = Math.floor(bot.entity.position.y);

      if (bot.stealth && bot.stealth.smoothLookAt) {
        await bot.stealth.smoothLookAt(new Vec3(targetX, targetY + 1.6, targetZ), 260);
      }

      bot.pathfinder.setGoal(new goals.GoalNear(targetX, targetY, targetZ, 1));
    }
  }

  bot.once('spawn', startFSM);
  bot.once('end', stopFSM);

  bot.survivalFSM = {
    getState: () => currentState,
    startFSM,
    stopFSM
  };
}

module.exports = survivalFSMPlugin;
