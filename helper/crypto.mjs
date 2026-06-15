// Skylanders figure crypto + checksums. Ported from the verified spec
// (SkyReader crypt.cpp/checksum.cpp, cross-checked vs Dolphin SkylanderCrypto).
//
// DO NOT "improve" these constants or ranges — wrong values brick figures.
import { createHash, createCipheriv, createDecipheriv } from 'node:crypto';

// 53-byte constant: " Copyright (C) 2010 Activision. All Rights Reserved. "
// EXACT — leading and trailing space, no null terminator.
const COPYRIGHT = Buffer.from([
  0x20, 0x43, 0x6f, 0x70, 0x79, 0x72, 0x69, 0x67, 0x68, 0x74, 0x20, 0x28, 0x43, 0x29, 0x20, 0x32,
  0x30, 0x31, 0x30, 0x20, 0x41, 0x63, 0x74, 0x69, 0x76, 0x69, 0x73, 0x69, 0x6f, 0x6e, 0x2e, 0x20,
  0x41, 0x6c, 0x6c, 0x20, 0x52, 0x69, 0x67, 0x68, 0x74, 0x73, 0x20, 0x52, 0x65, 0x73, 0x65, 0x72,
  0x76, 0x65, 0x64, 0x2e, 0x20,
]);

export const BLOCK_SIZE = 16;
export const BLOCK_COUNT = 64;

/** A block is encrypted iff index >= 8 and it isn't a sector trailer. */
export function isEncrypted(blockIndex) {
  return blockIndex >= 8 && blockIndex % 4 !== 3;
}
export function isSectorTrailer(blockIndex) {
  return blockIndex % 4 === 3;
}

/** Per-block AES key = MD5(tag[0x00..0x1F] ++ blockIndex ++ COPYRIGHT). */
function blockKey(tag32, blockIndex) {
  return createHash('md5')
    .update(Buffer.concat([tag32.subarray(0, 0x20), Buffer.from([blockIndex]), COPYRIGHT]))
    .digest();
}

export function decryptBlock(tag32, blockIndex, cipher16) {
  const d = createDecipheriv('aes-128-ecb', blockKey(tag32, blockIndex), null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(cipher16), d.final()]);
}

export function encryptBlock(tag32, blockIndex, plain16) {
  const c = createCipheriv('aes-128-ecb', blockKey(tag32, blockIndex), null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(plain16), c.final()]);
}

/** CRC-16-CCITT, polynomial 0x1021, init 0xFFFF, MSB-first. */
export function crc16(buf) {
  let crc = 0xffff;
  for (const byte of buf) {
    let x = (byte << 8) & 0xffff;
    for (let i = 0; i < 8; i++) {
      const bit = (crc ^ x) & 0x8000 ? 1 : 0;
      crc = ((crc << 1) & 0xffff) ^ (bit ? 0x1021 : 0);
      x = (x << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}
