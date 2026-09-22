/**
 * stealthEngine.js - Custom Mineflayer Plugin
 * - Intercepts client brand to mimic Vanilla or Fabric client.
 * - Anti-Snap spherical Linear Interpolation (Lerp) with ±0.15° micro-noise.
 * - Wraps placeBlock, dig, activateBlock in randomized jitter (45ms to 85ms).
 */

function stealthEnginePlugin(bot, options = {}) {
  const config = options.config || {};
  const brand = (config.stealth && config.stealth.brand) || 'vanilla';
  const minJitter = (config.stealth && config.stealth.minJitterMs) || 45;
  const maxJitter = (config.stealth && config.stealth.maxJitterMs) || 85;
  const aimStepDuration = (config.stealth && config.stealth.aimStepDurationMs) || 25;
  const noiseRad = (((config.stealth && config.stealth.noiseDegree) || 0.15) * Math.PI) / 180;

  let isLooking = false;

  // 1. Brand Spoofing
  bot._client.on('login', () => {
    try {
      const channel = bot._client.version && bot._client.version >= '1.13'
        ? 'minecraft:brand'
        : 'MC|Brand';

      bot._client.write('custom_payload', {
        channel: channel,
        data: Buffer.concat([
          Buffer.from([brand.length]),
          Buffer.from(brand, 'utf8')
        ])
      });
    } catch {
      // Handshake version compatibility fallback
    }
  });

  // 2. Action Packet Jitter Delay
  async function actionJitter() {
    const delay = Math.floor(minJitter + Math.random() * (maxJitter - minJitter));
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // 3. Aim Smoothing (Stepped Spherical Lerp with micro-jitter)
  async function smoothLook(targetYaw, targetPitch, durationMs = 240) {
    if (isLooking) return;
    if (!bot.entity) return;
    isLooking = true;

    const startYaw = bot.entity.yaw;
    const startPitch = bot.entity.pitch;

    let deltaYaw = ((targetYaw - startYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    const deltaPitch = targetPitch - startPitch;

    const steps = Math.max(3, Math.floor(durationMs / aimStepDuration));
    const stepInterval = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      if (!bot.entity) break;

      const progress = i / steps;
      // Cubic ease-out
      const ease = 1 - Math.pow(1 - progress, 3);

      const jitterY = (Math.random() - 0.5) * 2 * noiseRad * (1 - progress * 0.5);
      const jitterP = (Math.random() - 0.5) * 2 * noiseRad * (1 - progress * 0.5);

      const curYaw = startYaw + deltaYaw * ease + jitterY;
      const curPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, startPitch + deltaPitch * ease + jitterP));

      await bot.look(curYaw, curPitch, true);
      await new Promise(r => setTimeout(r, stepInterval));
    }

    if (bot.entity) {
      await bot.look(targetYaw, targetPitch, true);
    }
    isLooking = false;
  }

  async function smoothLookAt(targetVec3, durationMs = 240) {
    if (!bot.entity || !targetVec3) return;
    const eyePos = bot.entity.position.offset(0, bot.entity.height, 0);
    const delta = targetVec3.minus(eyePos);

    const yaw = Math.atan2(-delta.x, -delta.z);
    const groundDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
    const pitch = Math.atan2(delta.y, groundDist);

    await smoothLook(yaw, pitch, durationMs);
  }

  // 4. Wrap critical block actions with jitter & aim validation
  const originalPlaceBlock = bot.placeBlock ? bot.placeBlock.bind(bot) : null;
  const originalDig = bot.dig ? bot.dig.bind(bot) : null;
  const originalActivateBlock = bot.activateBlock ? bot.activateBlock.bind(bot) : null;

  if (originalPlaceBlock) {
    bot.placeBlock = async function (referenceBlock, faceVector) {
      await actionJitter();
      return originalPlaceBlock(referenceBlock, faceVector);
    };
  }

  if (originalDig) {
    bot.dig = async function (block, forceLook) {
      await actionJitter();
      return originalDig(block, forceLook);
    };
  }

  if (originalActivateBlock) {
    bot.activateBlock = async function (block) {
      await actionJitter();
      return originalActivateBlock(block);
    };
  }

  bot.stealth = {
    actionJitter,
    smoothLook,
    smoothLookAt,
  };
}

module.exports = stealthEnginePlugin;
