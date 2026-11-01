const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_FILE = path.join(config.dataDir, 'log.csv');
const LOG_HEADER = 'timestamp,action,delta,value,device\n';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

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
  broadcast();
}

function archiveLog() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(LOG_FILE, path.join(config.dataDir, `log-${stamp}.csv`));
  const capacity = state.capacity;
  fs.writeFileSync(LOG_FILE, LOG_HEADER);
  entries = [];
  state.value = 0;
  state.capacity = 0;
  // Keep the configured capacity in the fresh log.
  if (capacity) record('capacity', 0, capacity, 'admin');
  else broadcast();
}

// ---------- Server-Sent Events ----------

const clients = new Set();

function broadcast() {
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(msg);
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

// ---------- HTTP helpers ----------

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isNonNegInt(n) {
  return Number.isInteger(n) && n >= 0 && n <= 1000000;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      // /admin -> /admin/ so relative URLs resolve correctly
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

// ---------- Routes ----------

async function handleApi(req, res, pathname) {
  const route = `${req.method} ${pathname}`;
  switch (route) {
    case 'GET /api/state':
      return sendJson(res, 200, state);

    case 'GET /api/events':
      return handleEvents(req, res);

    case 'GET /api/log':
      return sendJson(res, 200, entries);

    case 'GET /api/log.csv': {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="besokslogg-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(LOG_FILE).pipe(res);
    }

    case 'POST /api/change': {
      const body = await readJson(req);
      if (body.delta !== 1 && body.delta !== -1) return sendJson(res, 400, { error: 'delta must be 1 or -1' });
      record(body.delta > 0 ? 'inc' : 'dec', body.delta, state.value + body.delta, body.device);
      return sendJson(res, 200, state);
    }

    case 'POST /api/set': {
      const body = await readJson(req);
      if (!isNonNegInt(body.value)) return sendJson(res, 400, { error: 'value must be a non-negative integer' });
      record('set', body.value - state.value, body.value, 'admin');
      return sendJson(res, 200, state);
    }

    case 'POST /api/capacity': {
      const body = await readJson(req);
      if (!isNonNegInt(body.capacity)) return sendJson(res, 400, { error: 'capacity must be a non-negative integer' });
      record('capacity', 0, body.capacity, 'admin');
      return sendJson(res, 200, state);
    }

    case 'POST /api/archive':
      archiveLog();
      return sendJson(res, 200, state);

    default:
      return sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, pathname);
    } else {
      res.writeHead(405).end();
    }
  } catch (err) {
    if (!res.headersSent) sendJson(res, 400, { error: err.message });
  }
});

loadLog();
server.listen(config.port, config.host, () => {
  console.log(`DoorCounter listening on http://${config.host}:${config.port} (value=${state.value}, capacity=${state.capacity})`);
});
