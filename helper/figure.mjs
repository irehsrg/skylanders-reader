// Skylanders figure decode + write-preparation. Read paths are non-destructive.
// Write prep produces the exact blocks to send but does NOT touch the portal;
// the actual write + read-back-verify lives in portal.mjs / server.mjs.
//
// Safety design: the Type-2/3 checksum input construction is DISCOVERED from
// the figure's own already-valid checksums, then reused for the rewrite. If a
// figure's checksums can't be reproduced (traps, Creation Crystals, unknown
// formats), prep refuses — so we never write a figure we don't fully model.
import { decryptBlock, encryptBlock, crc16, isSectorTrailer } from './crypto.mjs';

// Data block offsets (from a save area's header block H), in order, skipping
// the two sector trailers (H+3, H+7) and the header itself.
const DATA_OFFSETS = [1, 2, 4, 5, 6, 8];
const PAD_LENGTHS = [0, 0x30, 0x40, 0x60, 0x110, 0x120, 0x200];

function dec(tag32, blocks, idx) {
  const b = blocks[idx];
  return b ? decryptBlock(tag32, idx, Buffer.from(b)) : null;
}
function decodeUtf16(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s;
}
function encodeUtf16(name, totalBytes) {
  const out = Buffer.alloc(totalBytes);
  const max = Math.floor((totalBytes - 2) / 2); // leave room for a null terminator
  for (let i = 0; i < Math.min(name.length, max); i++) {
    out.writeUInt16LE(name.charCodeAt(i), i * 2);
  }
  return out;
}

// Concatenate a contiguous slice [i,j) of the 6 data blocks, zero-padded to
// `pad` bytes, and CRC it.
function crcOf(dataBlocks, i, j, pad) {
  const base = Buffer.concat(dataBlocks.slice(i, j));
  const buf = pad > base.length ? Buffer.concat([base, Buffer.alloc(pad - base.length)]) : base;
  return crc16(buf);
}

// Discover {i, j, pad} such that crcOf(...) === target. null if none.
function discover(dataBlocks, target) {
  for (let i = 0; i < dataBlocks.length; i++) {
    for (let j = i + 1; j <= dataBlocks.length; j++) {
      if (dataBlocks.slice(i, j).some((b) => !b)) continue;
      for (const pad of PAD_LENGTHS) {
        if (crcOf(dataBlocks, i, j, pad) === target) return { i, j, pad };
      }
    }
  }
  return null;
}

function fmt(c) {
  return c ? `[${c.i},${c.j})${c.pad ? '+pad0x' + c.pad.toString(16) : ''}` : null;
}

// Decode one area; returns decrypted header + the 6 data blocks + stored sums.
function readArea(tag32, blocks, H) {
  const header = dec(tag32, blocks, H);
  if (!header) return null;
  const data = DATA_OFFSETS.map((o) => dec(tag32, blocks, H + o));
  return {
    H,
    header,
    data,
    seq: header[0x09],
    storedT3: header[0x0a] | (header[0x0b] << 8),
    storedT2: header[0x0c] | (header[0x0d] << 8),
    storedT1: header[0x0e] | (header[0x0f] << 8),
  };
}

function statsOf(area) {
  const h = area.header;
  return {
    xp: h[0] | (h[1] << 8) | (h[2] << 16),
    gold: h[3] | (h[4] << 8),
    hat: area.data[0] ? area.data[0][0x04] | (area.data[0][0x05] << 8) : null,
    heroPoints: area.data[3] ? area.data[3][0x0a] | (area.data[3][0x0b] << 8) : null,
    nickname: decodeUtf16(Buffer.concat([area.data[1] ?? Buffer.alloc(16), area.data[2] ?? Buffer.alloc(16)])),
  };
}

function type1Of(header) {
  const h = Buffer.from(header);
  h[0x0e] = 0x05;
  h[0x0f] = 0x00;
  return crc16(h);
}

// Decode the full figure (active area) for display + checksum verification.
export function inspectFigure(rawBlocks) {
  const blocks = rawBlocks.map((b) => (b ? Buffer.from(b) : null));
  if (!blocks[0] || !blocks[1]) return { ok: false, error: 'missing identity blocks (0/1)' };
  const tag32 = Buffer.concat([blocks[0], blocks[1]]);
  const charId = blocks[1][0] | (blocks[1][1] << 8);
  const variantId = (blocks[1][0x0c] << 8) | blocks[1][0x0d];

  const a0 = readArea(tag32, blocks, 0x08);
  const a1 = readArea(tag32, blocks, 0x24);
  if (!a0 || !a1) return { ok: false, error: 'missing data areas', charId, variantId };
  const active = a1.seq > a0.seq ? a1 : a0;

  const t1 = type1Of(active.header);
  const c2 = discover(active.data, active.storedT2);
  const c3 = discover(active.data, active.storedT3);

  return {
    ok: true,
    charId,
    variantId,
    activeArea: active === a1 ? 1 : 0,
    seq0: a0.seq,
    seq1: a1.seq,
    stats: statsOf(active),
    checksums: {
      type1: { stored: active.storedT1, computed: t1, match: active.storedT1 === t1 },
      type2: { stored: active.storedT2, matchedBy: fmt(c2) },
      type3: { stored: active.storedT3, matchedBy: fmt(c3) },
    },
  };
}

