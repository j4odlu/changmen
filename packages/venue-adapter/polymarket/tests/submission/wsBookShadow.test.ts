import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BOOK_LIMITS, decimal, numericAsks, reduceBookFrame, type LocalOrderBook } from "../../realtime/orderBook/bookReducer";
import { DirectBookFeed } from "../helpers/directBookFeed";
import { parseHttpBook } from "../../submission/preflight/optimized/wsBook/bookMetadata";
import { compareAsks } from "../../submission/preflight/optimized/wsBook/bookRuntime";
import { OwnedRuntimeFixture as WsBookShadowRuntime } from "../helpers/ownedBookFixtures";
import { beginWsBookShadow, registerWsBookShadowObserver, type ShadowAttempt } from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";

const snapshot = (asset = "1", timestamp = "1000") => ({ event_type: "book", asset_id: asset, market: "m", timestamp,
  hash: "snapshot-hash", bids: [{ price: "0.4", size: "10" }], asks: [{ price: "0.50", size: "20" }] });
const delta = (size = "7", asset = "1", timestamp = "1001") => ({ event_type: "price_change", market: "m", timestamp,
  price_changes: [{ asset_id: asset, price: "0.5000", size, side: "SELL", hash: "delta-hash" }] });
const apply = (raw: unknown, books: ReadonlyMap<string, LocalOrderBook> = new Map()) => reduceBookFrame(books, raw, new Set(["1", "2"]), 1, 50, 2000).books;

describe("complete private book reducer", () => {
  test("pre-snapshot delta is discarded; snapshot is complete and subsequent sizes replace, never add", () => {
    expect(apply(delta()).size).toBe(0);
    const first = apply(snapshot());
    const next = apply(delta(), first);
    expect(numericAsks(next.get("1")!)).toEqual([{ price: .5, size: 7 }]);
    expect(numericAsks(first.get("1")!)).toEqual([{ price: .5, size: 20 }]);
    expect(next.get("1")!.snapshotHash).toBeUndefined();
    expect(apply(delta("0"), next).get("1")!.asks.size).toBe(0);
    expect(apply({ ...snapshot(), timestamp: "1002", asks: [] }, next).get("1")!.asks.size).toBe(0);
  });
  test("equal timestamp updates are applied in receive order; bid and ask sides remain separate", () => {
    const first = apply(snapshot());
    const change = delta("12", "1", "1000"); change.price_changes[0]!.side = "BUY";
    const next = apply([delta("7", "1", "1000"), change, delta("8", "1", "1000")], first).get("1")!;
    expect(next.asks.get("0.5")).toBe("8"); expect(next.bids.get("0.5")).toBe("12");
  });
  test("multi-asset frame is atomic even when last change is invalid", () => {
    const initial = apply([snapshot(), snapshot("2")]);
    const bad = delta(); bad.price_changes.push({ ...bad.price_changes[0]!, asset_id: "2", size: "-1" });
    expect(() => apply(bad, initial)).toThrow();
    expect(initial.get("1")!.asks.get("0.5")).toBe("20");
    expect(apply([delta("2"), delta("3", "2")], initial).get("2")!.asks.get("0.5")).toBe("3");
  });
  test("real official complementary-token frames update subscribed assets without growing subscriptions", () => {
    const initial = apply(snapshot());
    const frame = delta("12"); frame.price_changes.unshift({ ...frame.price_changes[0]!, asset_id: "999", side: "BUY" });
    const next = apply(frame, initial);
    expect(next.size).toBe(1); expect(next.get("1")!.asks.get("0.5")).toBe("12");
    frame.price_changes[0]!.size = "-1";
    expect(() => apply(frame, initial)).toThrow(); expect(initial.get("1")!.asks.get("0.5")).toBe("20");
  });
  test.each([
    { ...snapshot(), asks: undefined }, { ...snapshot(), asks: [{ price: "0.5", size: "NaN" }] },
    { ...snapshot(), asks: [{ price: "0.5", size: "0" }, { price: "0.50", size: "1" }] },
    { ...snapshot(), asks: Array(BOOK_LIMITS.levels + 1).fill({ price: "0.5", size: "1" }) },
    { ...snapshot(), asset_id: "3" }, { ...snapshot(), timestamp: "" }, { ...snapshot(), hash: 1 },
  ])("rejects malformed snapshot %#", event => { expect(() => apply(event)).toThrow(); });
  test("time reversal, condition mismatch and epoch mismatch reject", () => {
    const first = apply(snapshot());
    expect(() => apply(delta("1", "1", "999"), first)).toThrow();
    expect(() => apply({ ...delta(), market: "other" }, first)).toThrow();
    expect(() => reduceBookFrame(first, delta(), new Set(["1"]), 2, 51, 2001)).toThrow();
  });
  test("trade and BBO do not consume depth or rejuvenate receive age; empty snapshot valid", () => {
    const first = apply(snapshot());
    expect(apply({ event_type: "last_trade_price" }, first).get("1")).toBe(first.get("1"));
    expect(apply({ event_type: "best_bid_ask" }, first).get("1")).toBe(first.get("1"));
    expect(apply({ ...snapshot(), bids: [], asks: [] }).get("1")!.asks.size).toBe(0);
  });
  test("normalization preserves exact decimal identity; tick changes invalidate", () => {
    expect(decimal("000.500000000000000001")).toBe("0.500000000000000001");
    expect(() => decimal("5e-1")).toThrow();
    const result = reduceBookFrame(apply(snapshot()), { event_type: "tick_size_change", asset_id: "1", market: "m",
      timestamp: "1001", new_tick_size: "0.001" }, new Set(["1"]), 1, 51, 2001);
    expect(result.books.size).toBe(0); expect(result.ticks.has("1")).toBe(true);
  });
});

class FakeSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  message(value: unknown) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
}
let sockets: FakeSocket[];
const socket = () => { const next = new FakeSocket(); sockets.push(next); return next as unknown as WebSocket; };
const attempt: ShadowAttempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false,
  role: "execute", linkId: 8, attemptId: "real-attempt", leg: "Polymarket:Home:1" };
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); sockets = []; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("disconnect invalidates immediately, new epoch waits for a snapshot and old callbacks cannot revive", async () => {
  const publish = vi.fn(), invalidate = vi.fn();
  const feed = new DirectBookFeed({ allowed: () => true, publish, invalidate, socket });
  feed.setAssets(["1"]); const first = sockets[0]!; first.onopen?.();
  expect(JSON.parse(first.send.mock.calls[0]![0])).toMatchObject({ initial_dump: true, assets_ids: ["1"] });
  first.message(snapshot()); const epoch = publish.mock.calls.at(-1)![0].get("1").epoch;
  const late = first.onmessage!; first.onclose?.(); expect(invalidate).toHaveBeenLastCalledWith("disconnected");
  late({ data: JSON.stringify(snapshot()) }); const count = publish.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000); const next = sockets[1]!;
  next.message(delta()); expect(publish.mock.calls.at(-1)![0].size).toBe(0);
  next.message(snapshot()); expect(publish.mock.calls.at(-1)![0].get("1").epoch).toBeGreaterThan(epoch);
  expect(publish.mock.calls.length).toBe(count + 2); feed.stop(); expect(vi.getTimerCount()).toBe(0);
});

test("PING/PONG keeps transport alive but does not refresh depth; periodic resnapshot gets a new connection", async () => {
  const publish = vi.fn(), invalidate = vi.fn();
  const feed = new DirectBookFeed({ allowed: () => true, publish, invalidate, socket });
  feed.setAssets(["1"]); sockets[0]!.message(snapshot()); const book = publish.mock.calls[0]![0].get("1");
  for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(10_000); sockets[0]!.message("PONG"); }
  expect(sockets[0]!.send).toHaveBeenCalledWith("PING"); expect(publish.mock.calls).toHaveLength(1);
  expect(book.receivedAt).toBeLessThan(performance.now());
  await vi.advanceTimersByTimeAsync(2000); expect(sockets).toHaveLength(2);
  expect(invalidate).toHaveBeenCalledWith("periodic_resnapshot"); feed.stop();
});

