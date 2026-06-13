// Localhost bridge: exposes the portal to the web app over a WebSocket.
// Run alongside the web app; the page connects to ws://127.0.0.1:8777 and
// receives identified figures. When this helper isn't running, the web app
// falls back to WebHID detect-only mode.
import { WebSocketServer } from 'ws';
import { PortalHelper } from './portal.mjs';

const PORT = 8777;
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

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
});

console.log(`Skylanders portal helper listening on ws://127.0.0.1:${PORT}`);
console.log('Leave this window open. Plug in your portal and open the web app.');
