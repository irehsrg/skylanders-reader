// Portal of Power over WebHID.
//
// Protocol summary (see CLAUDE.md and the SkyReader / SkylandersToolkit
// reference implementations):
//  - Command packets are 32 bytes; byte 0 is an ASCII command char.
//  - Commands go out via SET_REPORT. Some portal models accept this as an
//    output report, others only as a feature report — we try output first
//    and fall back, then remember which path worked.
//  - Responses arrive as `inputreport` events on the interrupt IN endpoint.
//  - 'S' status packets are auto-emitted ~50x/sec once activated.

export const ACTIVISION_VENDOR_ID = 0x1430;
const PACKET_SIZE = 0x20;
export const SLOT_COUNT = 16;

/**
 * Neither WebHID write path can reach this portal on this OS. Figure
 * presence detection still works; block reads (identification) do not.
 */
export class PortalWriteUnsupportedError extends Error {
  constructor() {
    super(
      'This portal model only accepts commands via a USB control transfer, ' +
        'which Chrome on Windows cannot send yet. Figure detection works, ' +
        'but identification is blocked by this browser limitation.',
    );
    this.name = 'PortalWriteUnsupportedError';
  }
}

export type SlotEvent =
  | { type: 'added'; slot: number }
  | { type: 'removed'; slot: number };

export interface PortalEvents {
  status(present: boolean[]): void;
  slot(event: SlotEvent): void;
  log(message: string): void;
  disconnected(): void;
}

interface PendingQuery {
  slot: number;
  block: number;
  resolve(data: Uint8Array): void;
  reject(err: Error): void;
  timer: number;
}

export class Portal {
  private device: HIDDevice;
  private events: PortalEvents;
  private writePath: 'output' | 'feature' | null = null;
  private present: boolean[] = new Array(SLOT_COUNT).fill(false);
  // Consecutive status frames a slot must hold a new state before we
  // report the transition. At ~50 status frames/sec this is ~100 ms.
  private static DEBOUNCE_FRAMES = 5;
  private pendingState: { state: boolean; frames: number }[] = Array.from(
    { length: SLOT_COUNT },
    () => ({ state: false, frames: 0 }),
  );
  private pendingQueries: PendingQuery[] = [];
  private readyResolve: ((data: Uint8Array) => void) | null = null;

  constructor(device: HIDDevice, events: PortalEvents) {
    this.device = device;
    this.events = events;
  }

  static isSupported(): boolean {
    return 'hid' in navigator;
  }

