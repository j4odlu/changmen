import { expect, it, vi } from "vitest";
import { createStoredMarketRefresh } from "../../orders/history/storedMarketRefresh";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const refs = [{ conditionId: "condition", tokenId: "token" }];
const market = { condition_id: "condition", closed: false };
const result = () => new Map([["condition", { ...market }]]);

it("returns immediately, deduplicates requests across consumers and refreshes after the TTL", async () => {
  let now = 0;
  const cache = createStoredMarketRefresh({ now: () => now });
  let finish!: (value: ReturnType<typeof result>) => void;
  const load = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; }));
  expect(cache.read(refs, load).size).toBe(0);
  cache.read(refs, load);
  await flush();
  expect(load).toHaveBeenCalledOnce();
  finish(result()); await flush();
  const snapshot = cache.read(refs, load);
  expect(snapshot.get("condition")).toEqual(market);
  snapshot.get("condition")!.closed = true;
  expect(cache.read(refs, load).get("condition")!.closed).toBe(false);
  await flush(); expect(load).toHaveBeenCalledOnce();
  now = 30_000;
  expect(cache.read(refs, load).get("condition")).toEqual(market);
  await flush(); expect(load).toHaveBeenCalledTimes(2);
  finish(result()); await flush();
});

it("keeps successful facts during failures and retries without blocking readers", async () => {
  let now = 0;
  const cache = createStoredMarketRefresh({ now: () => now });
  const load = vi.fn(async () => result());
  cache.read(refs, load); await flush();
  now = 30_000; load.mockRejectedValueOnce(new Error("offline"));
  cache.read(refs, load); await flush();
  expect(cache.read(refs, load).get("condition")).toEqual(market);
  await flush(); expect(load).toHaveBeenCalledTimes(2);
  now += 5_000;
  load.mockResolvedValueOnce(new Map([["condition", { ...market, closed: true }]]));
  cache.read(refs, load); await flush();
  expect(cache.read(refs, load).get("condition")!.closed).toBe(true);
});

it("bounds concurrent background batches and cache size, including hanging reads", async () => {
  const cache = createStoredMarketRefresh({ maxEntries: 5, batchSize: 2, concurrency: 2 });
  const finishes: (() => void)[] = [];
  const load = vi.fn(() => new Promise<Map<string, typeof market>>(resolve => finishes.push(() => resolve(new Map()))));
  const many = Array.from({ length: 10 }, (_, i) => ({ conditionId: String(i) }));
  cache.read(many, load); await flush();
  expect(load.mock.calls).toHaveLength(2);
  expect(load.mock.calls.map(args => (args as unknown as [string[]])[0].length)).toEqual([2, 2]);
  cache.read(many, load); await flush(); expect(load).toHaveBeenCalledTimes(2);
  finishes.shift()!(); await flush(); expect(load).toHaveBeenCalledTimes(3);
  finishes.splice(0).forEach(finish => finish()); await flush();
});

it("clearing cannot resurrect stale responses or reuse a fact for another market", async () => {
  const cache = createStoredMarketRefresh();
  let finish!: (value: ReturnType<typeof result>) => void;
  const load = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; }));
  cache.read(refs, load); await flush(); cache.clear();
  finish(result()); await flush();
  expect(cache.read([{ conditionId: "different" }], async () => result()).size).toBe(0);
  await flush();
  expect(cache.read([{ conditionId: "different" }], async () => result()).size).toBe(0);
});
