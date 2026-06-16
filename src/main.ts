import './style.css';
import { Portal, PortalWriteUnsupportedError, SLOT_COUNT, type SlotEvent } from './hid/portal';
import { lookupFigure, parseIdentity, figureCount, visibleFigures } from './figures/db';
import { figureThumb } from './figures/art';
import { HelperClient, type HelperFigure, type InspectResult, type EditResult } from './helper-client';
import { Collection, type ScanInput } from './collection/collection';
import { CatalogView } from './catalog';
import { initAuth } from './auth-ui';
import { makeCloudAdapter, fullSync } from './cloud/sync';
import { cloudEnabled } from './cloud/supabase';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const connectBtn = $<HTMLButtonElement>('#connect');
const portalStatus = $<HTMLSpanElement>('#portal-status');
const unsupportedMsg = $<HTMLParagraphElement>('#unsupported');
const slotsEl = $<HTMLDivElement>('#slots');
const slotsSection = $<HTMLElement>('#slots-section');
const figuresEl = $<HTMLDivElement>('#figures');
const figuresEmpty = $<HTMLParagraphElement>('#figures-empty');
const logEl = $<HTMLPreElement>('#log');
const completenessEl = $<HTMLDivElement>('#completeness');
const collectionEl = $<HTMLDivElement>('#collection');
const exportBtn = $<HTMLButtonElement>('#export');
const importBtn = $<HTMLButtonElement>('#import');
const importFile = $<HTMLInputElement>('#import-file');
const cleanupBtn = $<HTMLButtonElement>('#cleanup');
const welcomeEl = $<HTMLElement>('#welcome');
const dashboardEl = $<HTMLElement>('#dashboard');
const dashPct = $<HTMLSpanElement>('#dash-pct');
const dashRing = $<HTMLDivElement>('.dash-ring');
const dashOwned = $<HTMLElement>('#dash-owned');
const dashTotal = $<HTMLElement>('#dash-total');
const dashCopies = $<HTMLElement>('#dash-copies');
const welcomeSignin = $<HTMLButtonElement>('#welcome-signin');
const welcomeBrowse = $<HTMLButtonElement>('#welcome-browse');
const welcomeShowcase = $<HTMLDivElement>('#welcome-showcase');

const collection = new Collection();
const catalog = new CatalogView(collection, () => renderCollection());
const figureDetailsEl = $<HTMLDivElement>('#figure-details');

let helperClient: HelperClient | null = null;
let portal: Portal | null = null;
let detectOnly = false;
let signedIn = false;
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
    const card = makeCard(f);
    const inspect = document.createElement('button');
    inspect.className = 'ghost';
    inspect.textContent = 'Inspect';
    inspect.title = 'Read this figure’s data (non-destructive)';
    inspect.addEventListener('click', () => {
      figureDetailsEl.hidden = false;
      figureDetailsEl.textContent = `Reading slot ${slot + 1}…`;
      helperClient?.requestInspect(slot);
    });
    card.appendChild(inspect);
    figuresEl.appendChild(card);
  }
}

