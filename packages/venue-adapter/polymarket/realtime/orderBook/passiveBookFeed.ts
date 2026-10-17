import { BOOK_LIMITS, reduceBookFrame, type LocalOrderBook } from "./bookReducer";
import type { BookFeed, BookFeedOptions } from "./feedTypes";
import type { MarketStreamEvent, MarketStreamState } from "../marketStreamProtocol";

/** [changmen 扩展] Passive source adapter: no WebSocket, fetch, heartbeat or reconnect authority. */
export class PassiveBookFeed implements BookFeed {
  private assets = new Set<string>();
  private books: ReadonlyMap<string, LocalOrderBook> = new Map();
  private state: MarketStreamState = { epoch: 0, source: "official", open: false };
  private sequence?: number;
  private generation = 0;
  private stopped = false;
  private windowAt = 0;
  private workMs = 0;
  private budgetBlocked = false;
  private now: () => number;
  constructor(private options: BookFeedOptions) { this.now = options.now ?? (() => performance.now()); }
  setAssets(ids: readonly string[]): void {
    if (this.stopped) return;
    const next = new Set([...new Set(ids)].filter(id => /^\d{1,256}$/.test(id)).slice(0, BOOK_LIMITS.assets));
    const removed = [...this.assets].filter(id => !next.has(id));
    if (removed.length) {
      this.books = new Map([...this.books].filter(([id]) => next.has(id)));
      this.options.unavailable?.(removed, "asset_removed");
      this.books = reduceBookFrame(this.books, [], next, this.generation, this.now(), Date.now()).books;
      this.options.publish(this.books);
    }
    this.assets = next;
  }
  reset(reason: string, assets?: readonly string[]): void {
    if (assets) {
      this.books = new Map([...this.books].filter(([asset]) => !assets.includes(asset)));
      this.options.unavailable?.(assets, reason);
    } else {
      ++this.generation; this.books = new Map(); this.options.invalidate(reason);
    }
  }
  accept(event: MarketStreamEvent): void {
    if (this.stopped) return;
    if (!this.options.allowed()) { this.stop(); return; }
    if (event.type === "state") {
      if (event.state.epoch < this.state.epoch) return;
      if (event.state.epoch !== this.state.epoch || event.state.open !== this.state.open || event.state.source !== this.state.source) {
        this.state = event.state; this.sequence = undefined; this.reset("stream_changed");
      }
      return;
    }
    if (!this.state.open || this.state.source !== "official" || event.epoch !== this.state.epoch) return;
    if (this.sequence !== undefined && event.sequence !== this.sequence + 1) {
      this.sequence = event.sequence; this.reset("stream_gap"); return;
    }
    this.sequence = event.sequence;
    if (!this.assets.size) return;
    const now = this.now();
    // Charge actual parse/filter/reduce work, not the number of unrelated shared-stream frames.
    // 20ms per 100ms window is a Worker work budget; a single operation remains bounded by frame size.
    if (now - this.windowAt >= 100) { this.windowAt = now; this.workMs = 0; this.budgetBlocked = false; }
    if (this.budgetBlocked) return;
    // Preserve the received state for display. Consumers own age policy; deltas
    // never refresh snapshotAt, so an expired snapshot cannot regain eligibility.
    let affected: string[] | undefined;
    try {
      if (event.raw.length > BOOK_LIMITS.frameChars) throw new Error("frame size");
      // Use ingress time, not worker dequeue time, for freshness.
      const receivedAt = event.receivedAt - performance.timeOrigin;
      if (now - receivedAt > 1_000 || receivedAt > now + 100) { this.reset("stream_queue_age"); return; }
      const parsed: unknown = JSON.parse(event.raw);
      const events: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const selected: unknown[] = [];
      for (const row of events) {
        const item = row as { event_type?: string; asset_id?: unknown; price_changes?: unknown } | null;
        if (!item || typeof item !== 'object') throw new Error('event');
        const relevant = (asset: unknown) => typeof asset !== 'string' || !/^\d+$/.test(asset) || this.assets.has(asset);
        if (item.event_type === 'book' || item.event_type === 'tick_size_change') {
          if (relevant(item.asset_id)) selected.push(item);
        } else if (item.event_type === 'price_change') {
          if (!Array.isArray(item.price_changes)) throw new Error('changes');
          const changes = item.price_changes.filter(change => relevant(change?.asset_id));
          if (changes.length) selected.push({ ...item, price_changes: changes });
        }
        // The existing event/level bounds apply to this consumer after asset demultiplexing.
        if (selected.length > BOOK_LIMITS.events) throw new Error('candidate events');
      }
      if (!selected.length) return; // BBO/trades/unrelated depth cannot refresh candidate age or history.
      const touched = selected.flatMap(row => {
        const item = row as { asset_id?: unknown; price_changes?: Array<{ asset_id?: unknown }> };
        return item.price_changes ? item.price_changes.map(change => change?.asset_id) : [item.asset_id];
      });
      if (touched.every(id => typeof id === "string" && this.assets.has(id))) affected = [...new Set(touched)] as string[];
      const next = reduceBookFrame(this.books, selected, this.assets, this.generation, receivedAt, event.wallAt);
      if (this.workMs + this.now() - now > 20) { this.budgetBlocked = true; this.reset("processing_budget"); return; }
      this.books = next.books;
      if (next.ticks.size) this.reset("tick_changed", [...next.ticks]);
      this.options.publish(this.books);
    } catch { this.reset("invalid_frame", affected); }
    finally {
      this.workMs += Math.max(0, this.now() - now);
      if (this.workMs > 20 && !this.budgetBlocked) { this.budgetBlocked = true; this.reset('processing_budget'); }
    }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.assets.clear(); this.reset("stopped");
  }
}