test.each(["bad_json", "oversized", "tick", "heartbeat"])("%s invalidates and never leaves an executable old book", async kind => {
  const invalidate = vi.fn(); const feed = new DirectBookFeed({ allowed: () => true, publish: vi.fn(), invalidate, socket });
  feed.setAssets(["1"]); sockets[0]!.message(snapshot());
  if (kind === "bad_json") sockets[0]!.message("[");
  if (kind === "oversized") sockets[0]!.message("x".repeat(BOOK_LIMITS.frameChars + 1));
  if (kind === "tick") sockets[0]!.message({ event_type: "tick_size_change", asset_id: "1", market: "m", timestamp: "1002", new_tick_size: "0.001" });
  if (kind === "heartbeat") await vi.advanceTimersByTimeAsync(31_000);
  expect(sockets[0]!.close).toHaveBeenCalled(); feed.stop();
});

test("route off and candidate replacement stop old callbacks and respect asset bounds", () => {
  let allowed = true; const publish = vi.fn();
  const feed = new DirectBookFeed({ allowed: () => allowed, publish, invalidate: vi.fn(), socket });
  feed.setAssets(["1"]); const late = sockets[0]!.onmessage!;
  feed.setAssets(Array.from({ length: 30 }, (_, i) => String(i + 1))); sockets[1]!.onopen?.();
  expect(JSON.parse(sockets[1]!.send.mock.calls[0]![0]).assets_ids).toHaveLength(16);
  late({ data: JSON.stringify(snapshot()) }); expect(publish).not.toHaveBeenCalled();
  allowed = false; sockets[1]!.message(snapshot()); expect(sockets[1]!.close).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("HTTP metadata is explicit, never seeds WS; histories distinguish unequal-time and ambiguous same-time", () => {
  expect(parseHttpBook(snapshot(), "1", 1).metadata).toBeUndefined();
  expect(parseHttpBook({ ...snapshot(), version: "v2", tick_size: "0.01", min_order_size: "5", neg_risk: false }, "1", 1).metadata?.version).toBe(3);
  expect(parseHttpBook({ ...snapshot(), tick_size: "0.01", min_order_size: "5", neg_risk: false }, "1", 1).metadata?.version).toBe(2);
  expect(parseHttpBook({ ...snapshot(), version: "future", tick_size: "0.01", min_order_size: "5", neg_risk: false }, "1", 1).metadata).toBeUndefined();
  expect(() => parseHttpBook(snapshot(), "2", 1)).toThrow();
  const a = apply(snapshot()).get("1")!, b = apply(delta("3", "1", "1000"), new Map([["1", a]])).get("1")!;
  expect(compareAsks([a], 1000, numericAsks(a))).toBe("aligned_equal");
  expect(compareAsks([a], 1000, numericAsks(b))).toBe("aligned_difference");
  expect(compareAsks([a], 1001, numericAsks(a))).toBe("unaligned_or_changed");
  expect(compareAsks([a, b], 1000, numericAsks(a))).toBe("ambiguous_timestamp");
});

test("HTTP probe never seeds depth; attempts retain actual role/IDs, tick exclusion, and bounded reports", async () => {
  const fetchBook = vi.fn(async () => ({ ...snapshot(), version: "v2", tick_size: "0.01", min_order_size: "5", neg_risk: false }));
  const runtime = new WsBookShadowRuntime(() => true, { feedFactory: options => new DirectBookFeed({ ...options, socket }), fetchBook }); runtime.setAssets(["1"]);
  await vi.advanceTimersByTimeAsync(3000);
  const result = { price: .5, orderOptions: { bookTimestamp: 1000, asks: [{ price: .5, size: 20 }] } };
  beginWsBookShadow(attempt)(result, false);
  expect(runtime.report().samples.at(-1)).toMatchObject({ miss: "no_snapshot", attemptId: "real-attempt", role: "execute" });
  sockets[0]!.message(snapshot()); beginWsBookShadow({ ...attempt, tick: true, role: "precheckOnly" })(result, false);
  expect(runtime.report().samples.at(-1)).toMatchObject({ miss: "tick_quote_excluded", outcome: "aligned_equal", role: "precheckOnly" });
  for (let i = 0; i < 300; i++) beginWsBookShadow(attempt)(result, false);
  expect(runtime.report().samples).toHaveLength(256); expect(runtime.report().activeSupported).toBe(false);
  const count = runtime.report().samples.length;
  beginWsBookShadow({ ...attempt, gateway: "https://other" })(result, false);
  beginWsBookShadow({ ...attempt, proxied: true })(result, false);
  expect(runtime.report().samples).toHaveLength(count);
  runtime.stop(); expect(vi.getTimerCount()).toBe(0); expect(fetchBook).toHaveBeenCalledOnce();
});

test("late metadata after stop/reconnect cannot publish and requests are cancelled without overlap", async () => {
  let resolve!: (raw: unknown) => void;
  const fetchBook = vi.fn((_id: string, _signal: AbortSignal) => new Promise<unknown>(done => { resolve = done; }));
  const runtime = new WsBookShadowRuntime(() => true, { feedFactory: options => new DirectBookFeed({ ...options, socket }), fetchBook }); runtime.setAssets(["1"]);
  sockets[0]!.message(snapshot()); await vi.advanceTimersByTimeAsync(6000); expect(fetchBook).toHaveBeenCalledOnce();
  const finish = beginWsBookShadow(attempt);
  runtime.stop(); expect(fetchBook.mock.calls[0]![1].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  resolve(snapshot()); await Promise.resolve(); await Promise.resolve(); finish({}, false);
  expect(runtime.report().samples.at(-1)).toMatchObject({ outcome: "scope_stopped", attemptId: "real-attempt", httpFailed: false });
});

test("observer exceptions cannot become execution errors", () => {
  const release = registerWsBookShadowObserver(() => { throw new Error("observer"); });
  expect(() => beginWsBookShadow(attempt)({}, false)).not.toThrow(); release();
  const release2 = registerWsBookShadowObserver(() => () => { throw new Error("finish"); });
  expect(() => beginWsBookShadow(attempt)({}, false)).not.toThrow(); release2();
});

test("attempt discrepancy invalidates the private generation and leaves HTTP value intact", () => {
  const runtime = new WsBookShadowRuntime(() => true, { feedFactory: options => new DirectBookFeed({ ...options, socket }) }); runtime.setAssets(["1"]);
  sockets[0]!.message(snapshot());
  const raw = Object.freeze({ price: .5, orderOptions: Object.freeze({ bookTimestamp: 1000,
    asks: Object.freeze([{ price: .5, size: 2 }]) }) });
  const old = beginWsBookShadow(attempt);
  beginWsBookShadow(attempt)(raw, false);
  expect(runtime.report().samples.at(-1)?.outcome).toBe("aligned_difference");
  expect(sockets[0]!.close).not.toHaveBeenCalled(); expect(sockets).toHaveLength(1);
  expect(runtime.store.reader.history("1")).toHaveLength(0);
  expect(raw.orderOptions.asks[0]!.size).toBe(2);
  old(raw, false); expect(runtime.report().counters.attempt_discarded_epoch_or_route).toBe(1);
  runtime.stop();
});

test("slow HTTP attempts have a bounded shadow retention budget", () => {
  const runtime = new WsBookShadowRuntime(() => true, { feedFactory: options => new DirectBookFeed({ ...options, socket }) }); runtime.setAssets(["1"]);
  const finishes = Array.from({ length: 40 }, () => beginWsBookShadow(attempt));
  expect(runtime.report().pendingAttempts).toBe(32); expect(runtime.report().counters.attempt_capacity).toBe(8);
  for (const finish of finishes) { finish(undefined, true); finish(undefined, true); }
  expect(runtime.report().pendingAttempts).toBe(0); expect(runtime.report().samples).toHaveLength(40);
  runtime.stop();
});

test("A1: a 2000-level delta copies the touched prior side once and preserves the previous revision", () => {
  const asks = Array.from({ length: 2000 }, (_, i) => ({ price: ((i + 1) / 10000).toFixed(4), size: "10" }));
  const old = apply({ ...snapshot(), asks }).get("1")!;
  const iterate = vi.fn(() => old.asks[Symbol.iterator]());
  const tracked = { ...old, asks: { ...old.asks, [Symbol.iterator]: iterate } };
  const frame = { ...delta(), price_changes: asks.map(row => ({ ...row, size: "11", side: "SELL", asset_id: "1" })) };
  const next = apply(frame, new Map([["1", tracked]])).get("1")!;
  expect(iterate).toHaveBeenCalledOnce(); expect(next.asks.size).toBe(2000);
  expect(next.asks.get("0.1")).toBe("11"); expect(old.asks.get("0.1")).toBe("10");
});

test("A2: same assets resume after an allowed-false callback stops the feed between reconciliations", () => {
  let allowed = true;
  const runtime = new WsBookShadowRuntime(() => allowed, { feedFactory: options => new DirectBookFeed({ ...options, socket }) }); runtime.setAssets(["1"]);
  sockets[0]!.message(snapshot()); const late = sockets[0]!.onmessage!;
  allowed = false; sockets[0]!.message(delta());
  allowed = true; runtime.reconcile();
  expect(sockets).toHaveLength(2); expect(runtime.report().snapshotsInMemory).toBe(0);
  late({ data: JSON.stringify(snapshot()) }); expect(runtime.report().snapshotsInMemory).toBe(0);
  sockets[1]!.message(snapshot()); expect(runtime.report().snapshotsInMemory).toBe(1); runtime.stop();
});

test("A3: 15 healthy tokens survive a missing 16th; one notification per epoch, retry only at periodic resnapshot", async () => {
  const publish = vi.fn(), unavailable = vi.fn();
  const feed = new DirectBookFeed({ allowed: () => true, publish, unavailable, invalidate: vi.fn(), socket });
  feed.setAssets(Array.from({ length: 16 }, (_, i) => String(i + 1)));
  sockets[0]!.message(Array.from({ length: 15 }, (_, i) => snapshot(String(i + 1))));
  sockets[0]!.message([]); // Official empty initial dump for an ended token is not a connection failure.
  for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(10000); sockets[0]!.message("PONG"); }
  expect(sockets).toHaveLength(1); expect(sockets[0]!.close).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledExactlyOnceWith(["16"], "snapshot_timeout");
  expect(publish.mock.calls.at(-1)![0].size).toBe(15);
  sockets[0]!.message(delta()); expect(publish.mock.calls.at(-1)![0].get("1").asks.get("0.5")).toBe("7");
  await vi.advanceTimersByTimeAsync(2000); expect(sockets).toHaveLength(2);
  sockets[1]!.message(snapshot("16")); expect(publish.mock.calls.at(-1)![0].get("16")).toBeDefined();
  feed.stop();
});

test("empty official initial dumps supply no depth and never refresh an existing book", () => {
  const before = apply(snapshot());
  expect(apply([], before).get("1")).toBe(before.get("1"));
  expect(apply([]).size).toBe(0);
  expect(Reflect.get(apply([]), "set")).toBeUndefined();
});

test("A4: consumers cannot replace maps, call mutators, or obtain the backing map through forEach", () => {
  const first = apply(snapshot()), a = first.get("1")!, b = first.get("1")!;
  expect(Reflect.set(a, "asks", new Map([["0.5", "999999"]]))).toBe(false);
  expect(Reflect.get(a.asks, "set")).toBeUndefined(); expect(Reflect.get(first, "clear")).toBeUndefined();
  expect(() => Map.prototype.set.call(a.asks, "0.5", "999999")).toThrow();
  a.asks.forEach((_value, _key, map) => { expect(map).toBe(a.asks); expect(Reflect.get(map, "set")).toBeUndefined(); });
  const next = apply(delta("3"), first);
  expect(b.asks.get("0.5")).toBe("20"); expect(next.get("1")!.asks.get("0.5")).toBe("3");
});

test("A5: disconnect and route changes preserve HTTP completion identity and duration", async () => {
  let allowed = true;
  const runtime = new WsBookShadowRuntime(() => allowed, { feedFactory: options => new DirectBookFeed({ ...options, socket }) }); runtime.setAssets(["1"]);
  const finish = beginWsBookShadow(attempt); await vi.advanceTimersByTimeAsync(600);
  sockets[0]!.onclose?.(); allowed = false; finish(undefined, true);
  expect(runtime.report().samples.at(-1)).toMatchObject({ attemptId: "real-attempt", outcome: "epoch_or_route_changed", httpMs: 600, httpFailed: true });
  expect(runtime.report().httpMarketMs.count).toBe(1); runtime.stop();
});
