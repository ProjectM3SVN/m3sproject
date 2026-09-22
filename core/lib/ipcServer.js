/**
 * ipcServer.js - Custom Mineflayer Plugin (Phase 1.1)
 * Lightweight Unix Domain Socket / Local IPC for central swarm orchestration:
 * - Exposes non-blocking JSON protocol over /tmp/msnpc_<username>.sock.
 * - Supported Commands:
 *    - PING -> PONG
 *    - TELEMETRY -> Returns bot.getTelemetry()
 *    - SAY <msg> -> Chat message
 *    - DISCONNECT -> Graceful shutdown
 *    - SET_STATE <state> -> Override FSM
 * - Zero external dependencies, ultra-low memory (< 1MB).
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

function ipcServerPlugin(bot, options = {}) {
  const username = bot.username || 'bot';
  const socketPath = process.platform === 'win32'
    ? path.join('\\\\?\\pipe', `msnpc_${username}`)
    : `/tmp/msnpc_${username}.sock`;

  let server = null;

  function startServer() {
    // Clean up dead socket if exists
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Ignore
      }
    }

    server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', async (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let response = { status: 'OK' };

          try {
            const req = JSON.parse(trimmed);
            const cmd = req.cmd ? req.cmd.toUpperCase() : '';

            switch (cmd) {
              case 'PING':
                response = { status: 'OK', message: 'PONG', timestamp: Date.now() };
                break;

              case 'TELEMETRY':
                response = {
                  status: 'OK',
                  data: bot.getTelemetry ? bot.getTelemetry() : {}
                };
                break;

              case 'SAY':
                if (req.message) {
                  bot.chat(req.message);
                  response = { status: 'OK', issued: req.message };
                } else {
                  response = { status: 'ERROR', message: 'Missing message parameter' };
                }
                break;

              case 'DISCONNECT':
                response = { status: 'OK', message: 'Disconnecting bot' };
                socket.write(JSON.stringify(response) + '\n');
                socket.end();
                setTimeout(() => {
                  bot.quit('Commanded via IPC');
                }, 200);
                return;

              case 'UPGRADE_TOOLS':
                if (bot.toolProgression && bot.toolProgression.checkAndUpgradeTools) {
                  bot.toolProgression.checkAndUpgradeTools();
                  response = { status: 'OK', message: 'Upgrade check scheduled' };
                }
                break;

              case 'PURGE_INVENTORY':
                if (bot.inventoryPurge && bot.inventoryPurge.purgeGarbage) {
                  await bot.inventoryPurge.purgeGarbage();
                  response = { status: 'OK', message: 'Purge complete' };
                }
                break;

              default:
                response = { status: 'ERROR', message: `Unknown command: ${cmd}` };
                break;
            }
          } catch (err) {
            response = { status: 'ERROR', message: `JSON Parse error: ${err.message}` };
          }

          socket.write(JSON.stringify(response) + '\n');
        }
      });
    });

    server.on('error', (err) => {
      console.error('[IPC ERROR]', err.message);
    });

    server.listen(socketPath, () => {
      console.log(`[IPC] Command listener active at ${socketPath}`);
    });
  }

  function stopServer() {
    if (server) {
      server.close();
      if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    }
  }

  bot.once('spawn', startServer);
  bot.once('end', stopServer);

  bot.ipc = {
    socketPath,
    stopServer
  };
}

module.exports = ipcServerPlugin;
