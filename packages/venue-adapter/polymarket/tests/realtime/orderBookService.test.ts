import { useFakeMailboxTasks } from '../helpers/mailboxTasks';
useFakeMailboxTasks();
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BookStore } from "../../realtime/orderBook/bookStore";
import { PmOrderBookService } from "@changmen/venue-browser/polymarket/realtime/orderBook/service";
import { WsBookShadowWorkerClient } from "../../submission/preflight/optimized/wsBook/shadowWorkerClient";
import { beginWsBookShadow } from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import type { MarketStreamEvent } from "../../realtime/marketStreamProtocol";
import type { ServiceMessage, ServiceResponse } from "../../realtime/orderBook/serviceProtocol";

let owner: PmOrderBookService, book: BookStore, frame: (event: MarketStreamEvent) => void;
let source: string[], allowed: boolean, sequence: number;
const release = vi.fn();
class Port {
  onmessage: Worker["onmessage"] = null; onerror: Worker["onerror"] = null; onmessageerror: Worker["onmessageerror"] = null;
  terminate = vi.fn(); messages: ServiceMessage[] = []; generation = 0;
  sequence = 0; holdFull = false;
  receive(data: ServiceResponse) { this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent); }
  postMessage = (data: ServiceMessage) => {
    this.messages.push(data);
    for (const m of data.requests) {
      if (m.type === "stream") { book.feed.accept?.(m.event); this.generation = m.generation; this.sequence = m.event.type === "frame" ? m.event.sequence : 0; }
      if (m.type === "assets") { book.feed.setAssets(m.ids); this.generation = m.generation; }
      if (m.type === "depth") this.receive({ type: "depth", id: m.id, generation: this.generation, view: book.depth(m.asset, m.levels) });
      if (m.type === "full_book" && !this.holdFull) this.receive({ type: "full_book", id: m.id, generation: this.generation,
        view: { ...book.fullBook(m.asset), processedSequence: this.sequence } });
    }
    this.receive({ type: "batch_ack", id: data.id });
  };
}
let port: Port;
const flush = () => vi.advanceTimersByTimeAsync(16);
function push(size = "7", snapshot = true) {
  const raw = snapshot ? { event_type: "book", asset_id: "1", market: "m", timestamp: String(Date.now()), hash: "h", bids: [{ price: "0.4", size: "2" }], asks: [{ price: "0.5", size }] }
    : { event_type: "price_change", market: "m", timestamp: String(Date.now()), price_changes: [{ asset_id: "1", side: "SELL", price: "0.5", size }] };
  frame({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(), raw: JSON.stringify(raw) });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  release.mockClear(); source = ["1", "2"]; allowed = true; sequence = 0; book = new BookStore(() => true); port = new Port();
  owner = new PmOrderBookService(() => allowed, () => port, () => source, fn => {
    frame = fn; fn({ type: "state", state: { epoch: 1, open: true, source: "official" } }); return release;
  });
});
afterEach(() => { owner.stop(); book.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("warm book survives dynamic consumer detach; depth and late dynamic consumers share one owner", async () => {
  push(); await flush();
  const dynamic = new WsBookShadowWorkerClient(() => true, owner); dynamic.setAssets(["1"]);
  const depth = owner.acquire(); depth.setInterests(["1"]);
  dynamic.stop(); push("9", false); await flush();
  const view = depth.readDepth("1"); await flush();
  expect(await view).toMatchObject({ status: "ready", revision: 2, asks: [{ price: "0.5", size: "9" }] });
  expect(port.terminate).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  const late = new WsBookShadowWorkerClient(() => true, owner); late.setAssets(["1"]); expect(book.reader.history("1").at(-1)?.revision).toBe(2);
  late.stop(); depth.release(); expect(owner.report().consumers).toBe(0); expect(owner.report().worker).toBe(true);
});
test("admission does not evict another lease and never expands source subscription", () => {
  source = Array.from({ length: 20 }, (_, i) => String(i + 1)); owner.reconcile();
  const a = owner.acquire(), b = owner.acquire(); a.setInterests(source.slice(0, 16));
  expect(b.setInterests(["1", "17", "999", "bad"])).toEqual([
    { asset: "1", status: "admitted" }, { asset: "17", status: "capacity_exceeded" },
    { asset: "999", status: "not_subscribed" }, { asset: "bad", status: "invalid_asset" },
  ]);
  a.release(); expect(b.setInterests(["17"])[0]?.status).toBe("admitted");
  expect(source).toHaveLength(20); expect(owner.report().assets).toBe(16);
});
test("dynamic diagnostic assets exclude requests not admitted by the public source", async () => {
  const dynamic = new WsBookShadowWorkerClient(() => true, owner);
  dynamic.setAssets(["1", "999"]); await flush();
  const payloads = port.messages.flatMap(batch => batch.requests).filter(m => m.type === "consumer").map(m => m.payload as { type: string; ids?: string[] });
  expect(payloads.filter(m => m.type === "assets").at(-1)?.ids).toEqual(["1"]);
  source = []; owner.reconcile(); dynamic.reconcile(); await flush();
  const after = port.messages.flatMap(batch => batch.requests).filter(m => m.type === "consumer").map(m => m.payload as { type: string; ids?: string[] });
  expect(after.filter(m => m.type === "assets").at(-1)?.ids).toEqual([]); dynamic.stop();
});
test("refused second dynamic consumer reports failure without stealing the first observer", () => {
  const first = new WsBookShadowWorkerClient(() => true, owner), second = new WsBookShadowWorkerClient(() => true, owner);
  expect(second.report().failure).toBe("consumer_unavailable");
  beginWsBookShadow({ tokenId: "1", role: "execute", leg: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false })(undefined, false);
  expect(first.report().counters.attempt_seen).toBe(1); expect(second.report().counters.attempt_seen).toBeUndefined();
  second.stop(); expect(owner.report().diagnostics).toBe(1); first.stop();
});
test("depth views are bounded and immutable; consumer release settles pending reads", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]);
  const pending = lease.readDepth("1"); await flush(); const view = await pending;
  expect(Object.isFrozen(view)).toBe(true); expect(Object.isFrozen(view.asks?.[0])).toBe(true);
  const read = lease.readDepth("1"); lease.release(); expect(await read).toMatchObject({ status: "consumer_released" });
  expect(owner.report().pendingReads).toBe(0);
});
test("depth capacity and decimal ordering stay bounded without rounding price identity", async () => {
  const asks = Array.from({ length: 60 }, (_, i) => ({ price: `0.5000000000000000${String(59 - i).padStart(2, "0")}`, size: "1" }));
  frame({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(),
    raw: JSON.stringify({ event_type: "book", asset_id: "1", market: "m", timestamp: String(Date.now()), hash: "h", asks, bids: [] }) });
  await flush(); const lease = owner.acquire(); lease.setInterests(["1"]);
  const reading = lease.readDepth("1", 999); await flush(); const view = await reading;
  expect(view.asks).toHaveLength(50); expect(view.viewTruncated).toBe(true);
  expect(view.asks?.slice(0, 2)).toEqual([{ price: "0.5", size: "1" }, { price: "0.500000000000000001", size: "1" }]);
  const pending = Array.from({ length: 32 }, () => lease.readDepth("1"));
  expect(await lease.readDepth("1")).toMatchObject({ status: "read_capacity" });
  lease.release(); expect((await Promise.all(pending)).every(row => row.status === "consumer_released")).toBe(true);
});
test("source disconnect invalidates all views; pre-snapshot deltas cannot recover the book", async () => {
  push(); await flush(); frame({ type: "state", state: { epoch: 1, open: false, source: "official" } }); await flush();
  expect(book.depth("1").status).toBe("waiting_snapshot");
  frame({ type: "state", state: { epoch: 2, open: true, source: "official" } }); push("9", false); await flush();
  expect(book.depth("1").status).toBe("waiting_snapshot"); expect(owner.report().streamEpoch).toBe(2);
});
test("failure and revoked authorization release only local resources and never restart", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]);
  const pending = lease.readDepth("1"); port.onerror?.call(port as unknown as Worker, new Event("error") as ErrorEvent);
  expect(await pending).toMatchObject({ status: "worker_failed" });
  expect(release).toHaveBeenCalledOnce(); expect(port.terminate).toHaveBeenCalledOnce();
  owner.reconcile(); expect(owner.report().worker).toBe(false);
  allowed = false; owner.reconcile(); expect(owner.report().consumers).toBe(0);
});
test("slow/throwing view listeners are bounded and cannot stop the service", () => {
  const lease = owner.acquire(), good = vi.fn(); lease.onChange(() => { throw Error("consumer"); }); lease.onChange(good);
  owner.reconcile(); owner.reconcile(); expect(good).toHaveBeenCalledTimes(2); expect(owner.report().worker).toBe(true);
  expect(() => { for (let i = 0; i < 4; i++) lease.onChange(() => {}); }).toThrow("listener_capacity");
});
test("independent store validates integrity evidence and rejects old generation or ambiguous timestamps", async () => {
  push(); await flush(); const before = book.reader.history("1"), generation = book.reader.generation;
  book.reader.reportIntegrity({ generation: generation - 1, asset: "1", sourceAt: before[0]!.sourceAt, before, asks: [] });
  expect(book.depth("1").status).toBe("ready");
  book.reader.reportIntegrity({ generation, asset: "1", sourceAt: before[0]!.sourceAt, before, asks: [] });
  expect(book.depth("1").status).toBe("waiting_snapshot");
  expect("reset" in book.reader).toBe(false); expect("feed" in book.reader).toBe(false);
});

