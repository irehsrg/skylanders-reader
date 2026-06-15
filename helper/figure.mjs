// Read-only Skylanders figure decoder + checksum validator.
//
// Given a full 64-block dump, decrypts the active save-data area and decodes
// stats. It also VALIDATES checksums against what's stored on the tag — Type 1
// directly, and Types 2/3 by searching which block ranges reproduce the stored
// value. This proves the crypto/checksum code is correct on real data before
// any write is ever attempted. Nothing here writes to a figure.
import { decryptBlock, crc16 } from './crypto.mjs';

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

// Find which contiguous range of the area's data blocks reproduces a stored
// checksum (empirically pins the Type-2/3 input ranges from real data).
function findRange(decs, idxList, target) {
  for (let i = 0; i < decs.length; i++) {
    for (let j = i + 1; j <= decs.length; j++) {
      const slice = decs.slice(i, j);
      if (slice.some((s) => !s)) continue;
      if (crc16(Buffer.concat(slice)) === target) {
        return idxList.slice(i, j).map((x) => '0x' + x.toString(16)).join(',');
      }
    }
  }
  return null;
}

export function inspectFigure(rawBlocks) {
  const blocks = rawBlocks.map((b) => (b ? Buffer.from(b) : null));
  if (!blocks[0] || !blocks[1]) return { ok: false, error: 'missing identity blocks (0/1)' };

  const tag32 = Buffer.concat([blocks[0], blocks[1]]);
  const charId = blocks[1][0] | (blocks[1][1] << 8);
  const variantId = (blocks[1][0x0c] << 8) | blocks[1][0x0d];

  const h0 = dec(tag32, blocks, 0x08);
  const h1b = dec(tag32, blocks, 0x24);
  if (!h0 || !h1b) return { ok: false, error: 'missing data areas (0x08/0x24)', charId, variantId };

  const seq0 = h0[0x09];
  const seq1 = h1b[0x09];
  const useArea1 = seq1 > seq0;
  const H = useArea1 ? 0x24 : 0x08;
  const header = useArea1 ? h1b : h0;

  const xp = header[0] | (header[1] << 8) | (header[2] << 16);
  const gold = header[3] | (header[4] << 8);
  const storedT3 = header[0x0a] | (header[0x0b] << 8);
  const storedT2 = header[0x0c] | (header[0x0d] << 8);
  const storedT1 = header[0x0e] | (header[0x0f] << 8);

  const skills = dec(tag32, blocks, H + 1);
  const hat = skills ? skills[0x04] | (skills[0x05] << 8) : null;
  const name1 = dec(tag32, blocks, H + 2);
  const name2 = dec(tag32, blocks, H + 4);
  const nickname = decodeUtf16(Buffer.concat([name1 ?? Buffer.alloc(16), name2 ?? Buffer.alloc(16)]));
  const hpBlock = dec(tag32, blocks, H + 5);
  const heroPoints = hpBlock ? hpBlock[0x0a] | (hpBlock[0x0b] << 8) : null;

  // Type 1: CRC16 of the 16-byte header with 0x0E/0x0F seeded to 05 00.
  const h1seed = Buffer.from(header);
  h1seed[0x0e] = 0x05;
  h1seed[0x0f] = 0x00;
  const t1 = crc16(h1seed);

  // Type 2/3: discover the input range from the area's non-trailer data blocks.
  const dataIdx = [H + 1, H + 2, H + 4, H + 5, H + 6, H + 8];
  const decs = dataIdx.map((i) => dec(tag32, blocks, i));

  return {
    ok: true,
    charId,
    variantId,
    activeArea: useArea1 ? 1 : 0,
    seq0,
    seq1,
    stats: { xp, gold, hat, heroPoints, nickname },
    checksums: {
      type1: { stored: storedT1, computed: t1, match: storedT1 === t1 },
      type2: { stored: storedT2, matchedBy: findRange(decs, dataIdx, storedT2) },
      type3: { stored: storedT3, matchedBy: findRange(decs, dataIdx, storedT3) },
    },
  };
}