  /** Must be called from a user gesture. */
  static async request(events: PortalEvents): Promise<Portal | null> {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: ACTIVISION_VENDOR_ID }],
    });
    if (devices.length === 0) return null;
    return new Portal(devices[0], events);
  }

  /** Reconnect to a previously granted device without a chooser prompt. */
  static async fromGranted(events: PortalEvents): Promise<Portal | null> {
    const devices = await navigator.hid.getDevices();
    const dev = devices.find((d) => d.vendorId === ACTIVISION_VENDOR_ID);
    return dev ? new Portal(dev, events) : null;
  }

  get productName(): string {
    return this.device.productName || 'Portal of Power';
  }

  get idString(): string {
    const hex = (n: number) => n.toString(16).padStart(4, '0');
    return `${hex(this.device.vendorId)}:${hex(this.device.productId)}`;
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.onInputReport);
    navigator.hid.addEventListener('disconnect', this.onDisconnect);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onInputReport);
    navigator.hid.removeEventListener('disconnect', this.onDisconnect);
    if (this.device.opened) await this.device.close();
  }

  private onDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.device) {
      this.events.log('Portal disconnected.');
      this.events.disconnected();
    }
  };

  // ---- command writing -------------------------------------------------

  private async write(bytes: number[]): Promise<void> {
    const packet = new Uint8Array(PACKET_SIZE);
    packet.set(bytes.slice(0, PACKET_SIZE));

    if (this.writePath === 'output') {
      await this.device.sendReport(0, packet);
      return;
    }
    if (this.writePath === 'feature') {
      await this.device.sendFeatureReport(0, packet);
      return;
    }
    // First write: discover which SET_REPORT path this portal accepts.
    try {
      await this.device.sendReport(0, packet);
      this.writePath = 'output';
      this.events.log('Command path: output report');
    } catch (err) {
      this.events.log(`Output report write failed: ${(err as Error).name}: ${(err as Error).message}`);
      try {
        await this.device.sendFeatureReport(0, packet);
        this.writePath = 'feature';
        this.events.log('Command path: feature report');
      } catch {
        // Both write paths failed. Known hardware limitation: console portals
        // (0x0150) only accept commands as SET_REPORT on the control pipe
        // (what HidD_SetOutputReport does); they STALL the interrupt OUT
        // endpoint that Chromium's WriteFile-based sendReport uses on
        // Windows, and the HID report descriptor declares no feature
        // reports, so sendFeatureReport is rejected before reaching the
        // device. Figure presence still streams in, but blocks can't be
        // queried. See SkyDumper's patched hid_win.c for the desktop fix.
        throw new PortalWriteUnsupportedError();
      }
    }
  }

  /** 'R' — confirm portal presence, returns raw response (model info in bytes 1-2). */
  async ready(timeoutMs = 1500): Promise<Uint8Array> {
    const response = new Promise<Uint8Array>((resolve, reject) => {
      this.readyResolve = resolve;
      setTimeout(() => {
        if (this.readyResolve) {
          this.readyResolve = null;
          reject(new Error('No response to Ready command (R) — wrong write path or unsupported portal?'));
        }
      }, timeoutMs);
    });
    // Don't await the write before racing it against the response: on
    // Windows, writes to console portals can hang forever (stalled
    // interrupt OUT endpoint) — a hung write with no response is the
    // signature of that unsupported state.
    const writeState = { current: 'pending' as 'pending' | 'ok' | Error };
    const write = this.write([0x52]).then(
      () => { writeState.current = 'ok'; },
      (err: Error) => { writeState.current = err; },
    );
    try {
      return await response;
    } catch (timeoutErr) {
      await Promise.race([write, Promise.resolve()]);
      if (writeState.current === 'pending') throw new PortalWriteUnsupportedError();
      if (writeState.current instanceof Error) throw writeState.current;
      throw timeoutErr;
    }
  }

  /** 'A' — activate the portal (starts status stream, lights on some models). */
  async activate(): Promise<void> {
    await this.write([0x41, 0x01]); // 'A', on
  }

  /**
   * 'Q' — read one 16-byte block from the figure in `slot`.
   * Byte 1 is the figure index ORed with 0x20, byte 2 the block number
   * (matches the SkyReader read path; needs verification on real hardware).
   */
  async queryBlock(slot: number, block: number, timeoutMs = 2000): Promise<Uint8Array> {
    const response = new Promise<Uint8Array>((resolve, reject) => {
      const pending: PendingQuery = {
        slot,
        block,
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.pendingQueries = this.pendingQueries.filter((p) => p !== pending);
          reject(new Error(`Query timed out (slot ${slot}, block ${block})`));
        }, timeoutMs),
      };
      this.pendingQueries.push(pending);
    });
    // Fire the write without blocking on it — see ready() for why.
    this.write([0x51, 0x20 | slot, block]).catch(() => {}); // 'Q'
    return response;
  }

  // ---- response parsing ------------------------------------------------

  private onInputReport = (e: HIDInputReportEvent) => {
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (data.length === 0) return;
    switch (data[0]) {
      case 0x53: // 'S' status
        this.handleStatus(data);
        break;
      case 0x52: // 'R' ready
        if (this.readyResolve) {
          this.readyResolve(data);
          this.readyResolve = null;
        }
        break;
      case 0x51: { // 'Q' query response: echoes slot/block, data in bytes 3..18
        const slot = data[1] & 0x0f;
        const block = data[2];
        const idx = this.pendingQueries.findIndex((p) => p.slot === slot && p.block === block);
        // Fall back to oldest pending query if the echo doesn't match exactly
        // (some portals echo the index differently).
        const pending = idx >= 0 ? this.pendingQueries.splice(idx, 1)[0] : this.pendingQueries.shift();
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(data.slice(3, 3 + 16));
        }
        break;
      }
      default:
        // 'A' echo and anything else — ignore.
        break;
    }
  };

  private handleStatus(data: Uint8Array) {
    // Bytes 1-4: 32-bit little-endian, 2 bits per slot. Low bit = present.
    const status = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
    let changed = false;

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const present = ((status >>> (slot * 2)) & 1) === 1;
      const pending = this.pendingState[slot];

      if (present === this.present[slot]) {
        pending.frames = 0;
        continue;
      }
      // State differs from confirmed state — debounce before acting.
      if (pending.state === present) {
        pending.frames++;
      } else {
        pending.state = present;
        pending.frames = 1;
      }
      if (pending.frames >= Portal.DEBOUNCE_FRAMES) {
        this.present[slot] = present;
        pending.frames = 0;
        changed = true;
        this.events.slot({ type: present ? 'added' : 'removed', slot });
      }
    }
    if (changed) this.events.status([...this.present]);
  }
}
