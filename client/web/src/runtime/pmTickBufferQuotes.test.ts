import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computed } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useOddsStore } from "@/stores/oddsStore";
import { installPmTickBufferQuotes, stopPmTickBufferQuotes } from "./pmTickBufferQuotes";
import { setPmArbPriceBufferPrefs, resetPmArbPriceBufferPrefsForTests } from "@changmen/venue-adapter/polymarket";
import { notePmTickFrame, clearPmTickStateForTests } from "@changmen/venue-adapter/polymarket";
import { pmTickBufferTick } from "@changmen/venue-adapter/polymarket";
const load = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-adapter/polymarket", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/venue-adapter/polymarket")>(),
  fetchPmTickBufferBook: load,
}));
beforeEach(() => {
  setActivePinia(createPinia()); clearPmTickStateForTests(); resetPmArbPriceBufferPrefsForTests();
  load.mockReset().mockImplementation(async (tokenId: string) => ({ asset_id: tokenId, tick_size: "0.01", timestamp: 100 }));
  installPmTickBufferQuotes();
});
afterEach(() => { stopPmTickBufferQuotes(); resetPmArbPriceBufferPrefsForTests(); vi.useRealTimers(); });
function seed() {
  useOddsStore().save("Polymarket", { id: "t", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
}
it("percentage and disabled buffers never schedule quote metadata HTTP", async () => {
  seed(); setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  await Promise.resolve(); expect(load).not.toHaveBeenCalled();
  setPmArbPriceBufferPrefs({ enabled: false, mode: "tick", multiplier: 1.01 });
  seed(); await Promise.resolve(); expect(load).not.toHaveBeenCalled();
});
it("mode changes and tick-only WS updates refresh UI without rewriting raw fo", async () => {
  seed();
  const odds = useOddsStore(); const initial = odds.getEntry("Polymarket", "t");
  const displayed = computed(() => odds.getOdds("Polymarket", "t"));
  expect(displayed.value).toBe(2);
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  expect(displayed.value).toBe(0);
  await vi.waitFor(() => expect(displayed.value).toBe(1.960));
  expect(load).toHaveBeenCalledOnce();
  notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "t", new_tick_size: "0.001", timestamp: 200 }));
  expect(displayed.value).toBe(1.996);
  expect(odds.getEntry("Polymarket", "t")).toBe(initial);
  setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  expect(displayed.value).toBe(1.980);
});
it("a late tick HTTP result cannot repopulate the cache after switching back to percentage", async () => {
  vi.useFakeTimers();
  let release!: (book: { asset_id: string; tick_size: string; timestamp: number }) => void;
  load.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  seed();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  release({ asset_id: "t", tick_size: "0.001", timestamp: 200 });
  await vi.advanceTimersByTimeAsync(65_000);
  expect(pmTickBufferTick("t")).toBeUndefined();
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.980);
  expect(load).toHaveBeenCalledOnce();
});
it("expired metadata invalidates the displayed odds until the refresh completes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  seed();
  const displayed = computed(() => useOddsStore().getOdds("Polymarket", "t"));
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  expect(displayed.value).toBe(1.960);
  let release!: (book: { asset_id: string; tick_size: string; timestamp: number }) => void;
  load.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(displayed.value).toBe(0);
  expect(load).toHaveBeenCalledTimes(2);
  release({ asset_id: "t", tick_size: "0.001", timestamp: 200 });
  await vi.advanceTimersByTimeAsync(0);
  expect(displayed.value).toBe(1.996);
});
