import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { MarketSubscriptions } from "../module/subscriptions";

const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function harness(count = 2) {
  const quotes = reactive(new Map(Array.from({ length: count }, (_, index) => [String(index), 2])));
  const config = reactive({ profit: 3 });
  const checked: string[] = [];
  const result = vi.fn(); const size = vi.fn();
  const subscriptions = new MarketSubscriptions({
    key: (id: string) => id, signature: id => JSON.stringify([quotes.get(id), config.profit]),
    detect: id => { checked.push(id); return quotes.get(id); }, result, size,
  });
  subscriptions.replace([...quotes.keys()]);
  return { quotes, config, checked, subscriptions, result, size };
}
describe("per-market subscriptions", () => {
  it("checks each market initially and only the changed market thereafter", async () => {
    const h = harness(); await flush(); expect(h.checked).toEqual(["0", "1"]);
    h.quotes.set("0", 2.2); await flush(); expect(h.checked).toEqual(["0", "1", "0"]);
    h.quotes.set("unrelated", 9); await flush(); expect(h.checked).toHaveLength(3); h.subscriptions.stop();
  });
  it("ignores identical saves and coalesces a burst into one fresh check", async () => {
    const h = harness(); await flush(); h.checked.length = 0;
    h.quotes.set("0", 2); await flush(); expect(h.checked).toEqual([]);
    h.quotes.set("0", 2.1); h.quotes.set("0", 0); h.quotes.set("0", 2.4);
    await flush(); expect(h.checked).toEqual(["0"]); expect(h.result).toHaveBeenLastCalledWith("0", 2.4); h.subscriptions.stop();
  });
  it("invalidates markets when global settings change", async () => {
    const h = harness(); await flush(); h.checked.length = 0;
    h.config.profit = 4; await flush(); expect(h.checked).toEqual(["0", "1"]); h.subscriptions.stop();
  });
  it("replaces dependencies and discards callbacks from a removed list", async () => {
    const h = harness(); h.subscriptions.replace(["1"]); await flush(); expect(h.checked).toEqual(["1"]);
    h.quotes.set("0", 3); await flush(); expect(h.checked).toEqual(["1"]); h.subscriptions.stop();
  });
  it("rejects duplicate keys without damaging the previous subscriptions", async () => {
    const h = harness(); await flush(); expect(() => h.subscriptions.replace(["x", "x"])).toThrow("重复");
    h.checked.length = 0; h.quotes.set("0", 3); await flush(); expect(h.checked).toEqual(["0"]); h.subscriptions.stop();
  });
  it("stop removes all subscriptions and pending callbacks", async () => {
    const h = harness(); h.subscriptions.stop(); h.quotes.set("0", 5); await flush(); expect(h.checked).toEqual([]); expect(h.size).toHaveBeenLastCalledWith(0);
  });
  it("yields after 50 markets so sustained updates cannot monopolize a microtask", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness(120); await flush(); expect(h.checked).toHaveLength(50);
    await vi.runAllTimersAsync(); expect(h.checked).toHaveLength(120); h.subscriptions.stop();
  });
  it("wakes a time-based filter at its own deadline without a global scan", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(10_000); const result = vi.fn();
    const subscriptions = new MarketSubscriptions({ key: (id: string) => id, signature: id => id,
      detect: () => Date.now() < 11_000, result, size: () => {}, wakeAt: () => Date.now() < 11_000 ? 11_000 : undefined });
    subscriptions.replace(["market"]); await flush(); expect(result).toHaveBeenLastCalledWith("market", true);
    await vi.advanceTimersByTimeAsync(1001); expect(result).toHaveBeenLastCalledWith("market", false); subscriptions.stop();
  });
});
