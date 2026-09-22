/**
 * slmBrainBridge.js - Custom Mineflayer Plugin (Phase 1.2)
 * Connects MSNPC to a local quantized Small Language Model (Qwen2.5-0.5B-Instruct via Ollama)
 * - Asynchronous HTTP calls using Node native http/fetch (no heavy Axios or SDK bloatware).
 * - Social Camouflage: Generates short, lowercase, casual Minecraft player chat replies.
 * - Dynamic Macro-Planning: Generates situational high-level guidance for survival and exploration.
 * - Rate-limited & guarded to never block the Mineflayer event loop or spike RAM.
 */
const http = require('http');
const url = require('url');

const CHAT_SYSTEM_PROMPT = `You are a real player on an unmoderated Minecraft Anarchy server.
Rules:
- Respond in 1 very short sentence or a few words.
- All lowercase, casual tone, occasional slight typos or gamer slang (e.g. "yo", "nah", "lagging", "who r u", "idk").
- Never mention you are an AI, bot, or automated script.
- If asked where your base is, say you're wandering or somewhere far away.`;

function slmBrainBridgePlugin(bot, options = {}) {
  const config = options.config || {};
  const slmConfig = config.slm || {};
  const endpoint = slmConfig.endpoint || 'http://127.0.0.1:11434';
  const model = slmConfig.model || 'qwen2.5:0.5b-instruct';
  const timeoutMs = slmConfig.requestTimeoutMs || 5000;
  const chatProb = slmConfig.chatProbability !== undefined ? slmConfig.chatProbability : 0.35;
  const cooldownMs = slmConfig.cooldownMs || 8000;

  let lastChatReplyTime = 0;
  let isGenerating = false;

  const parsedUrl = url.parse(`${endpoint}/api/generate`);

  function querySLM(prompt, systemPrompt = '') {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: model,
        prompt: prompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 32,      // Enforce ultra-short responses to guarantee < 150ms inference
          num_ctx: 512          // Minimal context window for low RAM footprint
        }
      });

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      };

      const req = http.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed.response ? parsed.response.trim() : '');
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('SLM inference request timed out'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  // 1. Social Camouflage Chat Listener
  function bindChatListener() {
    bot.on('chat', async (sender, message) => {
      if (sender === bot.username) return;

      const now = Date.now();
      if (now - lastChatReplyTime < cooldownMs) return;
      if (isGenerating) return;

      const msgLower = message.toLowerCase();
      const botNameLower = bot.username.toLowerCase();
      const isMentioned = msgLower.includes(botNameLower);

      // Reply if directly mentioned or random casual probability
      if (!isMentioned && Math.random() > chatProb) return;

      isGenerating = true;
      lastChatReplyTime = now;

      try {
        const reply = await querySLM(
          `Player "${sender}" says: "${message}". Reply casually to them.`,
          CHAT_SYSTEM_PROMPT
        );

        if (reply && reply.length > 0 && reply.length < 80) {
          // Clean quotes and linebreaks
          const cleaned = reply.replace(/["\n\r]/g, '').toLowerCase();

          // Human-like typing delay (1.5s - 3s)
          const typingDelay = Math.floor(1500 + Math.random() * 1500);
          setTimeout(() => {
            if (bot._client && bot._client.state === 'play') {
              bot.chat(cleaned);
              console.log(`[SLM CHAT CAMOUFLAGE] Replied to ${sender}: "${cleaned}"`);
            }
          }, typingDelay);
        }
      } catch (err) {
        // Silently log; never crash or block event loop
        // console.debug('[SLM CHAT SKIPPED]', err.message);
      } finally {
        isGenerating = false;
      }
    });
  }

  // 2. Dynamic Macro-Planning Query
  async function getMacroGuidance(telemetry) {
    if (isGenerating) return null;
    isGenerating = true;

    try {
      const prompt = `Bot status: Health=${telemetry.health}/20, Food=${telemetry.food}/20, ThreatScore=${telemetry.activeThreatLevel}. What single priority action should be taken? Options: SURVIVE_RETREAT, GATHER_FOOD, UPGRADE_GEAR, EXPLORE_WANDER.`;
      const system = `Respond with ONLY one word from the options list.`;
      const result = await querySLM(prompt, system);
      return result ? result.toUpperCase().replace(/[^A-Z_]/g, '') : null;
    } catch {
      return null;
    } finally {
      isGenerating = false;
    }
  }

  bot.once('spawn', bindChatListener);

  bot.slmBrain = {
    querySLM,
    getMacroGuidance,
    isAvailable: () => !isGenerating
  };
}

module.exports = slmBrainBridgePlugin;