function renderInspectResult(r: InspectResult) {
  figureDetailsEl.hidden = false;
  figureDetailsEl.replaceChildren();
  if (!r.ok) {
    figureDetailsEl.textContent = `Couldn’t read figure: ${r.error ?? 'unknown error'}`;
    return;
  }
  const name = slotFigures.get(r.slot)?.name ?? `char ${r.charId}`;
  const s = r.stats!;
  const c = r.checksums!;
  const rows: [string, string][] = [
    ['Figure', name],
    ['XP', String(s.xp)],
    ['Gold', String(s.gold)],
    ['Hero points', s.heroPoints == null ? '—' : String(s.heroPoints)],
    ['Hat', s.hat ? String(s.hat) : 'none'],
    ['Nickname', s.nickname || '—'],
    ['Active save area', String(r.activeArea)],
  ];

  const h = document.createElement('h3');
  h.textContent = 'Figure data (read-only preview)';
  figureDetailsEl.appendChild(h);

  const dl = document.createElement('div');
  dl.className = 'detail-grid';
  for (const [k, v] of rows) {
    const ke = document.createElement('span');
    ke.className = 'dk';
    ke.textContent = k;
    const ve = document.createElement('span');
    ve.className = 'dv';
    ve.textContent = v;
    dl.append(ke, ve);
  }
  figureDetailsEl.appendChild(dl);

  // Checksum validation — proves the crypto is correct before any write.
  const ck = document.createElement('p');
  ck.className = 'detail-checks';
  const ok = c.type1.match && c.type2.matchedBy && c.type3.matchedBy;
  ck.innerHTML =
    `Checksum verification: type1 ${c.type1.match ? '✓' : '✗'}, ` +
    `type2 ${c.type2.matchedBy ? '✓' : '✗'}, type3 ${c.type3.matchedBy ? '✓' : '✗'} — ` +
    (ok ? 'crypto validated on this figure.' : 'needs review (do not enable writes yet).');
  figureDetailsEl.appendChild(ck);

  if (r.writeSelfTest) {
    const st = document.createElement('p');
    st.className = 'detail-checks';
    st.textContent = r.writeSelfTest.pass
      ? 'Write self-test: ✓ a no-op edit rebuilds a valid figure in memory (write pipeline proven).'
      : `Write self-test: ✗ ${r.writeSelfTest.reason ?? 'failed'} — editing disabled.`;
    figureDetailsEl.appendChild(st);
  }

  let backupDone = false;
  const backup = document.createElement('button');
  backup.className = 'ghost';
  backup.textContent = 'Download backup (.json)';
  figureDetailsEl.appendChild(backup);

  // Edit panel — only for figures whose write pipeline self-test passed and
  // whose type is safe to edit.
  const editable =
    r.writeSelfTest?.pass &&
    !/creation crystal|trap/i.test(name) &&
    !/Trap/i.test(slotFigures.get(r.slot)?.meta ?? '');

  if (!editable) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = r.writeSelfTest?.pass
      ? 'This figure type can’t be edited safely (traps / creation crystals are blocked).'
      : 'Editing is disabled for this figure.';
    figureDetailsEl.appendChild(note);
    backup.addEventListener('click', () => downloadBackup(r, name));
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'edit-panel';
  panel.innerHTML = `
    <h3>Edit figure</h3>
    <p class="edit-warn">⚠ Editing rewrites data on the physical figure. It’s well-tested, but a bad write
    could damage it. <strong>Download a backup first</strong>, and try a figure you don’t mind risking.</p>
    <label class="edit-own"><input type="checkbox" id="edit-own" /> I own this figure and accept the risk</label>
    <div class="edit-fields">
      <label>Gold<input type="number" id="edit-gold" min="0" max="65000" value="${r.stats!.gold}"></label>
      <label>XP (tier 1)<input type="number" id="edit-xp" min="0" max="33000" value="${r.stats!.xp}"></label>
      <label>Hero points<input type="number" id="edit-hp" min="0" max="100" value="${r.stats!.heroPoints ?? 0}"></label>
      <label>Nickname<input type="text" id="edit-name" maxlength="14" value="${escapeAttr(r.stats!.nickname)}"></label>
    </div>
    <div class="edit-actions">
      <button id="edit-apply" disabled>Apply changes</button>
      <button id="edit-reset" class="ghost danger" disabled>Reset figure</button>
    </div>`;
  figureDetailsEl.appendChild(panel);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'Changes write to the spare save slot and are verified by reading back every block.';
  figureDetailsEl.appendChild(note);

  const own = panel.querySelector<HTMLInputElement>('#edit-own')!;
  const applyBtn = panel.querySelector<HTMLButtonElement>('#edit-apply')!;
  const resetBtn = panel.querySelector<HTMLButtonElement>('#edit-reset')!;
  const refresh = () => {
    const enabled = own.checked && backupDone;
    applyBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
  };
  own.addEventListener('change', refresh);
  backup.addEventListener('click', () => {
    downloadBackup(r, name);
    backupDone = true;
    refresh();
  });

  applyBtn.addEventListener('click', () => {
    const edits = {
      gold: Number(panel.querySelector<HTMLInputElement>('#edit-gold')!.value),
      xp: Number(panel.querySelector<HTMLInputElement>('#edit-xp')!.value),
      heroPoints: Number(panel.querySelector<HTMLInputElement>('#edit-hp')!.value),
      nickname: panel.querySelector<HTMLInputElement>('#edit-name')!.value,
    };
    if (!confirm(`Write these changes to ${name}? A backup has been saved.`)) return;
    applyBtn.disabled = true;
    log(`Applying edits to ${name}…`);
    helperClient?.requestEdit(r.slot, edits, { charId: r.charId!, variantId: r.variantId! });
  });
  resetBtn.addEventListener('click', () => {
    if (!confirm(`Factory-reset ${name}? This wipes XP, gold, name, hat and upgrades. A backup has been saved.`)) return;
    resetBtn.disabled = true;
    log(`Resetting ${name}…`);
    helperClient?.requestEdit(r.slot, { reset: true }, { charId: r.charId!, variantId: r.variantId! });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderEditResult(r: EditResult) {
  if (r.ok) {
    log(`Edit succeeded and verified. New stats: gold ${r.stats?.gold}, XP ${r.stats?.xp}, name "${r.stats?.nickname || ''}".`);
    helperClient?.requestInspect(r.slot); // refresh the panel with new values
  } else {
    log(`Edit failed: ${r.error ?? 'unknown'} — figure left unchanged.`);
    alert(`Edit failed: ${r.error ?? 'unknown'}\nThe figure was not changed (or restore from your backup if in doubt).`);
  }
}

function downloadBackup(r: InspectResult, name: string) {
  const data = {
    format: 'portal-tracker-figure-backup',
    version: 1,
    savedAt: new Date().toISOString(),
    name,
    charId: r.charId,
    variantId: r.variantId,
    blocks: r.blocks,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-')}-${r.charId}-${r.variantId}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log(`Saved backup of ${name}.`);
}

// ---- collection ------------------------------------------------------------

async function recordScan(scan: ScanInput) {
  try {
    // Canonicalize to the matched catalogue entry so aliased tags (e.g. a SWAP
    // figure's two halves) record against the single combined figure.
    const canon = lookupFigure(scan.charId, scan.variantId).figure;
    if (canon) scan = { ...scan, charId: canon.charId, variantId: canon.variantId };
    const result = await collection.recordScan(scan);
    if (result.isNewFigure) log(`Added to collection: ${scan.name}`);
    else if (result.isNewCopy) log(`Duplicate copy of ${scan.name} (now ${result.entry.copies.length}).`);
    renderCollection();
    catalog.render();
  } catch (err) {
    log(`Collection save failed: ${(err as Error).message}`);
  }
}

function renderCollection() {
  const stats = collection.stats();

  // Empty → welcome/hero; otherwise → dashboard.
  if (stats.ownedFigures === 0) {
    welcomeEl.hidden = false;
    dashboardEl.hidden = true;
    cleanupBtn.hidden = true;
    return;
  }
  welcomeEl.hidden = true;
  dashboardEl.hidden = false;

  dashPct.textContent = `${stats.overallPct}%`;
  dashRing.style.setProperty('--pct', String(stats.overallPct));
  dashOwned.textContent = String(stats.ownedFigures);
  dashTotal.textContent = String(stats.catalogTotal);
  const dupes = stats.totalCopies - stats.ownedFigures;
  dashCopies.textContent =
    `${stats.totalCopies} physical ${stats.totalCopies === 1 ? 'copy' : 'copies'}` +
    (dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'}` : '');

  // Completeness bars for sections the user owns at least one figure in.
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

  // Owned figures as an image grid, grouped by section.
  collectionEl.replaceChildren();
  const entries = collection.ownedList().sort((a, b) => a.name.localeCompare(b.name));
  const bySection = new Map<string, typeof entries>();
  for (const e of entries) {
    let list = bySection.get(e.section);
    if (!list) bySection.set(e.section, (list = []));
    list.push(e);
  }
  let unrecognized = 0;
  for (const [section, list] of bySection) {
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = section || 'Other';
    collectionEl.appendChild(title);
    for (const e of list) {
      const recognized = lookupFigure(e.charId, e.variantId).figure !== null;
      if (!recognized) unrecognized++;
      const card = document.createElement('div');
      card.className = 'fig-card';
      card.appendChild(figureThumb({ name: e.name, charId: e.charId, variantId: e.variantId }));
      if (e.copies.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'fig-badge';
        badge.textContent = `×${e.copies.length}`;
        card.appendChild(badge);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'fig-remove';
      remove.title = 'Remove from collection';
      remove.textContent = '✕';
      remove.addEventListener('click', async () => {
        await collection.removeOwned(e.charId, e.variantId);
        renderCollection();
        catalog.render();
      });
      card.appendChild(remove);
      const body = document.createElement('div');
      body.className = 'fig-body';
      const nm = document.createElement('div');
      nm.className = 'fig-name';
      nm.textContent = recognized ? e.name : `${e.name} (unrecognized)`;
      body.appendChild(nm);
      card.appendChild(body);
      collectionEl.appendChild(card);
    }
  }

  // One-click cleanup of entries that don't match any catalogue figure.
  cleanupBtn.hidden = unrecognized === 0;
  if (unrecognized > 0) cleanupBtn.textContent = `Clean up ${unrecognized}`;
}

/** Slow infinite marquee of base-figure images on the welcome screen. */
function renderShowcase() {
  const bases = visibleFigures.filter((f) => f.variantId === 0);
  const step = Math.max(1, Math.floor(bases.length / 30));
  const picks: typeof bases = [];
  for (let i = 0; i < bases.length && picks.length < 30; i += step) picks.push(bases[i]);
  const track = document.createElement('div');
  track.className = 'marquee-track';
  // Two identical halves so translateX(-50%) loops seamlessly.
  for (const f of [...picks, ...picks]) track.appendChild(figureThumb(f));
  welcomeShowcase.replaceChildren(track);
}

async function cleanupUnrecognized() {
  const bad = collection.ownedList().filter((e) => lookupFigure(e.charId, e.variantId).figure === null);
  for (const e of bad) await collection.removeOwned(e.charId, e.variantId);
  log(`Removed ${bad.length} unrecognized entr${bad.length === 1 ? 'y' : 'ies'}.`);
  renderCollection();
  catalog.render();
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
    catalog.render();
  } catch (err) {
    log(`Import failed: ${(err as Error).message}`);
  }
}

// ---- tabs ------------------------------------------------------------------

const tabPanels: Record<string, HTMLElement> = {
  collection: $<HTMLElement>('#tab-collection'),
  catalog: $<HTMLElement>('#tab-catalog'),
  scan: $<HTMLElement>('#tab-scan'),
};
function activateTab(target: string) {
  document
    .querySelectorAll<HTMLButtonElement>('.tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  for (const [name, panel] of Object.entries(tabPanels)) panel.hidden = name !== target;
}
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
});

function updateWelcomeCta() {
  welcomeSignin.hidden = signedIn;
}
welcomeBrowse.addEventListener('click', () => activateTab('catalog'));
welcomeSignin.addEventListener('click', () => $<HTMLButtonElement>('#signin-btn').click());

exportBtn.addEventListener('click', exportCollection);
importBtn.addEventListener('click', () => importFile.click());
cleanupBtn.addEventListener('click', () => void cleanupUnrecognized());
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
    slotsSection.hidden = false;
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
    figureDetailsEl.hidden = true;
  },
  inspectResult: renderInspectResult,
  editResult: renderEditResult,
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
  slotsSection.hidden = false;
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
        'Run the free <strong>Portal Station</strong> app and open <code>http://localhost:8777</code> ' +
        'for full identification and editing.';
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
  renderShowcase();
  await collection.load();
  catalog.render();

  if (!cloudEnabled) {
    // No backend: local-only collection (no accounts to keep separate).
    renderCollection();
    const owned = collection.stats().ownedFigures;
    if (owned > 0) log(`Collection restored: ${owned} figures.`);
  } else {
    // With a backend, the collection belongs to the signed-in account. Show the
    // welcome immediately and let auth decide what to display — never flash a
    // previous user's cached data.
    welcomeEl.hidden = false;
    dashboardEl.hidden = true;
  }

  // Cloud accounts + sync. The on-device cache is tagged with its owner so it
  // is only ever shown to that account; signing out (or in as someone else)
  // clears it. Supabase fires the listener more than once, so sync once per user.
  let syncedUser: string | null = null;
  initAuth(async (user) => {
    signedIn = Boolean(user);
    updateWelcomeCta();
    const newId = user?.id ?? null;
    const owner = collection.getOwner();

    if (!user) {
      // Signed out: never show an account's collection. Clear any cached data.
      if (owner || collection.stats().ownedFigures > 0) {
        await collection.clearLocal();
        collection.setOwner(null);
      }
      collection.setCloud(null);
      syncedUser = null;
      renderCollection();
      catalog.render();
      return;
    }

    collection.setCloud(makeCloudAdapter());
    // If the local cache belongs to a different account (or none), start clean
    // for this user before pulling their cloud data.
    if (owner !== newId) {
      await collection.clearLocal();
      collection.setOwner(newId);
    }
    if (syncedUser === newId) {
      renderCollection();
      catalog.render();
      return;
    }
    syncedUser = newId;
    renderCollection(); // show their cached data immediately (responsive)
    log(`Signed in as ${user.email ?? 'user'} — syncing…`);
    try {
      const r = await fullSync(collection);
      collection.setOwner(newId);
      log(`Sync complete: ${r.owned} figures, ${r.wishlist} wishlist.`);
    } catch (err) {
      log(`Sync failed: ${(err as Error).message}`);
      syncedUser = null; // allow a retry on the next auth event
    }
    renderCollection();
    catalog.render();
  });

  // Prefer the local helper (full identification on any portal/OS).
  helperClient = new HelperClient(helperEvents);
  if (await helperClient.connect()) return;
  log('No local portal helper found — browse mode. Run the Portal Station to scan.');
  document.querySelector<HTMLElement>('#scan-help')!.hidden = false;

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
