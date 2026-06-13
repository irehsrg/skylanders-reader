// Client for the local helper bridge (helper/server.mjs). When the helper is
// running it gives full figure identification via the portal's control-pipe
// command path, which WebHID can't reach on Windows.

export interface HelperFigure {
  slot: number;
  charId: number;
  variantId: number;
  name: string;
  section: string;
  unknown: boolean;
  uid: string | null;
}

export interface HelperEvents {
  hello(info: { product: string }): void;
  bye(): void;
  status(present: boolean[]): void;
  figure(fig: HelperFigure): void;
  removed(slot: number): void;
  log(msg: string): void;
  /** Connection to the helper itself opened/closed (not the portal). */
  connected(): void;
  disconnected(): void;
}

const HELPER_URL = 'ws://127.0.0.1:8777';

export class HelperClient {
  private ws: WebSocket | null = null;
  private events: HelperEvents;
  private closed = false;

  constructor(events: HelperEvents) {
    this.events = events;
  }

  /** Resolves true if the helper is reachable within `timeoutMs`. */
  connect(timeoutMs = 1200): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) { settled = true; resolve(ok); }
      };
      try {
        this.ws = new WebSocket(HELPER_URL);
      } catch {
        done(false);
        return;
      }
      const timer = setTimeout(() => done(false), timeoutMs);

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.events.connected();
        done(true);
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
      this.ws.onclose = () => {
        if (!this.closed) this.events.disconnected();
      };
      this.ws.onmessage = (ev) => this.dispatch(ev.data as string);
    });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private dispatch(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'hello': this.events.hello({ product: String(msg.product ?? 'Portal') }); break;
      case 'bye': this.events.bye(); break;
      case 'status': this.events.status(msg.present as boolean[]); break;
      case 'figure': this.events.figure(msg as unknown as HelperFigure); break;
      case 'removed': this.events.removed(msg.slot as number); break;
      case 'log': this.events.log(String(msg.msg ?? '')); break;
    }
  }
}
