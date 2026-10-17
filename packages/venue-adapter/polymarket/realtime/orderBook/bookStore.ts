import { BOOK_LIMITS, numericAsks, type LocalOrderBook } from "./bookReducer";
import { PassiveBookFeed } from "./passiveBookFeed";
import type { BookFeed, BookFeedOptions } from "./feedTypes";

export type BookStoreEvent = { reason: string; assets?: readonly string[] };
export interface IntegrityEvidence {
  generation: number; asset: string; sourceAt: number; before: readonly LocalOrderBook[];
  asks: Array<{ price: number; size: number }>; book?: LocalOrderBook;
}
export interface BookReader {
  readonly generation: number;
  assetGeneration(asset: string): number;
  statistics(): Record<string, number>;
  history(asset: string): readonly LocalOrderBook[];
  onInvalidate(listener: (event: BookStoreEvent) => void): () => void;
  reportIntegrity(evidence: IntegrityEvidence): void;
}
export interface DepthView {
  sessionId?: number; streamEpoch?: number;
  asset: string; status: string; generation: number; assetGeneration?: number; epoch?: number; revision?: number;
  sourceAt?: number; receivedWallAt?: number; snapshotAgeMs?: number; receivedAgeMs?: number;
  bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }>;
  viewTruncated?: boolean; snapshotEvidence?: boolean;
}
/** Complete immutable read, with shared monotonic timestamps; never a trading decision. */
export interface FullBookView extends DepthView {
  market?: string; receivedClockAt?: number; snapshotClockAt?: number;
  processedSequence?: number;
}
/** Public market state only. No preflight, credentials, HTTP or network lifecycle dependencies. */
export class BookStore {
  private rows = new Map<string, LocalOrderBook[]>();
  private listeners = new Set<(event: BookStoreEvent) => void>();
  private known = new WeakMap<LocalOrderBook, number>();
  private assetVersions = new Map<string, number>();
  private assetSerial = 0;
  private version = 0;
  private publication = 0;
  get revision(): number { return this.publication; }
  private counters: Record<string, number> = {};
  private stopped = false;
  readonly feed: BookFeed;
  readonly reader: BookReader;
  constructor(allowed: () => boolean, factory: (options: BookFeedOptions) => BookFeed = options => new PassiveBookFeed(options)) {
    this.feed = factory({ allowed, publish: books => {
      for (const [asset, book] of books) {
        const rows = this.rows.get(asset) ?? [];
        if (rows.at(-1) !== book) { ++this.publication; rows.push(book); const key = book.snapshotHash ? "snapshot_received" : "increment_state_received"; this.counters[key] = (this.counters[key] ?? 0) + 1; }
        if (!this.assetVersions.has(asset)) this.assetVersions.set(asset, ++this.assetSerial);
        this.known.set(book, this.assetVersions.get(asset)!); this.rows.set(asset, rows.slice(-BOOK_LIMITS.history));
      }
    }, unavailable: (assets, reason) => this.invalidate(reason, assets), invalidate: reason => this.invalidate(reason) });
    const owner = this;
    this.reader = Object.freeze({ get generation() { return owner.version; },
      assetGeneration: (asset: string) => owner.assetVersions.get(asset) ?? 0,
      statistics: () => ({ ...owner.counters }),
      history: (asset: string) => Object.freeze([...(owner.rows.get(asset) ?? [])]),
      onInvalidate: (fn: (event: BookStoreEvent) => void) => { owner.listeners.add(fn); return () => { owner.listeners.delete(fn); }; },
      reportIntegrity: (evidence: IntegrityEvidence) => owner.checkIntegrity(evidence) });
  }
  private invalidate(reason: string, assets?: readonly string[]): void {
    ++this.publication;
    if (assets) for (const asset of assets) { this.rows.delete(asset); this.assetVersions.delete(asset); }
    else { ++this.version; this.rows.clear(); this.assetVersions.clear(); }
    for (const fn of this.listeners) { try { fn({ reason, assets }); } catch { this.listeners.delete(fn); } }
  }
  private checkIntegrity(e: IntegrityEvidence): void {
    if (this.stopped || e.generation !== this.version || !e.before.length || e.before.length > BOOK_LIMITS.history || e.asks.length > BOOK_LIMITS.levels) return;
    const current = this.rows.get(e.asset)?.at(-1);
    if (!current || e.before.some(row => this.known.get(row) !== this.assetVersions.get(e.asset) || row.asset !== e.asset || row.epoch !== current.epoch)) return;
    const rows = [...e.before, ...(this.rows.get(e.asset) ?? [])], aligned = rows.filter(row => row.sourceAt === e.sourceAt);
    const equal = (a: ReturnType<typeof numericAsks>, b: ReturnType<typeof numericAsks>) => a.length === b.length && a.every((r, i) => r.price === b[i]?.price && r.size === b[i]?.size);
    if (!aligned.length || aligned.some(row => !equal(numericAsks(row), numericAsks(aligned[0]!)))) return;
    let difference = !equal(numericAsks(aligned[0]!), e.asks);
    if (e.book) {
      if (e.book.asset !== e.asset || e.book.sourceAt !== e.sourceAt) return;
      const bids = (row: LocalOrderBook) => JSON.stringify([...row.bids].sort());
      if (aligned.some(row => bids(row) !== bids(aligned[0]!))) return;
      difference ||= bids(e.book) !== bids(aligned[0]!) || e.book.market !== current.market;
    }
    if (difference) this.feed.reset("aligned_difference", [e.asset]);
  }
  depth(asset: string, levels = 20): DepthView {
    const book = this.rows.get(asset)?.at(-1), now = performance.now();
    const base = { asset, generation: this.version, assetGeneration: this.reader.assetGeneration(asset) };
    if (!book) return { ...base, status: this.stopped ? "stopped" : "waiting_snapshot" };
    const count = Number.isFinite(levels) ? Math.min(50, Math.max(1, Math.floor(levels))) : 20;
    const key = (price: string) => (price.split(".")[1] ?? "").padEnd(18, "0");
    const side = (rows: ReadonlyMap<string, string>, direction: number) => [...rows].sort((a, b) => direction * (key(a[0]) < key(b[0]) ? -1 : key(a[0]) > key(b[0]) ? 1 : 0))
      .slice(0, count).map(([price, size]) => ({ price, size }));
    return { ...base, status: "ready", snapshotEvidence: book.snapshotEvidence,
      epoch: book.epoch, revision: book.revision, sourceAt: book.sourceAt, receivedWallAt: book.receivedWallAt,
      snapshotAgeMs: now - book.snapshotAt, receivedAgeMs: now - book.receivedAt, bids: side(book.bids, -1), asks: side(book.asks, 1),
      viewTruncated: book.bids.size > count || book.asks.size > count };
  }
  fullBook(asset: string): FullBookView {
    const book = this.rows.get(asset)?.at(-1), now = performance.now();
    if (!book) return { asset, generation: this.version, status: this.stopped ? "stopped" : "waiting_snapshot" };
    const key = (price: string) => (price.split(".")[1] ?? "").padEnd(18, "0");
    const side = (rows: ReadonlyMap<string, string>, direction: number) => [...rows]
      .sort((a, b) => direction * (key(a[0]) < key(b[0]) ? -1 : key(a[0]) > key(b[0]) ? 1 : 0))
      .map(([price, size]) => Object.freeze({ price, size }));
    return Object.freeze({ asset, market: book.market, generation: this.version, assetGeneration: this.reader.assetGeneration(asset), epoch: book.epoch, revision: book.revision,
      status: "ready", snapshotEvidence: book.snapshotEvidence,
      sourceAt: book.sourceAt, receivedWallAt: book.receivedWallAt, snapshotAgeMs: now - book.snapshotAt, receivedAgeMs: now - book.receivedAt,
      receivedClockAt: performance.timeOrigin + book.receivedAt, snapshotClockAt: performance.timeOrigin + book.snapshotAt,
      bids: Object.freeze(side(book.bids, -1)) as unknown as DepthView["bids"],
      asks: Object.freeze(side(book.asks, 1)) as unknown as DepthView["asks"], viewTruncated: false });
  }
  stop(): void { if (this.stopped) return; this.stopped = true; this.feed.stop(); this.listeners.clear(); }
}
