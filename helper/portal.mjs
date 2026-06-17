// PortalHelper: talks to a console Skylanders portal on Windows using the
// control-pipe write path (HidD_SetOutputReport via koffi) that Chrome's
// WebHID can't use, plus node-hid for reads. Emits high-level events:
//   'open'   ({ product, idString })
//   'close'  ()
//   'status' (boolean[16])
//   'added'  ({ slot, charId, variantId, name, section, unknown })
//   'removed'({ slot })
//   'log'    (string)
// Protocol formats are documented in ../CLAUDE.md and were verified on real
// hardware (see probe.mjs).
import koffi from 'koffi';
import HID from 'node-hid';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_ID = 0x1430;
const SLOT_COUNT = 16;
const DEBOUNCE_FRAMES = 5;
const here = dirname(fileURLToPath(import.meta.url));

// ---- figure database -------------------------------------------------------
const figures = JSON.parse(readFileSync(join(here, '..', 'src', 'figures', 'figures.json'), 'utf8'));
const byKey = new Map(figures.map((f) => [(f.charId << 16) | f.variantId, f]));
const byChar = new Map();
for (const f of figures) {
  if (!byChar.has(f.charId)) byChar.set(f.charId, f);
}
// Try each candidate variant (the tag's byte order for the variant field is
// ambiguous, so we pass both big- and little-endian readings) and use whichever
// gives an exact catalogue match; fall back to the base character otherwise.
function lookup(charId, variantCandidates) {
  for (const v of variantCandidates) {
    const exact = byKey.get((charId << 16) | v);
    if (exact) return { ...exact, variantId: v, unknown: false };
  }
  const base = byChar.get(charId);
  const variantId = variantCandidates[0];
  if (base) return { ...base, variantId, unknown: true };
  return { name: 'Unknown figure', section: '', charId, variantId, unknown: true };
}

// ---- Win32 (write path) ----------------------------------------------------
const kernel32 = koffi.load('kernel32.dll');
const hidDll = koffi.load('hid.dll');
const CreateFileW = kernel32.func(
  'void* __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void* sec, uint32 disp, uint32 flags, void* tmpl)',
);
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
const HidD_SetOutputReport = hidDll.func(
  'bool __stdcall HidD_SetOutputReport(void* dev, void* buf, uint32 len)',
);
// Write-only: node-hid owns the read side. Requesting GENERIC_READ here too
// makes a second reader that starves node-hid of the autonomous status stream.
const GENERIC_WRITE = 0x40000000;
const SHARE_RW = 0x03;
const OPEN_EXISTING = 3;
const INVALID_HANDLE = 0xffffffffffffffffn;

export class PortalHelper extends EventEmitter {
  #reader = null;
  #handle = null;
  #present = new Array(SLOT_COUNT).fill(false);
  #pending = Array.from({ length: SLOT_COUNT }, () => ({ state: false, frames: 0 }));
  #queryWaiters = []; // { slot, block, resolve, timer }
  #busy = false;

  static findDevice() {
    return HID.devices().find((d) => d.vendorId === VENDOR_ID) || null;
  }

