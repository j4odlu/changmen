import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computed, nextTick, watchEffect } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useOddsStore } from "@/stores/oddsStore";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import type { ViewMatch } from "@/models/match";
import { installPmTickBufferQuotes, stopPmTickBufferQuotes } from "./pmTickBufferQuotes";
import { setPmArbPriceBufferPrefs, resetPmArbPriceBufferPrefsForTests } from "@changmen/venue-adapter/polymarket";
import { notePmTickFrame, clearPmTickStateForTests } from "@changmen/venue-adapter/polymarket";
import { pmTickBufferTick } from "@changmen/venue-adapter/polymarket";
const load = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-adapter/polymarket", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/venue-adapter/polymarket")>(),
  fetchPmTickBufferBook: load,
}));
vi.mock("@/api/esport", async importOriginal => ({
  ...await importOriginal<typeof import("@/api/esport")>(),
  saveClientDataDetailed: vi.fn(async () => ({ ok: true })),
}));
beforeEach(() => {
  setActivePinia(createPinia()); clearPmTickStateForTests(); resetPmArbPriceBufferPrefsForTests();
  load.mockReset().mockImplementation(async (tokenId: string) => ({ asset_id: tokenId, tick_size: "0.01", timestamp: 100 }));
  installPmTickBufferQuotes();
});
afterEach(() => { stopPmTickBufferQuotes(); resetPmArbPriceBufferPrefsForTests(); vi.useRealTimers(); });
function seed() {
  useMatchStore().matchs = [{ bets: [{ items: [{ type: "Polymarket", homeId: "t", awayId: "a" }] }] }] as unknown as ViewMatch[];
  useOddsStore().save("Polymarket", { id: "t", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
}
it("percentage and disabled buffers never schedule quote metadata HTTP", async () => {
  seed(); setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  await Promise.resolve(); expect(load).not.toHaveBeenCalled();
  setPmArbPriceBufferPrefs({ enabled: false, mode: "tick", multiplier: 1.01 });
  seed(); await Promise.resolve(); expect(load).not.toHaveBeenCalled();
});
it("percentage enable, multiplier and disable changes refresh consumers without raw writes or tick HTTP", () => {
  seed();
  const odds = useOddsStore(); const raw = odds.getEntry("Polymarket", "t");
  const displayed = computed(() => odds.getOdds("Polymarket", "t"));
  expect(displayed.value).toBe(2);
  setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  expect(displayed.value).toBe(1.980);
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.02 });
  expect(displayed.value).toBe(1.960);
  setPmArbPriceBufferPrefs({ enabled: false, multiplier: 1.02 });
  expect(displayed.value).toBe(2);
  expect(odds.getEntry("Polymarket", "t")).toBe(raw);
  expect(load).not.toHaveBeenCalled();
});
it("saving percentage preferences updates an already rendered UI without waiting for the main loop", async () => {
  seed();
  const user = useUserStore();
  const displayed = computed(() => {
    void user.extensionPrefs.pmArbPriceBuffer.enabled;
    void user.extensionPrefs.pmArbPriceBuffer.multiplier;
    return useOddsStore().getOdds("Polymarket", "t");
  });
  const rendered: number[] = [];
  const stop = watchEffect(() => { rendered.push(displayed.value); });
  try {
    expect(displayed.value).toBe(2);
    user.extensionPrefs.pmArbPriceBuffer = { enabled: true, multiplier: 1.01 };
    await user.saveExtensionPrefs(); await nextTick();
    expect(displayed.value).toBe(1.980); expect(rendered.at(-1)).toBe(1.980);
    user.extensionPrefs.pmArbPriceBuffer.multiplier = 1.02;
    await user.saveExtensionPrefs(); await nextTick();
    expect(displayed.value).toBe(1.960); expect(rendered.at(-1)).toBe(1.960);
    user.extensionPrefs.pmArbPriceBuffer.enabled = false;
    await user.saveExtensionPrefs(); await nextTick();
    expect(displayed.value).toBe(2); expect(rendered.at(-1)).toBe(2);
    expect(load).not.toHaveBeenCalled();
  } finally { stop(); }
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
it("a late tick HTTP result stays independent of percentage and is reused when switching back", async () => {
  vi.useFakeTimers();
  let release!: (book: { asset_id: string; tick_size: string; timestamp: number }) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  seed();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "percent", multiplier: 1.01 });
  release({ asset_id: "t", tick_size: "0.001", timestamp: 200 });
  await vi.advanceTimersByTimeAsync(65_000);
  expect(pmTickBufferTick("t")).toBe("0.001");
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.980);
  expect(load).toHaveBeenCalledOnce();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(1.996);
  await vi.advanceTimersByTimeAsync(0);
});
it("background refresh keeps UI and detection consistent until a new tick arrives", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  seed();
  const displayed = computed(() => useOddsStore().getOdds("Polymarket", "t"));
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  expect(displayed.value).toBe(1.960);
  let release!: (book: { asset_id: string; tick_size: string; timestamp: number }) => void;
  load.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(displayed.value).toBe(1.960);
  expect(useOddsStore().getOdds("Polymarket", "t")).toBe(displayed.value);
  expect(load).toHaveBeenCalledTimes(2);
  release({ asset_id: "t", tick_size: "0.001", timestamp: 200 });
  await vi.advanceTimersByTimeAsync(0);
  expect(displayed.value).toBe(1.996);
});

