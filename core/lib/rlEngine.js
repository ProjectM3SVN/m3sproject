/**
 * rlEngine.js - Custom Mineflayer Plugin (Phase 1.4 Hardened)
 * - HMAC-SHA256 Anti-Cheat using dynamic process env secret.
 * - Deep Dormancy Pattern: If bot dies >= 2 times in 1 hour in same area, enters 20-min hibernation.
 * - Catastrophic death penalty (-1000 pts) and Q-table backpropagation.
 */
const crypto = require('crypto');

const ACTIONS = [
  'WANDER_EXP',
  'HARVEST_ORES',
  'UPGRADE_GEAR',
  'SEEK_SHELTER',
  'SNEAK_HIDE'
];

class RLEngine {
  constructor(bot, options = {}) {
    this.bot = bot;
    this.config = options.config || {};
    this.qTable = {};
    
    this.alpha = 0.15;
    this.gamma = 0.85;
    this.epsilon = 0.10;

    this.meritScore = 0;
    this.oresMined = 0;
    this.survivalTicks = 0;
    this.previousHp = 20;

    // Secure Dynamic Secret (Passed from launcher or generated dynamically)
    this.secretSalt = (this.config.security && this.config.security.swarmSecret) || process.env.SWARM_SECRET;

    // Anti-Feeding: Deep Dormancy State
    this.deathHistory = []; // [{ timestamp, pos }]
    this.isDormant = false;
    this.dormantUntil = 0;

    this.lastState = null;
    this.lastActionIdx = 0;

    this._bindEvents();
    this._startSurvivalRewardLoop();
  }

  getDiscreteState() {
    if (!this.bot.entity) return 'DEAD';

    const hp = this.bot.health !== undefined ? this.bot.health : 20;
    const food = this.bot.food !== undefined ? this.bot.food : 20;
    const threatScore = this.bot.threatRadar ? this.bot.threatRadar.getScore() : 0;
    
    const hpBucket = hp > 15 ? 'HP_HIGH' : (hp > 8 ? 'HP_MED' : 'HP_CRIT');
    const foodBucket = food > 14 ? 'FOOD_OK' : 'FOOD_LOW';
    const threatBucket = threatScore > 70 ? 'THREAT_HIGH' : (threatScore > 30 ? 'THREAT_MED' : 'THREAT_LOW');
    
    const pickTier = this.bot.toolProgression ? this.bot.toolProgression.getCurrentToolTier('pickaxe') : 0;
    const tierBucket = `TIER_${pickTier}`;

    return `${hpBucket}|${foodBucket}|${threatBucket}|${tierBucket}`;
  }

  selectAction(state) {
    if (this.isDormant) {
      if (Date.now() < this.dormantUntil) {
        return 'SNEAK_HIDE';
      }
      this.isDormant = false;
      console.log(`[RL DORMANCY] Bot '${this.bot.username}' exited hibernation. Relocating sector...`);
      if (this.bot.swarmLogistics && this.bot.swarmLogistics.handleZoneConflict) {
        this.bot.swarmLogistics.handleZoneConflict();
      }
    }

    if (!this.qTable[state]) {
      this.qTable[state] = new Array(ACTIONS.length).fill(0.0);
    }

    let actionIdx = 0;
    if (Math.random() < this.epsilon) {
      actionIdx = Math.floor(Math.random() * ACTIONS.length);
    } else {
      const qValues = this.qTable[state];
      let maxQ = -Infinity;
      for (let i = 0; i < qValues.length; i++) {
        if (qValues[i] > maxQ) {
          maxQ = qValues[i];
          actionIdx = i;
        }
      }
    }

    this.lastState = state;
    this.lastActionIdx = actionIdx;
    return ACTIONS[actionIdx];
  }

