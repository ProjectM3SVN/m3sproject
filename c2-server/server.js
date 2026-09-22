/**
 * server.js - MSMap & MSView C2 Gateway
 * - Hosts Express HTTP REST API & Static HUD on port 3000 (or PORT env).
 * - Dual WebSocket Paths:
 *    1. /ws/public: Sanitized surface deltas, coarse 500x500 heatmaps.
 *    2. /ws/classified: Full authenticated unredacted voxel & stash vectors.
 * - Dispatches tactical C2 commands to Swarm Blackboard Unix Socket.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');

const DeltaRingBuffer = require('./lib/deltaBuffer');
const SecurityFilter = require('./lib/securityFilter');
const TileRenderer = require('./lib/tileRenderer');

const PORT = parseInt(process.env.PORT || process.env.C2_PORT || '3000', 10);
const SWARM_SECRET = process.env.SWARM_SECRET || 'm3s_secure_swarm_salt_99';
const BLACKBOARD_SOCK = process.env.BLACKBOARD_SOCK || '/tmp/m3s_blackboard.sock';

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const deltaBuffer = new DeltaRingBuffer(10000);
const tileRenderer = new TileRenderer();

// --- REST Endpoints ---
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'MSMap C2 Engine',
    uptime: process.uptime(),
    memoryRssMb: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
    bufferCount: deltaBuffer.count,
    timestamp: Date.now()
  });
});

app.get('/tiles/:z/:x/:y.png', (req, res) => {
  const { z, x, y } = req.params;
  const tileBuffer = tileRenderer.renderTile(z, x, y);
  res.setHeader('Content-Type', 'image/png');
  res.send(tileBuffer);
});

// C2 Command Dispatcher Route
app.post('/api/c2/command', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SWARM_SECRET}`) {
    return res.status(401).json({ error: 'UNAUTHORIZED_C2_DISPATCH' });
  }

  const { command, payload } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'MISSING_COMMAND' });
  }

  console.log(`[C2 COMMAND DISPATCH] ${command}`, payload || {});

  // Forward command to Swarm Blackboard Socket
  const client = net.createConnection(BLACKBOARD_SOCK, () => {
    const packet = {
      action: 'C2_DISPATCH',
      command,
      payload,
      timestamp: Date.now()
    };
    client.write(JSON.stringify(packet) + '\n');
    client.end();
    res.json({ status: 'DISPATCHED_TO_SWARM', command });
  });

  client.on('error', (err) => {
    console.warn('[C2 DISPATCH ERROR] Blackboard socket unreachable:', err.message);
    res.status(502).json({ error: 'BLACKBOARD_SOCK_UNREACHABLE', details: err.message });
  });
});

// Ingest endpoint for bots to push world deltas
app.post('/api/ingest/delta', (req, res) => {
  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ error: 'INVALID_DELTA' });

  const stored = deltaBuffer.push(event);
  broadcastDelta(stored);
  res.json({ status: 'INGESTED', seq: stored.seq });
});

// --- Dual WebSocket Setup ---
const wssPublic = new WebSocket.Server({ noServer: true });
const wssClassified = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/ws/public') {
    wssPublic.handleUpgrade(request, socket, head, (ws) => {
      wssPublic.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/classified') {
    // Authenticate Bearer token
    const authHeader = request.headers['sec-websocket-protocol'] || request.headers['authorization'];
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;

    if (token !== SWARM_SECRET) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wssClassified.handleUpgrade(request, socket, head, (ws) => {
      wssClassified.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wssPublic.on('connection', (ws) => {
  console.log('[WS PUBLIC] Client connected.');
  ws.send(JSON.stringify({ type: 'HANDSHAKE', level: 'PUBLIC_SANITIZED' }));
});

wssClassified.on('connection', (ws) => {
  console.log('[WS CLASSIFIED] Authenticated C2 Commander connected.');
  ws.send(JSON.stringify({ type: 'HANDSHAKE', level: 'CLASSIFIED_FULL' }));
  // Send initial snapshot
  const snapshot = deltaBuffer.getSnapshot();
  ws.send(JSON.stringify({ type: 'SNAPSHOT', data: snapshot }));
});

function broadcastDelta(rawDelta) {
  // 1. Broadcast Classified (Raw)
  const rawMsg = JSON.stringify({ type: 'DELTA', data: rawDelta });
  wssClassified.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(rawMsg);
  });

  // 2. Broadcast Public (Scrubbed)
  const scrubbed = SecurityFilter.sanitizeDelta(rawDelta);
  if (scrubbed) {
    const scrubbedMsg = JSON.stringify({ type: 'DELTA', data: scrubbed });
    wssPublic.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(scrubbedMsg);
    });
  }
}

// Start HTTP Server with Port Auto-Shift if occupied
function startListen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`[PORT CONFLICT] Port ${port} occupied! Shifting C2 to ${nextPort}...`);
      startListen(nextPort);
    } else {
      console.error('[C2 SERVER ERROR]', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[MSMAP C2 ENGINE] Tactical HUD online at http://0.0.0.0:${port}`);
  });
}

startListen(PORT);
