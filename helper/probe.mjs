// Hardware probe: prove the control-pipe write path works for the console
// portal that Chrome's WebHID can't command on Windows.
//
//   node-hid  -> enumerate, get the device interface path (no handle held)
//   koffi     -> CreateFileW + HidD_SetOutputReport (control pipe!) + ReadFile
//
// HidD_SetOutputReport is exactly the call SkyReader/SkyDumper patched hidapi
// to use. If this round-trips a Ready response and a block read, the whole
// helper approach is validated.
import koffi from 'koffi';
import HID from 'node-hid';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_ID = 0x1430;
const here = dirname(fileURLToPath(import.meta.url));

// ---- figure DB (for the payoff: name the figure on the portal) -------------
const figures = JSON.parse(readFileSync(join(here, '..', 'src', 'figures', 'figures.json'), 'utf8'));
const byKey = new Map(figures.map((f) => [(f.charId << 16) | f.variantId, f]));
function lookup(charId, variantId) {
  return (
    byKey.get((charId << 16) | variantId) ||
    figures.find((f) => f.charId === charId) ||
    null
  );
}

// ---- Win32 via koffi -------------------------------------------------------
const kernel32 = koffi.load('kernel32.dll');
const hid = koffi.load('hid.dll');

const CreateFileW = kernel32.func(
  'void* __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void* sec, uint32 disp, uint32 flags, void* tmpl)',
);
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
const HidD_SetOutputReport = hid.func(
  'bool __stdcall HidD_SetOutputReport(void* dev, void* buf, uint32 len)',
);

const GENERIC_RW = 0xc0000000;
const SHARE_RW = 0x03;
const OPEN_EXISTING = 3;
const INVALID_HANDLE = 0xffffffffffffffffn;

const hex = (buf, n = buf.length) =>
  [...buf.slice(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// 33-byte output report: [reportId=0, 32 data bytes]. Command char goes at
// data[0] (= buffer[1]).
function makeReport(...data) {
  const buf = Buffer.alloc(33);
  data.forEach((b, i) => (buf[i + 1] = b));
  return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads use node-hid (event-based interrupt IN — the direction that already
// works). Writes use our own koffi handle via HidD_SetOutputReport (control
// pipe). Both handles share the device.
function makeWriter(handle) {
  return (label, ...data) => {
    const buf = makeReport(...data);
    const ok = HidD_SetOutputReport(handle, buf, buf.length);
    console.log(`  ${ok ? 'OK ' : 'ERR'} write ${label.padEnd(14)} (${ok ? 'sent' : 'GetLastError=' + GetLastError()})`);
    return ok;
  };
}

async function main() {
  const dev = HID.devices().find((d) => d.vendorId === VENDOR_ID);
  if (!dev) {
    console.log('No Activision portal (0x1430) found. Is it plugged in?');
    return;
  }
  console.log(`Portal: ${dev.product} ${dev.vendorId.toString(16)}:${dev.productId.toString(16)}`);
  console.log(`Path:   ${dev.path}\n`);

  // Read handle (node-hid).
  const reader = new HID.HID(dev.path);
  const reports = [];
  reader.on('data', (d) => reports.push(Buffer.from(d)));
  reader.on('error', (e) => console.log(`  reader error: ${e.message}`));

  // Write handle (koffi, control pipe).
  const handle = CreateFileW(dev.path, GENERIC_RW, SHARE_RW, null, OPEN_EXISTING, 0, null);
  if (koffi.address(handle) === INVALID_HANDLE) {
    console.log(`CreateFileW failed, GetLastError=${GetLastError()}`);
    reader.close();
    return;
  }
  const write = makeWriter(handle);
  const since = () => reports.length;
  const drain = (from) => reports.slice(from);

  try {
    await sleep(150); // let the status stream prime
    console.log(`Status stream alive: ${reports.some((r) => r[0] === 0x53) ? 'yes' : 'no'}\n`);

    let mark = since();
    write('Ready (R)', 0x52);
    await sleep(400);
    const ready = drain(mark).find((r) => r[0] === 0x52);
    console.log(`  Ready response: ${ready ? hex(ready, 16) : 'NONE'}\n`);

    write('Activate (A)', 0x41, 0x01);
    await sleep(300);

    console.log('Querying block 1 of figure on slot 0...');
    mark = since();
    write('Query b1', 0x51, 0x10, 0x01);
    await sleep(800);
    const q = drain(mark).find((r) => r[0] === 0x51);
    if (!q) {
      console.log('  No query response. Is a figure on the portal?');
      return;
    }
    console.log(`  Query response: ${hex(q, 19)}`);
    const block = q.subarray(3, 19); // 16 data bytes
    const charId = block[0] | (block[1] << 8);
    const variantId = (block[0x0c] << 8) | block[0x0d];
    console.log(`  Block 1 data:  ${hex(block)}`);
    console.log(`  charId=${charId} variantId=${variantId}`);
    const fig = lookup(charId, variantId);
    console.log(`\n  >>> FIGURE: ${fig ? fig.name : 'UNKNOWN'}${fig ? ' (' + fig.section + ')' : ''}`);
  } finally {
    CloseHandle(handle);
    reader.close();
  }
}

main();
