import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { PassiveBookFeed } from "../../realtime/orderBook/passiveBookFeed";
import type { MarketStreamEvent } from "../../realtime/marketStreamProtocol";
import { OwnedRuntimeFixture as WsBookShadowRuntime } from "../helpers/ownedBookFixtures";
import { beginWsBookShadow } from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";

const book = (id = "1", size = "20") => ({ event_type: "book", asset_id: id, market: "m", timestamp: String(Date.now()),
  hash: "hash", bids: [{ price: "0.4", size: "3" }], asks: [{ price: "0.5", size }] });
const delta = (id = "1", size = "7") => ({ event_type: "price_change", market: "m", timestamp: String(Date.now()),
  price_changes: [{ asset_id: id, price: "0.5", size, side: "SELL" }] });
let sequence = 0;
const frame = (raw: unknown, epoch = 1): MarketStreamEvent => ({ type: "frame", epoch, sequence: ++sequence,
  receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(), raw: typeof raw === "string" ? raw : JSON.stringify(raw) });
const state = (epoch = 1, open = true, source: "official" | "changmen" = "official"): MarketStreamEvent => ({ type: "state", state: { epoch, open, source } });
const setup = () => {
  const publish = vi.fn(), invalidate = vi.fn(), unavailable = vi.fn();
  const feed = new PassiveBookFeed({ allowed: () => true, publish, invalidate, unavailable });
  feed.setAssets(["1", "2"]); feed.accept(state());
  return { feed, publish, invalidate, unavailable, latest: () => publish.mock.calls.at(-1)?.[0] };
};
beforeEach(() => { sequence = 0; vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("late attach ignores all pre-snapshot deltas; unrelated PM-M books/ticks do not invalidate candidates", () => {
  const { feed, latest, invalidate } = setup();
  feed.accept(frame(delta())); expect(latest().size).toBe(0);
  feed.accept(frame([book(), book("999"), { event_type: "tick_size_change", asset_id: "999" }]));
  feed.accept(frame(delta())); expect(latest().get("1").asks.get("0.5")).toBe("7");
  feed.accept(frame(delta("1", "0"))); expect(latest().get("1").asks.size).toBe(0);
  feed.accept(frame(book("1", "11"))); expect(latest().get("1").asks.get("0.5")).toBe("11");
  expect(invalidate).toHaveBeenCalledTimes(1); feed.stop(); expect(vi.getTimerCount()).toBe(0);
});
test("candidate churn retains healthy books; removed/re-added asset waits for a new snapshot", () => {
  const { feed, latest, unavailable } = setup(); feed.accept(frame([book(), book("2")]));
  feed.setAssets(["2", "3"]);
  expect(latest().has("1")).toBe(false); expect(Reflect.get(latest(), "set")).toBeUndefined();
  feed.accept(frame(delta("2")));
  expect(latest().has("1")).toBe(false); expect(latest().get("2").asks.get("0.5")).toBe("7");
  expect(unavailable).toHaveBeenCalledWith(["1"], "asset_removed");
  feed.setAssets(["1", "2"]); feed.accept(frame(delta())); expect(latest().has("1")).toBe(false);
});
test("disconnect, relay switch and old epochs cannot retain or revive a book", () => {
  const { feed, latest, invalidate } = setup(); feed.accept(frame(book()));
  const late = frame(book()); feed.accept(state(1, false)); feed.accept(late);
  feed.accept(state(2)); feed.accept(late); feed.accept(frame(delta(), 2)); expect(latest().size).toBe(0);
  feed.accept(frame(book(), 2)); expect(latest().size).toBe(1);
  feed.accept(state(3, true, "changmen")); const count = invalidate.mock.calls.length;
  feed.accept(frame(book(), 3)); expect(invalidate).toHaveBeenCalledTimes(count);
  feed.accept(state(4)); feed.accept(frame(delta(), 4)); expect(latest().size).toBe(0);
});
test.each(["gap", "duplicate", "malformed", "queue_age", "oversized", "budget"])("%s invalidates locally and only a later full snapshot restores the asset", kind => {
  const { feed, latest, invalidate } = setup(); feed.accept(frame(book()));
  if (kind === "gap") sequence++;
  if (kind === "duplicate") sequence--;
  const event = frame(kind === "malformed" ? "[" : kind === "oversized" ? "x".repeat(1_000_001) : kind === "tick"
    ? { event_type: "tick_size_change", asset_id: "1", market: "m", timestamp: String(Date.now()), new_tick_size: "0.001" } : delta());
  if (event.type !== "frame") throw Error("test");
  if (kind === "queue_age") event.receivedAt -= 1001;
  if (kind === "budget") vi.spyOn(performance, "now").mockReturnValueOnce(Date.now()).mockReturnValueOnce(Date.now() + 21);
  feed.accept(event); expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  if (kind === 'budget') vi.advanceTimersByTime(100);
  feed.accept(frame(delta())); expect(latest().size).toBe(0);
  feed.accept(frame(book())); expect(latest().size).toBe(1);
});
test("60s snapshot trust limit is preserved without any periodic reconnect or HTTP overlay", () => {
  const { feed, latest, unavailable } = setup(); feed.accept(frame([book(), book("2")]));
  vi.advanceTimersByTime(59_000); feed.accept(frame(book("2")));
  vi.advanceTimersByTime(2_000); feed.accept(frame(delta()));
  expect(latest().has("1")).toBe(true); expect(latest().has("2")).toBe(true);
  expect(performance.now() - latest().get("1").snapshotAt).toBe(61_000);
  expect(unavailable).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("default runtime consumes passive books, discrepancy clears local state, HTTP value and pending identity survive", () => {
  const Socket = vi.fn(() => { throw Error("must not connect"); }); vi.stubGlobal("WebSocket", Socket);
  const runtime = new WsBookShadowRuntime(() => true); runtime.setAssets(["1"]);
  runtime.feed.accept!(state()); runtime.feed.accept!(frame(book()));
  const attempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "execute", leg: "1" };
  const pending = beginWsBookShadow(attempt);
  const raw = Object.freeze({ price: .5, orderOptions: { bookTimestamp: Date.now(), asks: [{ price: .5, size: 9 }] } });
  beginWsBookShadow(attempt)(raw, false);
  expect(runtime.report().samples.at(-1)?.outcome).toBe("aligned_difference");
  expect(runtime.report().snapshotsInMemory).toBe(0); expect(Socket).not.toHaveBeenCalled();
  pending(raw, false); expect(runtime.report().samples.at(-1)?.outcome).toBe("epoch_or_route_changed");
  runtime.feed.accept!(frame(delta())); expect(runtime.report().snapshotsInMemory).toBe(0);
  runtime.feed.accept!(frame(book())); expect(runtime.report().snapshotsInMemory).toBe(1);
  runtime.stop(); expect(vi.getTimerCount()).toBe(0);
});
test("stop is terminal, including a later allowed route bounce", () => {
  let allowed = true; const publish = vi.fn(), feed = new PassiveBookFeed({ allowed: () => allowed, publish, invalidate: vi.fn() });
  feed.setAssets(["1"]); feed.accept(state()); allowed = false; feed.accept(frame(book()));
  allowed = true; feed.setAssets(["1"]); feed.accept(state(2)); feed.accept(frame(book(), 2)); expect(publish).not.toHaveBeenCalled();
});

test('shared traffic over 500 frames/s and broad snapshots do not consume a candidate frame quota', () => {
  const { feed, latest, invalidate } = setup();
  feed.accept(frame(Array.from({ length: 300 }, (_, i) => book(String(i + 1)))));
  expect(latest().size).toBe(2);
  const revision = latest().get('1').revision;
  for (let i = 0; i < 1500; i++) feed.accept(frame(delta('999')));
  expect(latest().get('1').revision).toBe(revision);
  feed.accept(frame(delta('1', '99'))); expect(latest().get('1').asks.get('0.5')).toBe('99');
  expect(invalidate).toHaveBeenCalledTimes(1);
});

test('unrelated invalid depth rows do not poison candidates; a malformed candidate still invalidates', () => {
  const { feed, latest, invalidate, unavailable } = setup(); feed.accept(frame(book()));
  feed.accept(frame({ ...delta('999'), price_changes: [{ asset_id: '999', price: 'bad' }] }));
  expect(invalidate).toHaveBeenCalledTimes(1);
  feed.accept(frame({ ...delta(), price_changes: [{ asset_id: '1', price: 'bad' }] }));
  expect(unavailable).toHaveBeenLastCalledWith(['1'], 'invalid_frame');
  feed.accept(frame(delta())); expect(latest().size).toBe(0);
});

test('cumulative parse work, including unrelated frames, exhausts the CPU budget and requires a later snapshot', () => {
  const { feed, latest, invalidate } = setup(); feed.accept(frame(book()));
  let cpu = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => cpu);
  const parse = JSON.parse;
  vi.spyOn(JSON, 'parse').mockImplementation((text: string) => { const result = parse(text); cpu += 5; return result; });
  for (let i = 0; i < 5; i++) feed.accept(frame(delta('999')));
  expect(invalidate).toHaveBeenLastCalledWith('processing_budget');
  const count = invalidate.mock.calls.length;
  for (let i = 0; i < 1000; i++) feed.accept(frame(delta()));
  expect(invalidate).toHaveBeenCalledTimes(count);
  cpu += 100; feed.accept(frame(delta())); expect(latest().size).toBe(0);
  feed.accept(frame(book())); expect(latest().size).toBe(1);
});


test.each(["tick", "malformed_asset", "missing_time"])("%s revokes only the identified asset, preserves the other book and requires a new snapshot", kind => {
  const { feed, latest, unavailable, invalidate } = setup(); feed.accept(frame([book(), book("2")]));
  const retained = latest().get("2");
  const event = kind === "tick" ? { event_type: "tick_size_change", asset_id: "1", market: "m", timestamp: String(Date.now()), new_tick_size: "0.001" }
    : kind === "missing_time" ? { ...book(), timestamp: undefined } : { ...book(), asks: [{ price: "bad", size: "2" }] };
  feed.accept(frame(event)); feed.accept(frame(delta()));
  expect(latest().has("1")).toBe(false); expect(latest().get("2")).toBe(retained);
  expect(unavailable).toHaveBeenLastCalledWith(["1"], kind === "tick" ? "tick_changed" : "invalid_frame");
  expect(invalidate).toHaveBeenCalledTimes(1);
  feed.accept(frame(book())); expect(latest().has("1")).toBe(true); expect(latest().get("2")).toBe(retained);
});

test("a rejected multi-asset frame invalidates every touched asset without publishing partial changes", () => {
  const { feed, latest, unavailable } = setup(); feed.accept(frame([book(), book("2")]));
  feed.accept(frame([delta("1", "99"), { ...book("2"), asks: [{price: "bad", size: "1"}] }]));
  expect(unavailable).toHaveBeenLastCalledWith(["1", "2"], "invalid_frame");
  feed.accept(frame(delta())); expect(latest().size).toBe(0);
});

test("missing identity still invalidates globally; it cannot be narrowed by guessing", () => {
  const { feed, latest, invalidate } = setup(); feed.accept(frame([book(), book("2")]));
  feed.accept(frame({ ...delta(), price_changes: [{ price: "0.5", size: "3", side: "SELL" }] }));
  expect(invalidate).toHaveBeenLastCalledWith("invalid_frame");
  feed.accept(frame(delta())); expect(latest().size).toBe(0);
});
