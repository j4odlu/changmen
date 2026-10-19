import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as canonical from "@changmen/venue-browser/polymarket/pmTickMetadata";
import * as legacy from "../../pmTickMetadata";
import * as nested from "../../quotes/pmTickMetadata";
import * as buffer from "../../pmTickBuffer";
import { clearPmTickStateForTests, notePmTickFrame, notePmTickReconnect } from "@changmen/venue-browser/polymarket/pmTickState";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  clearPmTickStateForTests(); canonical.clearPmTickBufferMetadata();
});
afterEach(() => {
  canonical.setPmTickBufferLoader(undefined); canonical.clearPmTickBufferMetadata();
  clearPmTickStateForTests(); vi.useRealTimers();
});

it("old and new entries share every cache function while HTTP stays on the host", () => {
  for (const [name, value] of Object.entries(canonical)) {
    for (const entry of [legacy, nested, buffer])
      expect((entry as Record<string, unknown>)[name], name).toBe(value);
  }
  expect(canonical).not.toHaveProperty("fetchPmTickBufferTickSize");
  expect(legacy.fetchPmTickBufferTickSize).toBe(nested.fetchPmTickBufferTickSize);
  expect(buffer.fetchPmTickBufferTickSize).toBe(nested.fetchPmTickBufferTickSize);
});

it("mixed entry imports share one cache and deliver a tick change once", () => {
  const changed = vi.fn(), stop = legacy.onPmTickBufferChange(changed);
  try {
    canonical.notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01", timestamp: 100 });
    expect(buffer.pmTickBufferTick("t")).toBe("0.01");
    changed.mockClear();
    notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "t", new_tick_size: "0.001", timestamp: 200 }));
    expect(changed).toHaveBeenCalledExactlyOnceWith("t");
    expect(nested.pmTickBufferTick("t")).toBe("0.001");
    expect(canonical.pmTickBufferTick("t")).toBe("0.001");
  } finally { stop(); }
});

it("mixed entry requests share four occupied slots and discard pre-clear HTTP replies", async () => {
  const releases: Array<() => void> = [];
  const load = vi.fn((_tokenId: string) => new Promise<canonical.PmTickSizeResponse>(resolve => {
    releases.push(() => resolve({ minimum_tick_size: 0.01 }));
  }));
  legacy.setPmTickBufferLoader(load);
  for (let i = 0; i < 6; i++) (i % 2 ? canonical : legacy).requestPmTickBufferTick(`old-${i}`);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(4);
  buffer.clearPmTickBufferMetadata();
  canonical.requestPmTickBufferTick("new");
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(4);
  for (const release of releases.splice(0)) release();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(5);
  expect(canonical.pmTickBufferTick("old-0")).toBeUndefined();
  expect(load.mock.calls.map(call => call[0])).not.toContain("old-4");
  for (const release of releases.splice(0)) release();
  await vi.advanceTimersByTimeAsync(0);
  expect(legacy.pmTickBufferTick("new")).toBe("0.01");
});

it("a reconnect through shared tick state refreshes the same cache once", async () => {
  const load = vi.fn(async () => ({ minimum_tick_size: 0.01 }));
  legacy.setPmTickBufferLoader(load); canonical.requestPmTickBufferTick("t");
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  load.mockResolvedValue({ minimum_tick_size: 0.001 });
  notePmTickReconnect(); await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  expect(buffer.pmTickBufferTick("t")).toBe("0.001");
});