test("full read includes every level, preserves ingress time and cannot be forged or reused after stream advancement", async () => {
  const asks = Array.from({ length: 100 }, (_, i) => ({ price: String((i + 100) / 1000), size: "10" }));
  frame({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(),
    raw: JSON.stringify({ event_type: "book", asset_id: "1", market: "m", timestamp: String(Date.now()), hash: "h", asks, bids: [] }) });
  await flush(); const lease = owner.acquire(); lease.setInterests(["1"]);
  const pending = lease.readFullBook("1"); await flush(); const view = await pending;
  expect(view).toMatchObject({ status: "ready", viewTruncated: false, processedSequence: 1 });
  expect(view.asks).toHaveLength(100); expect(Object.isFrozen(view.asks?.[99])).toBe(true);
  expect(view.receivedClockAt).toBe(performance.timeOrigin + book.reader.history("1")[0]!.receivedAt);
  expect(lease.isCurrent(view)).toBe(true); expect(lease.isCurrent({ ...view })).toBe(false);
  push("10", false); expect(lease.isCurrent(view)).toBe(false);
});

test.each(["worker", "release", "disconnect", "invalidation", "timeout"])("full reads settle on %s and late replies cannot resurrect them", async fault => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]); port.holdFull = true;
  const pending = lease.readFullBook("1"); await flush();
  const request = port.messages.flatMap(row => row.requests).findLast(row => row.type === "full_book")!;
  if (request.type !== "full_book") throw Error("request");
  if (fault === "worker") port.onerror?.call(port as unknown as Worker, new Event("error") as ErrorEvent);
  if (fault === "release") lease.release();
  if (fault === "disconnect") frame({ type: "state", state: { epoch: 1, open: false, source: "official" } });
  if (fault === "invalidation") port.receive({ type: "book_invalidated" });
  if (fault === "timeout") await vi.advanceTimersByTimeAsync(5);
  const view = await pending; expect(view.status).not.toBe("ready"); expect(owner.report().pendingReads).toBe(0);
  port.receive({ type: "full_book", id: request.id, generation: port.generation, view: { ...book.fullBook("1"), processedSequence: 1 } });
  expect(lease.isCurrent(view)).toBe(false); expect(owner.report().pendingReads).toBe(0);
});

