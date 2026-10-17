import { BOOK_LIMITS, reduceBookFrame, type LocalOrderBook } from "../../realtime/orderBook/bookReducer";

export interface FeedOptions {
  allowed: () => boolean;
  publish: (books: ReadonlyMap<string, LocalOrderBook>) => void;
  invalidate: (reason: string) => void;
  unavailable?: (assets: readonly string[], reason: string) => void;
  socket?: (url: string) => WebSocket;
  now?: () => number;
}
/** 私有官方连接；每次候选变化/重连都递增 epoch，绝不续用上一代深度。 */
export class DirectBookFeed {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setInterval>;
  private assets = new Set<string>();
  private books: ReadonlyMap<string, LocalOrderBook> = new Map();
  private missing = new Set<string>();
  private epoch = 0;
  private stopped = true;
  private retryAt = 0;
  private failures = 0;
  private openedAt = 0;
  private lastPong = 0;
  private lastPing = 0;
  private windowAt = 0;
  private frames = 0;
  private now: () => number;
  constructor(private options: FeedOptions) { this.now = options.now ?? (() => performance.now()); }
  setAssets(ids: readonly string[]): void {
    const next = [...new Set(ids)].filter(id => /^\d+$/.test(id)).slice(0, BOOK_LIMITS.assets).sort();
    if (next.join(",") === [...this.assets].join(",") && !this.stopped) return;
    this.stop(); this.assets = new Set(next);
    if (!next.length || !this.options.allowed()) return;
    this.stopped = false; this.retryAt = 0; this.failures = 0;
    this.timer = setInterval(() => this.tick(), 1_000);
    this.tick();
  }
  private invalidate(reason: string): void {
    ++this.epoch;
    const old = this.socket; this.socket = undefined;
    if (old) {
      old.onopen = old.onmessage = old.onclose = null;
      old.onerror = () => {}; // A connecting socket can report an asynchronous close error.
      try { old.close(); } catch { /* local close */ }
    }
    this.books = new Map(); this.missing.clear(); this.options.invalidate(reason);
  }
  private fail(reason: string): void {
    this.invalidate(reason);
    this.retryAt = this.now() + Math.min(30_000, 1_000 * 2 ** Math.min(this.failures++, 5));
  }
  private tick(): void {
    if (this.stopped) return;
    if (!this.options.allowed()) { this.stop(); return; }
    const now = this.now();
    if (!this.socket) { if (now >= this.retryAt) this.connect(); return; }
    if (now - this.openedAt > 8_000) {
      const missing = [...this.assets].filter(asset => !this.books.has(asset) && !this.missing.has(asset));
      for (const asset of missing) this.missing.add(asset);
      if (missing.length) this.options.unavailable?.(missing, "snapshot_timeout");
      // Missing assets stay unusable; retry on the bounded 60s snapshot cycle. Healthy assets survive.
    }
    if (now - this.lastPong > 30_000) { this.fail("heartbeat_timeout"); return; }
    // Continuous deltas must not extend snapshot trust indefinitely. No HTTP overlay.
    if (now - this.openedAt > 60_000) { this.fail("periodic_resnapshot"); return; }
    if (this.socket.readyState === 1 && now - this.lastPing >= 10_000) {
      try { this.socket.send("PING"); this.lastPing = now; } catch { this.fail("ping_failed"); }
    }
  }
  private connect(): void {
    if (!this.options.allowed()) { this.stop(); return; }
    const epoch = ++this.epoch;
    let socket: WebSocket;
    try { socket = (this.options.socket ?? (url => new WebSocket(url)))("wss://ws-subscriptions-clob.polymarket.com/ws/market"); }
    catch { this.fail("connect_failed"); return; }
    this.socket = socket;
    this.openedAt = this.lastPong = this.lastPing = this.now();
    const current = () => !this.stopped && this.socket === socket && this.epoch === epoch && this.options.allowed();
    socket.onopen = () => {
      if (!current()) return;
      try { socket.send(JSON.stringify({ type: "market", assets_ids: [...this.assets], initial_dump: true, custom_feature_enabled: true })); }
      catch { this.fail("subscribe_failed"); }
    };
    socket.onmessage = event => {
      if (!current()) { if (this.socket === socket) this.stop(); return; }
      const now = this.now();
      if (event.data === "PONG") { this.lastPong = now; return; }
      if (now - this.windowAt >= 1_000) { this.windowAt = now; this.frames = 0; }
      if (++this.frames > 500) { this.fail("frame_rate_limit"); return; }
      try {
        if (typeof event.data !== "string" || event.data.length > BOOK_LIMITS.frameChars) throw new Error("frame");
        const next = reduceBookFrame(this.books, JSON.parse(event.data), this.assets, epoch, now, Date.now());
        if (this.now() - now > 20) { this.fail("processing_budget"); return; }
        if (next.ticks.size) { this.fail("tick_changed"); return; }
        this.books = next.books;
        if (this.books.size === this.assets.size) this.failures = 0;
        this.options.publish(this.books);
      } catch { this.fail("invalid_frame"); }
    };
    socket.onerror = socket.onclose = () => { if (current()) this.fail("disconnected"); };
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.invalidate("stopped");
  }
  /** Standalone adapter only; production passive shadow never constructs this feed. */
  reset(reason: string, assets?: readonly string[]): void {
    if (assets) { this.books = new Map([...this.books].filter(([id]) => !assets.includes(id))); this.options.unavailable?.(assets, reason); return; }
    const ids = [...this.assets]; this.stop(); this.setAssets(ids);
  }
}