it("only current open markets prefetch; historical, locked and missing-price rows do not occupy the queue", async () => {
  const odds = useOddsStore();
  for (let i = 0; i < 1000; i++) odds.save("Polymarket", { id: `old-${i}`, odds: 2, clobPrice: 0.5, isLock: false, time: 1 });
  seed();
  odds.save("Polymarket", { id: "a", odds: 2, clobPrice: 0.5, isLock: true, time: 1 });
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.waitFor(() => expect(odds.getOdds("Polymarket", "t")).toBe(1.960));
  expect(load.mock.calls.map(call => call[0])).toEqual(["t"]);
  expect(odds.isQuotePending("Polymarket", "a")).toBe(false);
});

it("a failed metadata refresh retains the last confirmed quote without touching raw prices", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  seed();
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  const odds = useOddsStore(); const raw = odds.getEntry("Polymarket", "t");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  load.mockRejectedValueOnce(new Error("timeout"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(warning).toHaveBeenCalledOnce();
  expect(odds.getOdds("Polymarket", "t")).toBe(1.960);
  expect(odds.isQuotePending("Polymarket", "t")).toBe(false);
  expect(odds.getEntry("Polymarket", "t")).toBe(raw);
  warning.mockRestore();
});

it.each([{ ended: true }, { status: "finished" }, { status: "final" },
  { bo: 3, mapScore: { home: 2, away: 1 } }])(
  "finished PM matches do not prefetch metadata even with stale unlocked prices: %j", async pmSport => {
    seed();
    useMatchStore().matchs[0]!.pmSport = pmSport;
    setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  },
);

it("stops refreshing metadata when a live match ends", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  seed();
  const match = useMatchStore().matchs[0]!;
  match.pmSport = { live: true, currentMap: 3 };
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  match.pmSport = { ended: true, status: "finished" };
  await vi.advanceTimersByTimeAsync(65_000);
  useOddsStore().save("Polymarket", { id: "t", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
});

it("prefetches the current map but excludes completed maps", async () => {
  seed();
  const match = useMatchStore().matchs[0]!;
  match.pmSport = { live: true, currentMap: 3 };
  match.bets[0]!.round = 3;
  match.bets.push({ round: 2, items: [{ type: "Polymarket", homeId: "old-home", awayId: "old-away" }] } as ViewMatch["bets"][number]);
  for (const id of ["old-home", "old-away"])
    useOddsStore().save("Polymarket", { id, odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
  setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(load.mock.calls[0]![0]).toBe("t");
});

it("tick-only WS changes refresh a retained quote while the collection cache is rebuilding", async () => {
  seed(); setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.01 });
  const odds = useOddsStore(); const displayed = computed(() => odds.getOdds("Polymarket", "t"));
  await vi.waitFor(() => expect(displayed.value).toBe(1.960));
  odds.clean("Polymarket");
  expect(odds.getEntry("Polymarket", "t")).toBeUndefined();
  expect(displayed.value).toBe(1.960);
  notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "t", new_tick_size: "0.001", timestamp: 200 }));
  expect(displayed.value).toBe(1.996);
  expect(odds.getPmQuoteEntry("t")?.clobPrice).toBe(0.5);
  expect(odds.isOdds("Polymarket", "t")).toBe(false);
});
