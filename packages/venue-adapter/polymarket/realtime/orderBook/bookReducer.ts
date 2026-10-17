import type { StandardMarketEvent } from "@polymarket/client/actions";
const BOOK_EVENTS = ["book", "price_change", "tick_size_change"] satisfies StandardMarketEvent["type"][];
/** [changmen 扩展] 本地订单簿核心，供行情消费者显式实例化；任何协议错误使整帧失效。 */
export const BOOK_LIMITS = { assets: 16, levels: 2_000, frameChars: 1_000_000, events: 128, history: 4 } as const;
export interface LocalOrderBook {
  readonly asset: string; readonly market: string; readonly bids: ReadonlyMap<string, string>; readonly asks: ReadonlyMap<string, string>;
  readonly sourceAt: number; readonly receivedAt: number; readonly receivedWallAt: number; readonly snapshotAt: number;
  readonly snapshotEvidence?: boolean;
  readonly epoch: number; readonly revision: number; readonly snapshotHash?: string;
}
/** No mutators or backing Map escape, including via forEach's third argument. */
function readonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = Object.freeze({
    size: source.size, get: (key: K) => source.get(key), has: (key: K) => source.has(key),
    entries: () => source.entries(), keys: () => source.keys(), values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator](),
    forEach: (fn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, context?: unknown) =>
      source.forEach((value, key) => fn.call(context, value, key, view)),
  });
  return view;
}
export function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,20}(\.\d{1,18})?$/.test(value)) throw new Error("decimal");
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "");
  return whole!.replace(/^0+(?=\d)/, "") + (digits ? `.${digits}` : "");
}
function price(value: unknown): string {
  const key = decimal(value);
  if (!(Number(key) > 0 && Number(key) < 1)) throw new Error("price");
  return key;
}
function levels(value: unknown): Map<string, string> {
  if (!Array.isArray(value) || value.length > BOOK_LIMITS.levels) throw new Error("levels");
  const result = new Map<string, string>(), seen = new Set<string>();
  for (const row of value) {
    const key = price(row?.price), size = decimal(row?.size);
    if (seen.has(key)) throw new Error("duplicate level");
    seen.add(key);
    if (size !== "0") result.set(key, size);
  }
  return result;
}
function timestamp(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) throw new Error("timestamp");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("timestamp");
  return n;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("event");
  return value as Record<string, unknown>;
}
export interface ReducedFrame { books: ReadonlyMap<string, LocalOrderBook>; ticks: Set<string> }
export function reduceBookFrame(current: ReadonlyMap<string, LocalOrderBook>, input: unknown,
  assets: ReadonlySet<string>, epoch: number, now: number, wall: number): ReducedFrame {
  const events = Array.isArray(input) ? input : [input];
  if (events.length > BOOK_LIMITS.events) throw new Error("frame limit");
  // Official initial_dump can be [] for an ended/nonexistent token. It supplies no evidence;
  // do not let it disconnect healthy assets or refresh any book's age.
  if (!events.length) return { books: readonlyMap(new Map(current)), ticks: new Set() };
  const books = new Map(current), ticks = new Set<string>();
  const owned = new WeakSet<ReadonlyMap<string, string>>(), changed = new Set<string>();
  for (const item of events) {
    const event = record(item);
    // Trades/BBO never mutate depth or refresh its age.
    if (!(BOOK_EVENTS as readonly string[]).includes(String(event.event_type))) continue;
    const sourceAt = timestamp(event.timestamp);
    if (typeof event.market !== "string" || !event.market) throw new Error("market");
    const market = event.market;
    const prior = (asset: unknown) => {
      if (typeof asset !== "string" || !assets.has(asset)) throw new Error("unexpected asset");
      const old = books.get(asset);
      if (old && (old.epoch !== epoch || old.market !== market || sourceAt < old.sourceAt)) throw new Error("continuity");
      return { asset, old };
    };
    if (event.event_type === "book") {
      const { asset, old } = prior(event.asset_id);
      if (event.hash != null && typeof event.hash !== "string") throw new Error("snapshot hash");
      const bids = levels(event.bids), asks = levels(event.asks);
      owned.add(bids); owned.add(asks); changed.add(asset);
      books.set(asset, { asset, market, bids, asks, sourceAt,
        receivedAt: now, receivedWallAt: wall, snapshotAt: now, epoch, revision: (old?.revision ?? 0) + 1,
        snapshotEvidence: typeof event.hash === "string" && event.hash.length > 0,
        snapshotHash: typeof event.hash === "string" && event.hash.length ? event.hash : undefined });
    } else if (event.event_type === "price_change") {
      if (!Array.isArray(event.price_changes) || !event.price_changes.length || event.price_changes.length > BOOK_LIMITS.levels) throw new Error("changes");
      for (const raw of event.price_changes) {
        const change = record(raw);
        const key = price(change.price), size = decimal(change.size);
        const normalizedSide = typeof change.side === "string" ? change.side.toUpperCase() : change.side;
        if (normalizedSide !== "BUY" && normalizedSide !== "SELL") throw new Error("side");
        if (typeof change.asset_id !== "string" || !/^\d+$/.test(change.asset_id)) throw new Error("asset");
        // Official condition-level frames also carry the complementary, unsubscribed token.
        // Validate its row but do not store/subscribe it or reject our subscribed token's change.
        if (!assets.has(change.asset_id)) continue;
        const { asset, old } = prior(change.asset_id);
        if (!old) continue; // Never replay pre-snapshot deltas over the initial dump.
        const side = normalizedSide === "BUY" ? "bids" : "asks";
        // Copy each touched side once per frame, not once per level. No mutation of prior revisions.
        const next = owned.has(old[side]) ? old[side] as Map<string, string> : new Map(old[side]);
        owned.add(next); changed.add(asset);
        if (size === "0") next.delete(key); else next.set(key, size);
        if (next.size > BOOK_LIMITS.levels) throw new Error("level limit");
        books.set(asset, { ...old, [side]: next, sourceAt, receivedAt: now, receivedWallAt: wall,
          revision: old.revision + 1, snapshotHash: undefined });
      }
    } else {
      const { asset } = prior(event.asset_id);
      if (!["0.1", "0.01", "0.001", "0.0001"].includes(decimal(event.new_tick_size))) throw new Error("tick");
      ticks.add(asset); books.delete(asset); // Invalidate private metadata and obtain a new snapshot.
    }
  }
  for (const asset of changed) {
    const book = books.get(asset);
    if (book) books.set(asset, Object.freeze({ ...book,
      bids: owned.has(book.bids) ? readonlyMap(book.bids) : book.bids,
      asks: owned.has(book.asks) ? readonlyMap(book.asks) : book.asks }));
  }
  return { books: readonlyMap(books), ticks };
}
export function numericAsks(book: LocalOrderBook): Array<{ price: number; size: number }> {
  return [...book.asks].map(([p, s]) => ({ price: Number(p), size: Number(s) })).sort((a, b) => a.price - b.price);
}
