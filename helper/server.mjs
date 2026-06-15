// Localhost bridge: exposes the portal to the web app over a WebSocket, and
// also serves the built web app over HTTP on the same origin. Open
// http://localhost:8777 and everything (UI + portal socket) is same-origin, so
// there's no HTTPS/mixed-content issue. The page connects to ws on this port
// and receives identified figures; without the helper it falls back to
// WebHID detect-only mode.
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortalHelper } from './portal.mjs';
import { inspectFigure } from './figure.mjs';

const PORT = Number(process.env.PORT) || 8777;
const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Static file server for the built app. Path traversal is blocked, and the
// SPA falls back to index.html.
const httpServer = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\' || rel === '') rel = 'index.html';
    let filePath = join(DIST, rel);
    if (!filePath.startsWith(DIST)) filePath = join(DIST, 'index.html');
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      body = await readFile(join(DIST, 'index.html')); // SPA fallback
      filePath = 'index.html';
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Build the app first: npm run build');
  }
});

const wss = new WebSocketServer({ server: httpServer });

let portal = null;
let lastState = { connected: false, product: null, present: new Array(16).fill(false) };
// Figures currently identified, by slot, so a freshly-connected client gets
// the present figures immediately.
const figuresBySlot = new Map();

function broadcast(msg) {
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(json);
  }
}

function log(msg) {
  console.log(`[helper] ${msg}`);
  broadcast({ t: 'log', msg });
}

function attach(p) {
  p.on('open', (info) => {
    lastState = { connected: true, product: info.product, present: new Array(16).fill(false) };
    figuresBySlot.clear();
    log(`Portal connected: ${info.product} (${info.idString})`);
    broadcast({ t: 'hello', ...info });
  });
  p.on('close', () => {
    lastState.connected = false;
    figuresBySlot.clear();
    log('Portal disconnected.');
    broadcast({ t: 'bye' });
  });
  p.on('status', (present) => {
    lastState.present = present;
    broadcast({ t: 'status', present });
  });
  p.on('added', (fig) => {
    figuresBySlot.set(fig.slot, fig);
    log(`Slot ${fig.slot + 1}: ${fig.name}${fig.unknown ? ' (unconfirmed)' : ''} [uid ${fig.uid ?? '?'}]`);
    broadcast({ t: 'figure', ...fig });
  });
  p.on('removed', ({ slot }) => {
    figuresBySlot.delete(slot);
    broadcast({ t: 'removed', slot });
  });
  p.on('log', log);
}

function tryConnect() {
  if (portal && portal.connected) return;
  if (!PortalHelper.findDevice()) return;
  try {
    portal = new PortalHelper();
    attach(portal);
    portal.open();
  } catch (err) {
    log(`Connect failed: ${err.message}`);
    portal = null;
  }
}

// Poll for the portal so it can be plugged in after the helper starts, and
// reconnected after a replug.
tryConnect();
setInterval(() => {
  if (!portal || !portal.connected) tryConnect();
}, 2000);

wss.on('connection', (ws) => {
  log(`Web app connected (${wss.clients.size} client${wss.clients.size === 1 ? '' : 's'}).`);
  // Replay current state to the new client.
  if (lastState.connected) {
    ws.send(JSON.stringify({ t: 'hello', product: lastState.product, idString: '' }));
    ws.send(JSON.stringify({ t: 'status', present: lastState.present }));
    for (const fig of figuresBySlot.values()) ws.send(JSON.stringify({ t: 'figure', ...fig }));
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    // Read-only figure inspection: full dump + decode + checksum validation.
    if (msg.t === 'inspect') {
      if (!portal || !portal.connected) {
        ws.send(JSON.stringify({ t: 'inspect-result', slot: msg.slot, ok: false, error: 'No portal connected.' }));
        return;
      }
      try {
        log(`Inspecting slot ${msg.slot + 1} (full dump)…`);
        const blocks = await portal.dumpAll(msg.slot);
        const result = inspectFigure(blocks);
        const readCount = blocks.filter(Boolean).length;
        log(`Slot ${msg.slot + 1}: read ${readCount}/64 blocks; ${result.ok ? 'decoded' : 'decode failed: ' + result.error}`);
        if (result.ok) {
          const c = result.checksums;
          log(`  checksum type1 ${c.type1.match ? 'OK' : 'MISMATCH'}; type2 range=${c.type2.matchedBy ?? '?'}; type3 range=${c.type3.matchedBy ?? '?'}`);
        }
        ws.send(JSON.stringify({ t: 'inspect-result', slot: msg.slot, ...result, blocks }));
      } catch (err) {
        ws.send(JSON.stringify({ t: 'inspect-result', slot: msg.slot, ok: false, error: err.message }));
      }
    }
  });
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`Skylanders portal helper running.`);
  console.log(`  • Open the app:  http://localhost:${PORT}`);
  console.log(`  • Portal socket: ws://127.0.0.1:${PORT}`);
  console.log('Leave this window open. Plug in your portal and drop figures on it.');
});