test("delayed timer cannot allow an overdue full response; local integrity invalidation revokes an issued view", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]);
  const first = lease.readFullBook("1"); await flush(); const issued = await first;
  port.receive({ type: "book_invalidated" }); expect(lease.isCurrent(issued)).toBe(false);
  port.holdFull = true; const pending = lease.readFullBook("1"); await flush();
  const request = port.messages.flatMap(row => row.requests).findLast(row => row.type === "full_book")!;
  if (request.type !== "full_book") throw Error("request");
  vi.setSystemTime(Date.now() + 100); // no timer delivery, like a suspended page
  port.receive({ type: "full_book", id: request.id, generation: port.generation, view: { ...book.fullBook("1"), processedSequence: 1 } });
  expect((await pending).status).toBe("read_timeout");
});

test.each(["target", "unrelated"])("bounded FIFO catch-up processes %s messages before accepting a full view", async kind => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]); port.holdFull = true;
  const pending = lease.readFullBook("1"); await vi.advanceTimersByTimeAsync(1);
  const request = port.messages.flatMap(b => b.requests).findLast(r => r.type === "full_book")!;
  if (request.type !== "full_book") throw Error("request");
  const old = { ...book.fullBook("1"), processedSequence: sequence };
  if (kind === "target") push("99", false);
  else frame({ type: "frame", epoch: 1, sequence: ++sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(),
    raw: JSON.stringify({ event_type: "last_trade_price", asset_id: "999" }) });
  port.holdFull = false;
  port.receive({ type: "full_book", id: request.id, generation: port.generation, view: old });
  expect(owner.report().pendingReads).toBe(1);
  await vi.advanceTimersByTimeAsync(1); const view = await pending;
  expect(view).toMatchObject({ status: "ready", processedSequence: 2, asks: [{ price: "0.5", size: kind === "target" ? "99" : "7" }] });
  expect(lease.isCurrent(view)).toBe(true);
  const requests = port.messages.flatMap(b => b.requests).filter(r => r.type === "full_book");
  expect(requests).toHaveLength(2); expect(requests.every(r => r.deadline === request.deadline)).toBe(true);
  expect(owner.report().fullReads).toMatchObject({ catchups: 1, recovered: 1 });
});