  updateQ(reward) {
    if (!this.lastState) return;

    const nextState = this.getDiscreteState();
    if (!this.qTable[nextState]) {
      this.qTable[nextState] = new Array(ACTIONS.length).fill(0.0);
    }

    const currentQ = this.qTable[this.lastState][this.lastActionIdx];
    const maxNextQ = Math.max(...this.qTable[nextState]);

    this.qTable[this.lastState][this.lastActionIdx] = 
      currentQ + this.alpha * (reward + this.gamma * maxNextQ - currentQ);
  }

  generateMeritProof() {
    const payload = `${this.bot.username}:${this.meritScore}:${this.oresMined}:${this.survivalTicks}`;
    const hmac = crypto.createHmac('sha256', this.secretSalt).update(payload).digest('hex');
    return {
      bot: this.bot.username,
      score: this.meritScore,
      oresMined: this.oresMined,
      survivalTicks: this.survivalTicks,
      proofHash: hmac
    };
  }

  _bindEvents() {
    this.bot.on('death', () => {
      const now = Date.now();
      const deathPos = this.bot.entity ? this.bot.entity.position.floored() : null;

      const penalty = -1000;
      this.meritScore = Math.max(-5000, this.meritScore + penalty);
      this.updateQ(-50);
      console.warn(`[RL PENALTY] Bot '${this.bot.username}' DIED! -1000 Merit Points. Current Score: ${this.meritScore}`);

      // Check Deep Dormancy condition: >= 2 deaths in 1 hour within 80m
      if (deathPos) {
        this.deathHistory = this.deathHistory.filter(d => now - d.timestamp < 3600000);
        const nearDeaths = this.deathHistory.filter(d => d.pos.distanceTo(deathPos) < 80);

        if (nearDeaths.length >= 1) {
          // Trigger Deep Dormancy (20 minutes)
          this.isDormant = true;
          this.dormantUntil = now + (20 * 60 * 1000);
          console.warn(`[DEEP DORMANCY TRIGGERED] Bot '${this.bot.username}' died twice in zone! Hibernating for 20 minutes to prevent hunter farming.`);
          
          // Sneak and stay still
          this.bot.setControlState('sprint', false);
          this.bot.setControlState('sneak', true);
          if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
            this.bot.pathfinder.stop();
          }
        }
        this.deathHistory.push({ timestamp: now, pos: deathPos });
      }

      if (this.bot.swarmBus && this.bot.swarmBus.reportScoreUpdate) {
        this.bot.swarmBus.reportScoreUpdate(this.generateMeritProof());
      }
    });

    this.bot.on('health', () => {
      const hp = this.bot.health || 20;
      const drop = this.previousHp - hp;
      if (drop > 0) {
        this.updateQ(-drop * 2);
        this.meritScore -= drop * 5;
      }
      this.previousHp = hp;
    });
  }

  _startSurvivalRewardLoop() {
    setInterval(() => {
      if (!this.bot.entity || (this.bot.health !== undefined && this.bot.health <= 0)) return;

      this.survivalTicks++;
      this.meritScore += 1;
      this.updateQ(0.5);

      if (this.survivalTicks % 6 === 0 && this.bot.swarmBus && this.bot.swarmBus.reportScoreUpdate) {
        this.bot.swarmBus.reportScoreUpdate(this.generateMeritProof());
      }
    }, 10000);
  }

  rewardOreMined(oreType) {
    let reward = 5;
    let merit = 10;
    if (oreType.includes('diamond')) {
      reward = 30;
      merit = 100;
    } else if (oreType.includes('iron') || oreType.includes('gold')) {
      reward = 15;
      merit = 35;
    }
    this.oresMined++;
    this.meritScore += merit;
    this.updateQ(reward);
  }

  rewardToolCrafted(tier) {
    const merit = tier * 40;
    this.meritScore += merit;
    this.updateQ(tier * 10);
  }
}

function rlEnginePlugin(bot, options = {}) {
  bot.rl = new RLEngine(bot, options);
}

module.exports = rlEnginePlugin;
