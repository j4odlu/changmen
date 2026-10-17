import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BookStore } from "../../realtime/orderBook/bookStore";
import { WsBookShadowRuntime } from "../../submission/preflight/optimized/wsBook/bookRuntime";
import { metadataFromHttpOptions } from "../../submission/preflight/optimized/wsBook/bookMetadata";
import { beginWsBookShadow } from "../../submission/preflight/optimized/wsBook/shadowObserver";
import { observerClock } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";

let store: BookStore, consumer: WsBookShadowRuntime, sequence: number;
const changed = vi.fn();
const httpBook = (asset = "1") => ({ asset_id: asset, market: "m", timestamp: String(Date.now()), hash: "h",
  bids: [], asks: [{ price: "0.5", size: "100" }], version: "v2", tick_size: "0.01", min_order_size: "1", neg_risk: false });
const fetchBook = vi.fn(async (asset: string) => httpBook(asset));
const options = () => ({ version: 3, tickSize: "0.01", minOrderSize: 1, negRisk: false,
  bookTimestamp: Date.now(), asks: [{ price: .5, size: 100 }] });
const attempt = (tokenId = "1") => ({ tokenId, gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "execute", leg: "PM" });
function snapshot(asset = "1") {
  store.feed.accept?.({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: observerClock(), wallAt: Date.now(),
    raw: JSON.stringify({ ...httpBook(asset), event_type: "book" }) });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); sequence = 0;
  changed.mockClear(); fetchBook.mockClear(); store = new BookStore(() => true);
  consumer = new WsBookShadowRuntime(() => true, store.reader, { fetchBook, onMetadata: changed });
  store.feed.setAssets(["1", "2"]); consumer.setAssets(["1", "2"]);
  store.feed.accept?.({ type: "state", state: { epoch: 1, open: true, source: "official" } }); snapshot(); snapshot("2");
});
afterEach(() => { consumer.stop(); store.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("completed HTTP warms future metadata immediately, preserving HTTP start age and leaving WS depth untouched", async () => {
  const before = store.reader.history("1").at(-1), clock = observerClock(), finish = beginWsBookShadow(attempt());
  await vi.advanceTimersByTimeAsync(100);
  finish({ metadataClockAt: clock, orderOptions: options() }, false);
  expect(consumer.report().samples.at(-1)?.miss).toBe("metadata_unknown_or_stale");
  expect(consumer.report().executionMetadata[0]).toMatchObject({ asset: "1", clockAt: clock, version: 3, market: "m" });
  expect(changed).toHaveBeenCalled(); expect(fetchBook).not.toHaveBeenCalled();
  expect(store.reader.history("1").at(-1)).toBe(before);
  const next = beginWsBookShadow(attempt()); next(undefined, true);
  expect(consumer.report().samples.at(-1)?.miss).toBeUndefined();
});

test("periodic probe prioritizes missing metadata without increasing request frequency", async () => {
  beginWsBookShadow(attempt())({ metadataClockAt: observerClock(), orderOptions: options() }, false);
  await vi.advanceTimersByTimeAsync(2999); expect(fetchBook).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(fetchBook).toHaveBeenCalledOnce(); expect(fetchBook.mock.calls[0]?.[0]).toBe("2");
  expect(consumer.report().metadataInMemory).toBe(2);
});

test("changing interests preserves retained metadata age and removes departed assets", async () => {
  beginWsBookShadow(attempt())({ metadataClockAt: observerClock(), orderOptions: options() }, false);
  beginWsBookShadow(attempt("2"))({ metadataClockAt: observerClock(), orderOptions: options() }, false);
  const original = consumer.report().executionMetadata[0];
  await vi.advanceTimersByTimeAsync(100); consumer.setAssets(["1"]);
  expect(consumer.report().executionMetadata).toEqual([original]);
});

test.each(["failed", "before_invalidation", "during_invalidation", "tick", "no_snapshot", "not_interested", "expired", "future", "malformed"])("%s HTTP cannot populate metadata", async reason => {
  let clock = observerClock();
  if (reason === "before_invalidation") { await vi.advanceTimersByTimeAsync(1); store.feed.reset("reset"); snapshot(); }
  if (reason === "no_snapshot") store.feed.reset("reset");
  if (reason === "not_interested") consumer.setAssets(["2"]);
  if (reason === "expired") clock -= 60_001;
  if (reason === "future") clock += 1;
  const finish = beginWsBookShadow({ ...attempt(), tick: reason === "tick" });
  if (reason === "during_invalidation") { store.feed.reset("reset"); snapshot(); }
  finish({ metadataClockAt: clock, orderOptions: { ...options(), version: reason === "malformed" ? 99 : 3 } }, reason === "failed");
  expect(consumer.report().metadataInMemory).toBe(0);
});

test("out-of-order HTTP completions cannot overwrite newer metadata or freshen its age", async () => {
  const oldClock = observerClock(), oldFinish = beginWsBookShadow(attempt());
  await vi.advanceTimersByTimeAsync(10);
  const newClock = observerClock();
  beginWsBookShadow(attempt())({ metadataClockAt: newClock, orderOptions: { ...options(), minOrderSize: 5 } }, false);
  oldFinish({ metadataClockAt: oldClock, orderOptions: options() }, false);
  expect(consumer.report().executionMetadata[0]).toMatchObject({ clockAt: newClock, minSize: 5 });
});

test("metadata normalization rejects missing/invalid parameters rather than inventing defaults", () => {
  for (const raw of [undefined, {}, { ...options(), version: 1 }, { ...options(), tickSize: undefined },
    { ...options(), minOrderSize: 0 }, { ...options(), negRisk: undefined }])
    expect(metadataFromHttpOptions(raw, "1", "m", performance.now())).toBeUndefined();
  expect(metadataFromHttpOptions(options(), "1", "m", performance.now())).toMatchObject({ version: 3, tick: "0.01" });
});

test("depth expiry retains independently fresh metadata without refreshing either clock or restoring depth", async () => {
  // No probe runs: model a long time jump followed by a recent, completed actual HTTP.
  vi.setSystemTime(Date.now() + 59_000);
  beginWsBookShadow(attempt())({ metadataClockAt: observerClock(), orderOptions: options() }, false);
  const metadata = consumer.report().executionMetadata[0]; expect(metadata).toBeDefined();
  vi.setSystemTime(Date.now() + 2_000);
  store.feed.accept?.({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: observerClock(), wallAt: Date.now(),
    raw: JSON.stringify({ event_type: "last_trade_price", asset_id: "1" }) });
  expect(store.fullBook("1")).toMatchObject({ status: "ready", snapshotAgeMs: 61_000 });
  expect(store.reader.history("1")).toHaveLength(1); // retained for display, still rejected below
  expect(consumer.report().executionMetadata[0]?.clockAt).toBe(metadata!.clockAt);
  expect(consumer.report().coverage.eligible).toBe(0);
  snapshot(); expect(consumer.report().coverage.eligible).toBe(1);
  store.feed.reset("tick_changed"); expect(consumer.report().metadataInMemory).toBe(0);
});


test("A invalidation preserves B metadata, original age, pending HTTP reuse and book generation", () => {
  const clock = observerClock();
  beginWsBookShadow(attempt("2"))({metadataClockAt:clock,orderOptions:options()},false);
  const original = consumer.executionMetadata().find(row=>row.asset === "2"), generation = store.reader.generation;
  const pendingB = beginWsBookShadow(attempt("2")), pendingA = beginWsBookShadow(attempt("1"));
  store.feed.reset("tick_changed", ["1"]);
  expect(store.reader.generation).toBe(generation); expect(store.fullBook("2").status).toBe("ready");
  expect(consumer.executionMetadata()).toEqual([original]);
  pendingB({metadataClockAt:clock,orderOptions:options()},false);
  expect(consumer.report().samples.at(-1)?.outcome).toBe("aligned_equal");
  snapshot(); pendingA({metadataClockAt:clock,orderOptions:options()},false);
  expect(consumer.report().samples.at(-1)?.outcome).toBe("epoch_or_route_changed");
  expect(consumer.executionMetadata()).toEqual([original]);
});

test("a probe for B survives A invalidation; a probe for A is aborted and cannot revive its metadata", async () => {
  let resolve!: (raw: unknown) => void;
  fetchBook.mockImplementationOnce(() => new Promise(done=>{resolve=done;}));
  await vi.advanceTimersByTimeAsync(3000); expect(fetchBook.mock.calls.at(-1)?.[0]).toBe("1");
  store.feed.reset("tick_changed",["1"]); resolve(httpBook("1")); await Promise.resolve(); await Promise.resolve();
  expect(consumer.executionMetadata()).toHaveLength(0);
  snapshot(); beginWsBookShadow(attempt("1"))({metadataClockAt:observerClock(),orderOptions:options()},false);
  fetchBook.mockImplementationOnce(() => new Promise(done=>{resolve=done;}));
  await vi.advanceTimersByTimeAsync(3000); expect(fetchBook.mock.calls.at(-1)?.[0]).toBe("2");
  store.feed.reset("tick_changed",["1"]); resolve(httpBook("2")); await Promise.resolve(); await Promise.resolve();
  expect(consumer.executionMetadata().map(row=>row.asset)).toEqual(["2"]);
});


test("a first WS snapshot arriving during a probe can be checked without retaining conflicting metadata", async () => {
  store.feed.reset("tick_changed", ["1"]);
  let resolve!: (raw: unknown) => void;
  fetchBook.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchBook.mock.calls.at(-1)?.[0]).toBe("1");
  snapshot(); const peer = store.fullBook("2");
  resolve({...httpBook(),asks:[{price:"0.5",size:"1"}]});
  await Promise.resolve(); await Promise.resolve();
  expect(consumer.report().samples.at(-1)?.outcome).toBe("aligned_difference");
  expect(store.fullBook("1").status).toBe("waiting_snapshot");
  expect(store.fullBook("2")).toEqual(peer);
  expect(consumer.executionMetadata()).toHaveLength(0);
});