test("continuous ingress exhausts catch-up count without accepting lag or extending the deadline", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]); port.holdFull = true;
  const pending = lease.readFullBook("1"); await vi.advanceTimersByTimeAsync(1);
  for (let i = 0; i < 4; i++) {
    const request = port.messages.flatMap(b => b.requests).findLast(r => r.type === "full_book")!;
    if (request.type !== "full_book") throw Error("request");
    const old = { ...book.fullBook("1"), processedSequence: sequence }; push(String(20 + i), false);
    port.receive({ type: "full_book", id: request.id, generation: port.generation, view: old });
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(await pending).toMatchObject({ status: "stream_advanced" });
  expect(owner.report().fullReads).toMatchObject({ catchups: 3, exhausted: 1, recovered: 0 });
  expect(owner.report().pendingReads).toBe(0);
});

test("catch-up timeout and invalidation fail closed without accepting the previously read book", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1"]); port.holdFull = true;
  const pending = lease.readFullBook("1"); await vi.advanceTimersByTimeAsync(19);
  const request = port.messages.flatMap(b => b.requests).findLast(r => r.type === "full_book")!;
  if (request.type !== "full_book") throw Error("request");
  push("9", false);
  port.receive({ type: "full_book", id: request.id, generation: port.generation, view: { ...book.fullBook("1"), processedSequence: 1 } });
  await vi.advanceTimersByTimeAsync(2);
  expect(await pending).toMatchObject({ status: "read_timeout" });
  expect(owner.report().fullReads.timeouts).toBe(1);
  const next = lease.readFullBook("1"); await vi.advanceTimersByTimeAsync(1);
  port.receive({ type: "book_invalidated" }); expect(await next).toMatchObject({ status: "book_invalidated" });
  expect(owner.report().pendingReads).toBe(0);
});


