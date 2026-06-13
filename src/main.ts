import './style.css';
import { Portal, PortalWriteUnsupportedError, SLOT_COUNT, type SlotEvent } from './hid/portal';
import { lookupFigure, parseIdentity, figureCount } from './figures/db';
import { HelperClient, type HelperFigure } from './helper-client';
import { Collection, type ScanInput } from './collection/collection';

const connectBtn = document.querySelector<HTMLButtonElement>('#connect')!;
const portalStatus = document.querySelector<HTMLSpanElement>('#portal-status')!;
const unsupportedMsg = document.querySelector<HTMLParagraphElement>('#unsupported')!;
const slotsEl = document.querySelector<HTMLDivElement>('#slots')!;
const figuresEl = document.querySelector<HTMLDivElement>('#figures')!;
const figuresEmpty = document.querySelector<HTMLParagraphElement>('#figures-empty')!;
const logEl = document.querySelector<HTMLPreElement>('#log')!;
const collectionSummaryEl = document.querySelector<HTMLParagraphElement>('#collection-summary')!;
const completenessEl = document.querySelector<HTMLDivElement>('#completeness')!;
const collectionEl = document.querySelector<HTMLDivElement>('#collection')!;
const exportBtn = document.querySelector<HTMLButtonElement>('#export')!;
const importBtn = document.querySelector<HTMLButtonElement>('#import')!;
const importFile = document.querySelector<HTMLInputElement>('#import-file')!;

const collection = new Collection();

let portal: Portal | null = null;
let detectOnly = false;
// In helper mode, figures are keyed by slot so removals update the grid.
const slotFigures = new Map<number, { name: string; meta: string; unknown: boolean }>();
let helperMode = false;

// ---- log -----------------------------------------------------------------

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function hex(data: Uint8Array, len = data.length): string {
  return [...data.slice(0, len)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// ---- slot grid -------------------------------------------------------------

const slotEls: HTMLDivElement[] = [];
for (let i = 0; i < SLOT_COUNT; i++) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.textContent = String(i + 1);
  slotsEl.appendChild(el);
  slotEls.push(el);
}

function renderSlots(present: boolean[]) {
  present.forEach((p, i) => slotEls[i].classList.toggle('present', p));
}

// ---- figure cards ----------------------------------------------------------

function makeCard(opts: { name: string; unknown?: boolean; meta: string }): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'figure-card';
  const name = document.createElement('span');
  name.className = opts.unknown ? 'name unknown' : 'name';
  name.textContent = opts.name;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = opts.meta;
  card.append(name, meta);
  return card;
}

/** Detect-only / WebHID path: append a one-off card (no removal tracking). */
function addFigureCard(opts: { name: string; unknown?: boolean; meta: string }) {
  figuresEmpty.hidden = true;
  figuresEl.prepend(makeCard(opts));
}

/** Helper path: rebuild the list from the slot map so removals reflect. */
function renderSlotFigures() {
  figuresEl.querySelectorAll('.figure-card').forEach((c) => c.remove());
  const slots = [...slotFigures.keys()].sort((a, b) => a - b);
  figuresEmpty.hidden = slots.length > 0;
  for (const slot of slots) {
    const f = slotFigures.get(slot)!;
    figuresEl.appendChild(makeCard(f));
  }
}

// ---- collection ------------------------------------------------------------

async function recordScan(scan: ScanInput) {
  try {
    const result = await collection.recordScan(scan);
    if (result.isNewFigure) log(`Added to collection: ${scan.name}`);
    else if (result.isNewCopy) log(`Duplicate copy of ${scan.name} (now ${result.entry.copies.length}).`);
    renderCollection();
  } catch (err) {
    log(`Collection save failed: ${(err as Error).message}`);
  }
}

