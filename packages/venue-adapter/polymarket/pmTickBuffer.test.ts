import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPmTickBufferQuote, validatePmTickBufferQuote, clearPmTickBufferMetadata,
  notePmTickBufferBook, pmTickBufferTick, requestPmTickBufferTick, setPmTickBufferLoader,
  pmTickBufferOrderShares } from "./pmTickBuffer";
import { clearPmTickStateForTests, currentPmTick, notePmTickFrame } from "./pmTickState";

beforeEach(() => { clearPmTickBufferMetadata(); clearPmTickStateForTests(); });
afterEach(() => { setPmTickBufferLoader(undefined); clearPmTickBufferMetadata(); vi.useRealTimers(); });
describe("+1 tick quotes", () => {
  it.each([
    [0.5, "0.01", 0.51, 1.960], [0.5, "0.001", 0.501, 1.996],
    [0.5, "0.005", 0.505, 1.980], [0.5, "0.0025", 0.5025, 1.990],
    [0.5, "0.0001", 0.5001, 1.999], [0.5, "0.1", 0.6, 1.666],
  ] as const)("%s + %s retains exactly one price level", (ask, tick, cap, odds) => {
    const quote = createPmTickBufferQuote("t", ask, tick)!;
    expect(quote).toMatchObject({ cap, displayOdds: odds });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(validatePmTickBufferQuote(quote, "t", odds)).toBe(quote);
  });
  it("blocks missing tick, off-grid asks, price boundary and untradeable displayed odds", () => {
    expect(createPmTickBufferQuote("t", 0.5)).toBeUndefined();
    expect(createPmTickBufferQuote("t", 0.505, "0.01")).toBeUndefined();
    expect(createPmTickBufferQuote("t", 0.99, "0.01")).toBeUndefined();
    expect(createPmTickBufferQuote("t", 0.9998, "0.0001")).toBeUndefined();
  });
  it("cannot substitute a token, cap or truncated odds", () => {
    const quote = createPmTickBufferQuote("t", 0.5, "0.01")!;
    expect(() => validatePmTickBufferQuote(quote, "other", 1.960)).toThrow();
    expect(() => validatePmTickBufferQuote({ ...quote, cap: 0.52 }, "t", 1.960)).toThrow();
    expect(() => validatePmTickBufferQuote(quote, "t", 2)).toThrow();
  });
  it("minimum shares use the signed limit and preserve cent-boundary amounts", () => {
    const quote = createPmTickBufferQuote("t", 0.5, "0.01")!;
    expect(pmTickBufferOrderShares(2.5, quote)).toBe(4.9019);
    expect(pmTickBufferOrderShares(2.55, quote)).toBe(5);
    expect(pmTickBufferOrderShares(10, quote)).toBe(19.6078);
  });
});
describe("isolated tick metadata", () => {
  it("HTTP metadata cannot populate the legacy submit-control cache", () => {
    notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01", timestamp: 100 });
    expect(pmTickBufferTick("t")).toBe("0.01");
    expect(currentPmTick("t")).toBeUndefined();
  });
  it("deduplicates loads and rejects an HTTP result that races a WS update", async () => {
    let release!: (book: { asset_id: string; tick_size: string; timestamp: number }) => void;
    const load = vi.fn(() => new Promise<{ asset_id: string; tick_size: string; timestamp: number }>(resolve => { release = resolve; }));
    setPmTickBufferLoader(load);
    requestPmTickBufferTick("t"); requestPmTickBufferTick("t");
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "t", new_tick_size: "0.001", timestamp: 200 }));
    release({ asset_id: "t", tick_size: "0.01", timestamp: 300 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pmTickBufferTick("t")).toBe("0.001");
    expect(currentPmTick("t")).toBe("0.001");
  });
  it("retains confirmed metadata and ignores a stale book even after clearing the quote cache", () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "t", new_tick_size: "0.001", timestamp: 200 }));
    notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01", timestamp: 100 });
    expect(pmTickBufferTick("t")).toBe("0.001");
    vi.advanceTimersByTime(60_000);
    expect(pmTickBufferTick("t")).toBe("0.001");
    clearPmTickBufferMetadata();
    notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01", timestamp: 100 });
    expect(createPmTickBufferQuote("t", 0.5)?.cap).toBe(0.501);
  });
  it("reset and repeated toggles cannot release concurrency slots occupied by real requests", async () => {
    vi.useFakeTimers();
    let active = 0; let maxActive = 0;
    const releases: Array<() => void> = [];
    const load = vi.fn((id: string) => new Promise<{ asset_id: string; tick_size: string }>(resolve => {
      active++; maxActive = Math.max(maxActive, active);
      releases.push(() => { active--; resolve({ asset_id: id, tick_size: "0.01" }); });
    }));
    setPmTickBufferLoader(load);
    for (let i = 0; i < 8; i++) requestPmTickBufferTick(`first-${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(4);
    clearPmTickBufferMetadata();
    setPmTickBufferLoader(undefined); setPmTickBufferLoader(load);
    for (let i = 0; i < 4; i++) requestPmTickBufferTick(`second-${i}`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(active).toBe(4); expect(load).toHaveBeenCalledTimes(4);
    for (const release of releases.splice(0)) release();
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(4);
    for (const release of releases.splice(0)) release();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxActive).toBe(4); expect(active).toBe(0);
  });
});