test("asset invalidation settles only its requests and revokes only its issued views", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1", "2"]); await flush();
  const first = lease.readFullBook("1"); await flush(); const a = await first;
  // A no-snapshot view for 2 still has valid service provenance; readiness is a separate concern.
  const second = lease.readFullBook("2"); await flush(); const b = await second;
  port.holdFull = true;
  const pendingA = lease.readFullBook("1"), pendingB = lease.readFullBook("2");
  await vi.advanceTimersByTimeAsync(1);
  port.receive({ type: "book_invalidated", assets: ["1"] });
  expect(await pendingA).toMatchObject({status:"book_invalidated"});
  expect(owner.report().pendingReads).toBe(1); expect(lease.isCurrent(a)).toBe(false); expect(lease.isCurrent(b)).toBe(true);
  const request = port.messages.flatMap(m => m.requests).findLast(m => m.type === "full_book" && m.asset === "2")!;
  if (request.type !== "full_book") throw Error("request");
  port.receive({type:"full_book", id:request.id, generation:port.generation, view:{...book.fullBook("2"),processedSequence:port.sequence}});
  expect((await pendingB).status).toBe("waiting_snapshot");
  expect(owner.report().pendingReads).toBe(0);
});

test("old asset integrity evidence cannot invalidate a recovered asset or a healthy peer", async () => {
  push(); await flush();
  const generation = book.reader.generation, old = book.reader.history("1"), assetVersion = book.reader.assetGeneration("1");
  book.feed.reset("tick_changed", ["1"]); expect(book.reader.generation).toBe(generation);
  push(); await flush(); expect(book.reader.assetGeneration("1")).not.toBe(assetVersion);
  book.reader.reportIntegrity({generation,asset:"1",sourceAt:old[0]!.sourceAt,before:old,asks:[]});
  expect(book.fullBook("1").status).toBe("ready");
});


test("roster removal preserves peer reads and never revives old views after re-admission", async () => {
  push(); await flush(); const lease = owner.acquire(); lease.setInterests(["1", "2"]); await flush();
  const first = lease.readFullBook("1"); await flush(); const a = await first;
  const second = lease.readFullBook("2"); await flush(); const b = await second;
  const generation = owner.report().generation;
  port.holdFull = true; const pendingA = lease.readFullBook("1"), pendingB = lease.readFullBook("2");
  await vi.advanceTimersByTimeAsync(1);
  source = ["2"]; owner.reconcile();
  expect(await pendingA).toMatchObject({status:"assets_changed"});
  expect(owner.report().generation).toBe(generation);
  expect(owner.report().pendingReads).toBe(1); expect(lease.isCurrent(b)).toBe(true);
  source = ["1", "2"]; owner.reconcile();
  expect(lease.isCurrent(a)).toBe(false); expect(lease.isCurrent(b)).toBe(true);
  const request = port.messages.flatMap(m => m.requests).findLast(m => m.type === "full_book" && m.asset === "2")!;
  if (request.type !== "full_book") throw Error("request");
  port.receive({type:"full_book", id:request.id, generation:port.generation, view:{...book.fullBook("2"),processedSequence:port.sequence}});
  expect((await pendingB).status).toBe("waiting_snapshot");
});

test("integrity hints without a captured asset proof cannot invalidate a newly received snapshot", async () => {
  push(); await flush(); const current = book.reader.history("1")[0]!;
  book.reader.reportIntegrity({generation:book.reader.generation,asset:"1",sourceAt:current.sourceAt,before:[],asks:[]});
  expect(book.fullBook("1").status).toBe("ready");
});