  open() {
    const dev = PortalHelper.findDevice();
    if (!dev) throw new Error('No Activision portal (0x1430) found.');

    this.#reader = new HID.HID(dev.path);
    this.#reader.on('data', (d) => this.#onData(d));
    this.#reader.on('error', (e) => {
      this.emit('log', `reader error: ${e.message}`);
      this.close();
    });

    this.#handle = CreateFileW(dev.path, GENERIC_WRITE, SHARE_RW, null, OPEN_EXISTING, 0, null);
    if (koffi.address(this.#handle) === INVALID_HANDLE) {
      const err = GetLastError();
      this.#reader.close();
      this.#reader = null;
      this.#handle = null;
      throw new Error(`CreateFileW failed (GetLastError=${err}). Is another app using the portal?`);
    }

    this.emit('open', { product: dev.product || 'Portal of Power', idString: `${hx(dev.vendorId)}:${hx(dev.productId)}` });
    this.#write('R', 0x52);
    this.#write('A', 0x41, 0x01);
  }

  close() {
    if (this.#handle) { CloseHandle(this.#handle); this.#handle = null; }
    if (this.#reader) { try { this.#reader.close(); } catch {} this.#reader = null; }
    for (const w of this.#queryWaiters.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
    this.#present.fill(false);
    this.#pending = Array.from({ length: SLOT_COUNT }, () => ({ state: false, frames: 0 }));
    this.emit('close');
  }

  get connected() {
    return this.#handle !== null;
  }

  #write(label, ...data) {
    if (!this.#handle) return false;
    const buf = Buffer.alloc(33);
    data.forEach((b, i) => (buf[i + 1] = b));
    const ok = HidD_SetOutputReport(this.#handle, buf, buf.length);
    if (!ok) this.emit('log', `write ${label} failed (GetLastError=${GetLastError()})`);
    return ok;
  }

  #onData(d) {
    switch (d[0]) {
      case 0x53: this.#onStatus(d); break;
      case 0x51: this.#onQuery(d); break;
      default: break; // R/A echoes
    }
  }

  #onStatus(d) {
    const status = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24);
    let changed = false;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const present = ((status >>> (slot * 2)) & 1) === 1;
      const p = this.#pending[slot];
      if (present === this.#present[slot]) { p.frames = 0; continue; }
      if (p.state === present) p.frames++;
      else { p.state = present; p.frames = 1; }
      if (p.frames >= DEBOUNCE_FRAMES) {
        this.#present[slot] = present;
        p.frames = 0;
        changed = true;
        if (present) this.#identify(slot);
        else this.emit('removed', { slot });
      }
    }
    if (changed) this.emit('status', [...this.#present]);
  }

  #onQuery(d) {
    const block = d[2];
    const i = this.#queryWaiters.findIndex((w) => w.block === block);
    const w = i >= 0 ? this.#queryWaiters.splice(i, 1)[0] : this.#queryWaiters.shift();
    if (w) { clearTimeout(w.timer); w.resolve(Buffer.from(d.subarray(3, 19))); }
  }

  #query(slot, block, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const waiter = { slot, block, resolve, timer: setTimeout(() => {
        this.#queryWaiters = this.#queryWaiters.filter((x) => x !== waiter);
        resolve(null);
      }, timeoutMs) };
      this.#queryWaiters.push(waiter);
      this.#write('Q', 0x51, 0x10 + slot, block);
    });
  }

  /**
   * Write prepared blocks to the figure in `slot`, read-back-verifying each
   * (retry up to 3×, abort on persistent mismatch). `writes` MUST be ordered
   * data-blocks-first, header-last so a mid-write abort leaves the old save
   * area intact. Never pass block 0 or sector trailers.
   */
  async writeFigure(slot, writes) {
    while (this.#busy) await sleep(20);
    this.#busy = true;
    try {
      for (const w of writes) {
        if (w.block === 0 || w.block % 4 === 3) throw new Error(`refusing protected block 0x${w.block.toString(16)}`);
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          this.#write('W', 0x57, 0x10 + slot, w.block, ...w.bytes);
          await sleep(130);
          const back = await this.#query(slot, w.block);
          ok = back && Buffer.compare(Buffer.from(back), Buffer.from(w.bytes)) === 0;
        }
        if (!ok) throw new Error(`write verify failed at block 0x${w.block.toString(16)}`);
      }
    } finally {
      this.#busy = false;
    }
  }

  /** Read all 64 blocks of the figure in `slot` (non-destructive). */
  async dumpAll(slot) {
    while (this.#busy) await sleep(20);
    this.#busy = true;
    try {
      const blocks = [];
      for (let b = 0; b < 64; b++) {
        const data = await this.#query(slot, b);
        blocks.push(data ? [...data] : null);
      }
      return blocks;
    } finally {
      this.#busy = false;
    }
  }

  async #identify(slot) {
    // Serialize queries — the portal handles one block read at a time.
    while (this.#busy) await sleep(20);
    this.#busy = true;
    try {
      const block1 = await this.#query(slot, 1);
      if (!block1) { this.emit('log', `slot ${slot + 1}: read timed out`); return; }
      const charId = block1[0] | (block1[1] << 8);
      const variantBE = (block1[0x0c] << 8) | block1[0x0d];
      const variantLE = block1[0x0c] | (block1[0x0d] << 8);
      const fig = lookup(charId, [variantBE, variantLE]);
      const variantId = fig.variantId;
      const hex = [...block1].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      this.emit('log', `slot ${slot + 1} block1 [${hex}] char=${charId} vBE=${variantBE} vLE=${variantLE}`);
      // Block 0 holds the MIFARE manufacturer block; bytes 0-3 are the tag's
      // unique ID (never all-zero), which distinguishes two physical copies of
      // the same figure. Block-0 reads occasionally come back all zeros — retry
      // until we get a real UID so we don't record phantom duplicate copies.
      let uid = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const block0 = await this.#query(slot, 0);
        if (block0 && [...block0.subarray(0, 4)].some((b) => b !== 0)) {
          uid = [...block0.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
          break;
        }
        await sleep(40);
      }
      this.emit('added', { slot, charId, variantId, uid, name: fig.name, section: fig.section, unknown: fig.unknown });
    } finally {
      this.#busy = false;
    }
  }
}

const hx = (n) => n.toString(16).padStart(4, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