function renderCollection() {
  const stats = collection.stats();

  if (stats.ownedFigures === 0) {
    collectionSummaryEl.textContent = 'No figures collected yet. Scan a figure to start.';
    completenessEl.replaceChildren();
    collectionEl.replaceChildren();
    return;
  }

  const dupes = stats.totalCopies - stats.ownedFigures;
  collectionSummaryEl.innerHTML =
    `<strong>${stats.ownedFigures}</strong> of ${stats.catalogTotal} figures ` +
    `(${stats.overallPct}%) · ${stats.totalCopies} physical ${stats.totalCopies === 1 ? 'copy' : 'copies'}` +
    (dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'}` : '');

  // Completeness bars for sections the user has at least one figure in.
  completenessEl.replaceChildren();
  for (const s of stats.bySection) {
    if (s.owned === 0) continue;
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = s.section;
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = s.pct >= 100 ? 'bar-fill complete' : 'bar-fill';
    fill.style.width = `${s.pct}%`;
    track.appendChild(fill);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${s.owned}/${s.total}`;
    row.append(label, track, count);
    completenessEl.appendChild(row);
  }

  // Owned figures grouped by section.
  collectionEl.replaceChildren();
  const entries = collection.ownedList().sort((a, b) => a.name.localeCompare(b.name));
  const bySection = new Map<string, typeof entries>();
  for (const e of entries) {
    let list = bySection.get(e.section);
    if (!list) bySection.set(e.section, (list = []));
    list.push(e);
  }
  for (const [section, list] of bySection) {
    const title = document.createElement('div');
    title.className = 'collection-group-title';
    title.textContent = section || 'Other';
    collectionEl.appendChild(title);
    for (const e of list) {
      const card = document.createElement('div');
      card.className = 'owned-card';
      const left = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'oc-name';
      name.textContent = e.unknown ? `${e.name} (unconfirmed)` : e.name;
      const sec = document.createElement('div');
      sec.className = 'oc-section';
      sec.textContent = `char ${e.charId} · variant ${e.variantId}`;
      left.append(name, sec);
      card.appendChild(left);
      if (e.copies.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'dupe-badge';
        badge.textContent = `×${e.copies.length}`;
        card.appendChild(badge);
      }
      collectionEl.appendChild(card);
    }
  }
}

function exportCollection() {
  const blob = new Blob([collection.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portal-collection-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Collection exported.');
}

async function importCollection(file: File) {
  try {
    const count = await collection.importJSON(await file.text(), 'merge');
    log(`Imported ${count} figures from backup.`);
    renderCollection();
  } catch (err) {
    log(`Import failed: ${(err as Error).message}`);
  }
}

exportBtn.addEventListener('click', exportCollection);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (file) void importCollection(file);
  importFile.value = '';
});

// ============================================================================
// Helper mode (full identification via the local bridge)
// ============================================================================

const helperEvents = {
  hello: (info: { product: string }) => {
    helperMode = true;
    connectBtn.hidden = true;
    unsupportedMsg.hidden = true;
    portalStatus.textContent = `Connected: ${info.product} (via helper)`;
    portalStatus.classList.add('connected');
  },
  bye: () => {
    portalStatus.textContent = 'Helper running — waiting for portal';
    portalStatus.classList.remove('connected');
    slotFigures.clear();
    renderSlotFigures();
    renderSlots(new Array(SLOT_COUNT).fill(false));
  },
  status: renderSlots,
  figure: (f: HelperFigure) => {
    slotFigures.set(f.slot, {
      name: f.unknown ? `${f.name} (unconfirmed)` : f.name,
      unknown: f.unknown,
      meta: `${f.section || 'slot ' + (f.slot + 1)} · char ${f.charId} · variant ${f.variantId}`,
    });
    renderSlotFigures();
    void recordScan(f);
  },
  removed: (slot: number) => {
    slotFigures.delete(slot);
    renderSlotFigures();
  },
  log,
  connected: () => {
    log('Connected to local portal helper — full identification enabled.');
  },
  disconnected: () => {
    if (!helperMode) return;
    log('Lost connection to helper. Reload after restarting it, or use browser detect-only.');
    helperMode = false;
    portalStatus.textContent = 'Helper stopped';
    portalStatus.classList.remove('connected');
    connectBtn.hidden = false;
  },
};

// ============================================================================
// WebHID detect-only fallback
// ============================================================================

async function identifySlot(slot: number) {
  if (!portal) return;
  try {
    const block1 = await portal.queryBlock(slot, 1);
    log(`Slot ${slot + 1} block 1: ${hex(block1)}`);
    const { charId, variantId } = parseIdentity(block1);
    let result = lookupFigure(charId, variantId);
    let shownVariant = variantId;
    if (!result.figure) {
      const swapped = ((variantId & 0xff) << 8) | (variantId >> 8);
      const retry = lookupFigure(charId, swapped);
      if (retry.figure) { result = retry; shownVariant = swapped; }
    }
    if (result.figure) {
      addFigureCard({ name: result.figure.name, meta: `${result.figure.section} · char ${charId} · variant ${shownVariant}` });
      log(`Identified: ${result.figure.name}`);
      void recordScan({
        charId, variantId: shownVariant, name: result.figure.name,
        section: result.figure.section, unknown: false, uid: null,
      });
    } else if (result.baseMatch) {
      addFigureCard({ name: `${result.baseMatch.name} (unknown variant)`, unknown: true, meta: `char ${charId} · variant ${variantId}` });
    } else {
      addFigureCard({ name: 'Unknown figure', unknown: true, meta: `char ${charId} · variant ${variantId}` });
    }
  } catch (err) {
    log(`Read failed on slot ${slot + 1}: ${(err as Error).message}`);
  }
}

function onSlotEvent(event: SlotEvent) {
  if (event.type === 'added') {
    if (detectOnly) {
      log(`Figure added on slot ${event.slot + 1} (identification unavailable).`);
      addFigureCard({ name: 'Unidentified figure', unknown: true, meta: `slot ${event.slot + 1}` });
      return;
    }
    log(`Figure added on slot ${event.slot + 1}, reading…`);
    void identifySlot(event.slot);
  } else {
    log(`Figure removed from slot ${event.slot + 1}`);
  }
}

async function startPortal(p: Portal) {
  portal = p;
  await p.open();
  log(`Opened ${p.productName} (${p.idString})`);
  const ready = await p.ready();
  log(`Ready response: ${hex(ready, 8)}`);
  await p.activate();
  log('Portal activated — waiting for figures.');
  portalStatus.textContent = `Connected: ${p.productName}`;
  portalStatus.classList.add('connected');
  connectBtn.disabled = true;
}

function onDisconnected() {
  portal = null;
  detectOnly = false;
  portalStatus.textContent = 'No portal connected';
  portalStatus.classList.remove('connected');
  connectBtn.disabled = false;
  renderSlots(new Array(SLOT_COUNT).fill(false));
}

const events = { status: renderSlots, slot: onSlotEvent, log, disconnected: onDisconnected };

async function connectWith(p: Portal) {
  try {
    await startPortal(p);
  } catch (err) {
    log(`Connection failed: ${(err as Error).message}`);
    if (err instanceof PortalWriteUnsupportedError) {
      detectOnly = true;
      unsupportedMsg.innerHTML =
        '<strong>This portal can detect figures but can’t identify them in the browser.</strong> ' +
        'Run the local helper (see the <code>helper/</code> folder) for full identification — it uses ' +
        'the same command path as desktop tools like SkyReader.';
      unsupportedMsg.hidden = false;
      portalStatus.textContent = `Connected (detect only): ${p.productName}`;
      portalStatus.classList.add('connected');
      connectBtn.disabled = true;
      return;
    }
    onDisconnected();
  }
}

connectBtn.addEventListener('click', async () => {
  const p = await Portal.request(events).catch((err: Error) => {
    log(`Portal request failed: ${err.message}`);
    return null;
  });
  if (!p) { log('No portal selected.'); return; }
  await connectWith(p);
});

// ---- init ---------------------------------------------------------------

async function init() {
  log(`Figure database loaded: ${figureCount} figures.`);
  await collection.load();
  renderCollection();
  const owned = collection.stats().ownedFigures;
  if (owned > 0) log(`Collection restored: ${owned} figures.`);

  // Prefer the local helper (full identification on any portal/OS).
  const client = new HelperClient(helperEvents);
  if (await client.connect()) return;
  log('No local helper found — using browser WebHID.');

  if (!Portal.isSupported()) {
    unsupportedMsg.hidden = false;
    connectBtn.disabled = true;
    return;
  }
  if (location.search.includes('noauto')) {
    log('Auto-reconnect disabled (?noauto).');
    return;
  }
  const granted = await Portal.fromGranted(events);
  if (granted) {
    log('Found previously granted portal, reconnecting…');
    await connectWith(granted);
  }
}

void init();
