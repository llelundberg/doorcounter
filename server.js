const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const config = require('./config');

const LOG_FILE = path.join(config.dataDir, 'log.csv');
const LOG_HEADER = 'timestamp,action,delta,value,device\n';

// ---------- State and log ----------

const state = { value: 0, capacity: 0 };
let entries = [];

function parseLine(line) {
  const [timestamp, action, delta, value, device] = line.split(',');
  return {
    timestamp,
    action,
    delta: parseInt(delta, 10) || 0,
    value: parseInt(value, 10) || 0,
    device: device || '',
  };
}

function loadLog() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, LOG_HEADER);
  }
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  entries = lines.map(parseLine);
  state.value = 0;
  state.capacity = 0;
  for (const e of entries) {
    if (e.action === 'capacity') state.capacity = e.value;
    else state.value = e.value;
  }
}

function sanitizeDevice(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

function record(action, delta, value, device) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    delta,
    value,
    device: sanitizeDevice(device),
  };
  fs.appendFileSync(LOG_FILE, `${entry.timestamp},${action},${delta},${value},${entry.device}\n`);
  entries.push(entry);
  if (action === 'capacity') state.capacity = value;
  else state.value = value;
  broadcastState();
  broadcastToLogSubscribers({ type: 'entry', entry });
}

function archiveLog() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(LOG_FILE, path.join(config.dataDir, `log-${stamp}.csv`));
  const capacity = state.capacity;
  fs.writeFileSync(LOG_FILE, LOG_HEADER);
  entries = [];
  state.value = 0;
  state.capacity = 0;
  broadcastToLogSubscribers({ type: 'log', entries });
  // Keep the configured capacity in the fresh log.
  if (capacity) record('capacity', 0, capacity, 'admin');
  else broadcastState();
}

// ---------- WebSocket protocol ----------
//
// Client -> server: { type, id, ... }. Every message with an id gets an ack:
//   { type: 'ack', id, ok: true, state } or { type: 'ack', id, ok: false, error }
//   change     { delta: 1 | -1, device }
//   set        { value }          admin
//   capacity   { capacity }       admin
//   archive    {}                 admin
//   subscribeLog {}               admin; server sends { type: 'log', entries }
//                                 now and { type: 'entry', entry } on each change
//   ping       {}                 heartbeat, just acked
// Server -> all clients: { type: 'state', value, capacity } on connect and on every change.

function isNonNegInt(n) {
  return Number.isInteger(n) && n >= 0 && n <= 1000000;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState() {
  const msg = JSON.stringify({ type: 'state', ...state });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function broadcastToLogSubscribers(msg) {
  for (const ws of wss.clients) {
    if (ws.logSubscriber) send(ws, msg);
  }
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'change':
      if (msg.delta !== 1 && msg.delta !== -1) return 'delta must be 1 or -1';
      record(msg.delta > 0 ? 'inc' : 'dec', msg.delta, state.value + msg.delta, msg.device);
      return null;

    case 'set':
      if (!isNonNegInt(msg.value)) return 'value must be a non-negative integer';
      record('set', msg.value - state.value, msg.value, 'admin');
      return null;

    case 'capacity':
      if (!isNonNegInt(msg.capacity)) return 'capacity must be a non-negative integer';
      record('capacity', 0, msg.capacity, 'admin');
      return null;

    case 'archive':
      archiveLog();
      return null;

    case 'subscribeLog':
      ws.logSubscriber = true;
      send(ws, { type: 'log', entries });
      return null;

    case 'ping':
      return null;

    default:
      return 'unknown message type';
  }
}

function onMessage(ws, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  let error;
  try {
    error = handle(ws, msg);
  } catch (err) {
    console.error(err);
    error = 'server error';
  }
  if (msg.id !== undefined) {
    send(ws, error ? { type: 'ack', id: msg.id, ok: false, error } : { type: 'ack', id: msg.id, ok: true, state });
  }
}

// ---------- Server ----------

const server = http.createServer((req, res) => {
  if (config.serveStatic && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveStatic(req, res);
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' }).end('WebSocket only: connect to /api');
});

const wss = new WebSocketServer({ server, path: '/api', maxPayload: 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // Protocol errors (e.g. a message over maxPayload) close this socket;
  // without a listener they would crash the whole server.
  ws.on('error', (err) => console.warn('ws error:', err.message));
  ws.on('message', (data) => onMessage(ws, data));
  send(ws, { type: 'state', ...state });
});

// Drop connections that stopped answering pings; the traffic also keeps
// Apache and mobile networks from closing idle connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Local development only: in production Apache serves public/.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      res.writeHead(301, { Location: path.basename(pathname) + '/' }).end();
      return;
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

loadLog();
server.listen(config.port, config.host, () => {
  console.log(`DoorCounter listening on ws://${config.host}:${config.port}/api${config.serveStatic ? ' (serving public/)' : ''} (value=${state.value}, capacity=${state.capacity})`);
});
