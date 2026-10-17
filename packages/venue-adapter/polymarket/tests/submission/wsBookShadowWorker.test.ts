import { useFakeMailboxTasks } from '../helpers/mailboxTasks';
useFakeMailboxTasks();
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OwnedWorkerFixture as WsBookShadowWorkerClient } from "../helpers/ownedBookFixtures";
import type { ServiceMessage } from "../../realtime/orderBook/serviceProtocol";
import { beginWsBookShadow, type ShadowAttempt } from "../../submission/preflight/optimized/wsBook/shadowObserver";
import type { ShadowWorkerRequest, ShadowWorkerResponse } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";

class FakeWorker {
  onmessage: Worker["onmessage"] = null;
  onerror: Worker["onerror"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  messages: ShadowWorkerRequest[] = [];
  scope = 0;
  postMessage = vi.fn((message: ServiceMessage) => {
    if (message.type === "batch") { for (const m of message.requests) {
      if (m.type === "attach") this.scope = m.scope;
      if (m.type === "consumer") this.messages.push(m.payload as ShadowWorkerRequest);
      if (m.type === "stream" || m.type === "assets") this.messages.push(m as ShadowWorkerRequest);
    } this.receive({ type: "batch_ack", id: message.id }); }

  }); terminate = vi.fn();
  receive(message: ShadowWorkerResponse) { this.onmessage?.call(this as unknown as Worker, new MessageEvent("message", { data: message.type === "sample" || message.type === "report" ? { type: "consumer", scope: this.scope, payload: message } : message })); }
}
const attempt: ShadowAttempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false,
  role: "execute", leg: "PM:Home:1", attemptId: "attempt-1", executionId: "execution-1" };
let worker: FakeWorker, client: WsBookShadowWorkerClient | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => Date.now()); worker = new FakeWorker(); });
afterEach(() => { client?.stop(); client = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

test("A1/A5: finish never awaits book work, transfers only bounded depth, measures HTTP before worker queue/compare", async () => {
  client = new WsBookShadowWorkerClient(() => true, () => worker); client.setAssets(["1"]);
  const clock = performance.timeOrigin + performance.now();
  const finish = beginWsBookShadow(attempt); await vi.advanceTimersByTimeAsync(420);
  const raw = { credentials: "must-not-cross", orderOptions: { bookTimestamp: 1000, asks: [{ price: .5, size: 2 }] }, price: .5 };
  finish(raw, false);
  expect(client.report().samples.at(-1)).toMatchObject({ outcome: "comparison_pending", httpMs: 420 });
  await vi.advanceTimersByTimeAsync(16);
  const message = worker.messages.findLast(m => m.type === 'finish')!;
  if (message.type !== 'finish') throw Error('finish');
  expect(message.raw).toEqual({ metadataClockAt: clock, orderOptions: { ...raw.orderOptions,
    version: undefined, tickSize: undefined, minOrderSize: undefined, negRisk: undefined }, price: .5 }); expect(message.raw).not.toBe(raw);
  await vi.advanceTimersByTimeAsync(100);
  worker.receive({ type: "sample", id: message.id, sample: { at: 0, source: "attempt", tokenId: "1", httpMs: 9999,
    outcome: "aligned_equal", compareMs: 20, observerQueueMs: 100, beginQueueMs: 3, localReadMs: .1 } });
  expect(client.report().samples.at(-1)).toMatchObject({ httpMs: 420, compareMs: 20, observerQueueMs: 100, beginQueueMs: 3, outcome: "aligned_equal" });
  expect(client.report().pendingComparisons).toBe(0); expect(raw.orderOptions.asks[0]!.size).toBe(2);
});

test("capacity has a complete HTTP denominator, once-only completion, and at most 32 worker attempts", async () => {
  client = new WsBookShadowWorkerClient(() => true, () => worker);
  const finishes = Array.from({ length: 40 }, () => beginWsBookShadow(attempt));
  await vi.advanceTimersByTimeAsync(50);
  for (const finish of finishes) { finish(undefined, true); finish(undefined, true); }
  expect(worker.messages.filter(m => m.type === "begin")).toHaveLength(32);
  expect(client.report().counters).toMatchObject({ attempt_seen: 40, attempt_completed: 40, http_rejected: 40, attempt_capacity: 8 });
  expect(client.report().httpMarketMs.count).toBe(40); expect(client.report().pendingComparisons).toBe(32);
  await vi.advanceTimersByTimeAsync(11000);
  expect(client.report().pendingComparisons).toBe(0);
  expect(client.report().samples.filter(s => s.outcome === "observer_timeout")).toHaveLength(32);
});

test("worker failure and oversized HTTP depth fail open diagnostically without parsing or fallback on main thread", () => {
  client = new WsBookShadowWorkerClient(() => true, () => worker);
  beginWsBookShadow(attempt)({ orderOptions: { asks: Array(2001).fill({ price: .5, size: 1 }) } }, false);
  vi.advanceTimersByTime(16);
  expect(worker.messages.findLast(m => m.type === 'finish')).toMatchObject({ raw: undefined });
  worker.onerror?.call(worker as unknown as Worker, new Event("error") as ErrorEvent);
  expect(worker.terminate).toHaveBeenCalledOnce();
  beginWsBookShadow(attempt)(undefined, true);
  expect(client.report().samples.at(-1)).toMatchObject({ outcome: "worker_failed", httpFailed: true });
  expect(client.report().worker).toBe(false);
});

test("route bounce and teardown never revive a worker; pending HTTP completion stays in old scope only", async () => {
  let allowed = true;
  client = new WsBookShadowWorkerClient(() => allowed, () => worker);
  const old = client, finish = beginWsBookShadow(attempt);
  allowed = false; expect(client.reconcile()).toBe(false);
  allowed = true; expect(client.reconcile()).toBe(false); expect(worker.terminate).toHaveBeenCalledOnce();
  client = new WsBookShadowWorkerClient(() => allowed, () => new FakeWorker());
  await vi.advanceTimersByTimeAsync(500); finish(undefined, true);
  expect(old.report().samples.at(-1)).toMatchObject({ outcome: "scope_stopped", httpMs: 500 });
  expect(client.report().samples).toEqual([]); expect(client.report().counters).toEqual({});
});

test("reports retain bounded recent samples with lifetime denominator counters; classic/proxy routes do not enter observer", () => {
  client = new WsBookShadowWorkerClient(() => true, () => { throw new Error("worker denied"); });
  for (let i = 0; i < 300; i++) beginWsBookShadow(attempt)(undefined, false);
  expect(client.report().samples).toHaveLength(256); expect(client.report().counters.attempt_completed).toBe(300);
  expect(client.report().httpMarketMs.count).toBe(256);
  beginWsBookShadow({ ...attempt, proxied: true })(undefined, false);
  beginWsBookShadow({ ...attempt, gateway: "https://other" })(undefined, false);
  expect(client.report().counters.attempt_seen).toBe(300);
});

test("only numeric HTTP scalars cross the diagnostic worker boundary", () => {
  client = new WsBookShadowWorkerClient(() => true, () => worker);
  beginWsBookShadow(attempt)({ price: { private: "unexpected" }, orderOptions: { bookTimestamp: { private: "unexpected" }, asks: [] } }, false);
  vi.advanceTimersByTime(16);
  expect(worker.messages.findLast(m => m.type === 'finish')).toMatchObject({ raw: { price: undefined, orderOptions: { bookTimestamp: undefined, asks: [] } } });
});
