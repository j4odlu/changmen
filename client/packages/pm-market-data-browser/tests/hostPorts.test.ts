import { afterEach, expect, test, vi } from "vitest";
import { PmOrderBookService, BookStore, reduceBookFrame } from "../src/index";
import type { BookHostPorts } from "../src/service";
import type { WorkerPort, ServiceMessage } from "../src/serviceProtocol";
import type { MarketStreamEvent } from "../src/marketStreamProtocol";
import { BookStore as CompatibilityStore } from "@changmen/venue-browser/adapter/polymarket/realtime/orderBook/bookStore";
import { reduceBookFrame as compatibilityReducer } from "@changmen/venue-browser/adapter/polymarket/realtime/orderBook/bookReducer";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(allowed = true) {
  vi.useFakeTimers();
  const messages: ServiceMessage[] = [];
  const worker: WorkerPort = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: value => { messages.push(value); }, terminate: vi.fn() };
  let forward!: (event: MarketStreamEvent) => void;
  const release = vi.fn(), createWorker = vi.fn(() => worker);
  const source = { subscribedAssets: () => ["1"], observe: vi.fn((next: typeof forward) => {
    forward = next; next({ type: "state", state: { epoch: 1, open: true, source: "official" } }); return release;
  }) };
  const ports: BookHostPorts = { source, createWorker, allowed: () => allowed, monotonicNow: () => performance.now() };
  return { ports, worker, messages, release, createWorker, source, push: (event: MarketStreamEvent) => forward(event),
    revoke: () => { allowed = false; } };
}
test("old paths export the canonical reducer and store identities", () => {
  expect(CompatibilityStore).toBe(BookStore);
  expect(compatibilityReducer).toBe(reduceBookFrame);
});
test("an unauthorized host cannot create a Worker or observe the source", () => {
  const f = fixture(false), owner = new PmOrderBookService(f.ports);
  expect(f.createWorker).not.toHaveBeenCalled(); expect(f.source.observe).not.toHaveBeenCalled();
  expect(owner.report()).toMatchObject({ worker: false, assets: 0 }); owner.stop();
});
test("the injected owner creates one Worker, never gains subscription authority, and releases once", () => {
  const f = fixture(), owner = new PmOrderBookService(f.ports);
  try {
    const first = owner.acquire(), second = owner.acquire();
    expect(first.setInterests(["1", "2"])).toEqual([{ asset: "1", status: "admitted" }, { asset: "2", status: "not_subscribed" }]);
    expect(f.createWorker).toHaveBeenCalledOnce(); expect(f.source.observe).toHaveBeenCalledOnce();
    first.release(); second.release(); expect(owner.report().worker).toBe(true);
    f.revoke(); owner.reconcile(); owner.reconcile(); owner.stop();
    expect(f.release).toHaveBeenCalledOnce(); expect(f.worker.terminate).toHaveBeenCalledOnce();
    expect(owner.report()).toMatchObject({ worker: false, consumers: 0 });
  } finally { owner.stop(); }
});
test("a revoke synchronously cancels an existing complete read", async () => {
  const f = fixture(), owner = new PmOrderBookService(f.ports);
  const lease = owner.acquire(); lease.setInterests(["1"]);
  const reading = lease.readFullBook("1"); f.revoke(); owner.reconcile();
  expect(await reading).toMatchObject({ asset: "1", status: "service_stopped" });
  expect(owner.report().pendingReads).toBe(0); owner.stop();
});