/**
 * Build the blocks to write for an edit, WITHOUT touching the portal.
 * edits: { gold?, xp?, heroPoints?, nickname?, reset? }
 * Returns { writes:[{block,bytes}], inactiveArea, newSeq } or throws if the
 * figure can't be safely modeled.
 */
export function prepareWrite(rawBlocks, edits = {}) {
  const blocks = rawBlocks.map((b) => (b ? Buffer.from(b) : null));
  if (!blocks[0] || !blocks[1]) throw new Error('missing identity blocks');
  const tag32 = Buffer.concat([blocks[0], blocks[1]]);

  const a0 = readArea(tag32, blocks, 0x08);
  const a1 = readArea(tag32, blocks, 0x24);
  if (!a0 || !a1) throw new Error('missing data areas');
  const active = a1.seq > a0.seq ? a1 : a0;
  const inactive = active === a1 ? a0 : a1;

  // Self-validate: the active area's three checksums must reproduce exactly,
  // or we don't understand this figure well enough to write it.
  const c2 = discover(active.data, active.storedT2);
  const c3 = discover(active.data, active.storedT3);
  if (type1Of(active.header) !== active.storedT1 || !c2 || !c3) {
    throw new Error('checksum construction not recognized — unsupported figure type, refusing to write');
  }

  // New inactive area = copy of the current active area's decrypted contents.
  const header = Buffer.from(active.header);
  const data = active.data.map((b) => Buffer.from(b));

  if (edits.reset) {
    header.fill(0, 0, 9); // xp/gold/etc. up to (not including) seq
    for (const b of data) b.fill(0);
  }
  if (edits.gold != null) header.writeUInt16LE(Math.min(edits.gold & 0xffff, 65000), 3);
  if (edits.xp != null) {
    const xp = Math.min(edits.xp >>> 0, 33000);
    header[0] = xp & 0xff;
    header[1] = (xp >> 8) & 0xff;
    header[2] = (xp >> 16) & 0xff;
  }
  if (edits.heroPoints != null) data[3].writeUInt16LE(Math.min(edits.heroPoints & 0xffff, 100), 0x0a);
  if (edits.nickname != null) {
    const enc = encodeUtf16(String(edits.nickname), 32);
    enc.copy(data[1], 0, 0, 16);
    enc.copy(data[2], 0, 16, 32);
  }

  // Bump sequence, then recompute checksums in the required order (3, 2, 1).
  header[0x09] = (active.seq + 1) & 0xff;
  const t3 = crcOf(data, c3.i, c3.j, c3.pad);
  header.writeUInt16LE(t3, 0x0a);
  const t2 = crcOf(data, c2.i, c2.j, c2.pad);
  header.writeUInt16LE(t2, 0x0c);
  header.writeUInt16LE(type1Of(header), 0x0e);

  // Re-encrypt with the INACTIVE block indices (key depends on block index).
  const Hin = inactive.H;
  const writes = [];
  DATA_OFFSETS.forEach((o, k) => {
    const idx = Hin + o;
    if (isSectorTrailer(idx) || idx === 0) throw new Error('refusing to write protected block');
    writes.push({ block: idx, bytes: [...encryptBlock(tag32, idx, data[k])] });
  });
  // Header LAST so a partial write leaves the old area winning.
  writes.push({ block: Hin, bytes: [...encryptBlock(tag32, Hin, header)] });

  return { writes, inactiveArea: inactive === a1 ? 1 : 0, newSeq: header[0x09] };
}

/**
 * Dry run: build a no-op write, apply it to a copy in memory, decode the
 * result, and confirm the rewritten area becomes active with identical stats
 * and all checksums valid. Proves the write pipeline on a real dump with NO
 * portal write.
 */
export function selfTestWrite(rawBlocks) {
  try {
    const before = inspectFigure(rawBlocks);
    if (!before.ok) return { pass: false, reason: before.error };
    const prep = prepareWrite(rawBlocks, {}); // no-op
    const clone = rawBlocks.map((b) => (b ? [...b] : null));
    for (const w of prep.writes) clone[w.block] = [...w.bytes];
    const after = inspectFigure(clone);
    const c = after.checksums;
    const checksumsOk = c.type1.match && c.type2.matchedBy && c.type3.matchedBy;
    const statsSame = JSON.stringify(after.stats) === JSON.stringify(before.stats);
    const areaFlipped = after.activeArea === prep.inactiveArea;
    return {
      pass: checksumsOk && statsSame && areaFlipped,
      checksumsOk,
      statsSame,
      areaFlipped,
      newActiveArea: after.activeArea,
    };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}
