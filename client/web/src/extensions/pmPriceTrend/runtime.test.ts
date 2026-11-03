import { afterEach, expect, it, vi } from "vitest";
import { createPriceTrendRuntime } from "./runtime";

afterEach(() => { vi.useRealTimers(); });

it("shares one passive listener and timer, filters tokens and releases the last consumer", () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  let emit!: (quote: { assetId: string; bestAsk: number }) => void;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((receive: typeof emit) => { emit = receive; return unsubscribe; });
  const runtime = createPriceTrendRuntime(subscribe);
  const a = vi.fn(); const b = vi.fn();
  const releaseA = runtime.observe(["home", "away", "home"], a);
  const releaseB = runtime.observe(["home"], b);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  const quote = Object.freeze({ assetId: "home", bestAsk: .4 });
  emit(quote); emit({ assetId: "unrelated", bestAsk: .9 });
  expect(runtime.read("home", Date.now())).toEqual([{ at: 10_000, price: .4 }]);
  expect(runtime.read("away", Date.now())).toEqual([]);
  expect(runtime.read("unrelated", Date.now())).toEqual([]);
  expect(a).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  releaseA(); releaseA();
  expect(unsubscribe).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(2);
  expect(runtime.read("home", Date.now())).toHaveLength(1);
  releaseB();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(runtime.read("home", Date.now())).toEqual([]);
  emit({ assetId: "home", bestAsk: .8 });
  expect(runtime.read("home", Date.now())).toEqual([]);
  const releaseNew = runtime.observe(["home"], a);
  expect(subscribe).toHaveBeenCalledTimes(2);
  expect(runtime.read("home", Date.now())).toEqual([]);
  releaseNew();
});

it("does not start resources for missing assets and handles repeated callback references", () => {
  vi.useFakeTimers();
  const unsubscribe = vi.fn(); const subscribe = vi.fn(() => unsubscribe);
  const runtime = createPriceTrendRuntime(subscribe);
  runtime.observe([""], vi.fn())();
  expect(subscribe).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  const notify = vi.fn();
  const a = runtime.observe(["a"], notify); const b = runtime.observe(["b"], notify);
  a(); vi.advanceTimersByTime(1_000);
  expect(notify).toHaveBeenCalledTimes(1);
  b(); expect(unsubscribe).toHaveBeenCalledTimes(1);
});
