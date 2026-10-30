import type { ViewBet, ViewBetItem } from "@/models/match";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { useOddsStore } from "@/stores/oddsStore";
import { useUserStore } from "@/stores/userStore";
import { useEvMarker } from "./useEvMarker";

describe("PM EV markers", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(useOddsStore(), "getOdds").mockImplementation((_venue, _id, fallback) => fallback ?? 0);
  });

  it("updates markers and baseline availability when PM odds or the limit changes", () => {
    const user = useUserStore();
    user.extensionPrefs.valueBet.sharp = "Polymarket";
    const pm = reactive({ type: "Polymarket", fallbackHomeOdds: 1.95, fallbackAwayOdds: 1.95, getItemId: () => "pm" });
    const ray = { type: "RAY", fallbackHomeOdds: 2.2, fallbackAwayOdds: 1.7, getItemId: () => "ray" };
    const marker = useEvMarker({ items: [pm, ray] } as unknown as ViewBet);
    const item = ray as unknown as ViewBetItem;
    expect(marker.hasSharpBaseline.value).toBe(true);
    expect(marker.isPositiveEv(item, "Home")).toBe(true);
    expect(marker.evLabel(item, "Home")).toBe("+10.0%");

    pm.fallbackHomeOdds = pm.fallbackAwayOdds = 1.9;
    expect(marker.hasSharpBaseline.value).toBe(false);
    expect(marker.isPositiveEv(item, "Home")).toBe(false);
    expect(marker.isNearEv(item, "Home")).toBe(false);
    expect(marker.evLabel(item, "Home")).toBeUndefined();

    user.extensionPrefs.valueBet.pmMaxOverroundPct = 6;
    expect(marker.hasSharpBaseline.value).toBe(true);
    expect(marker.isPositiveEv(item, "Home")).toBe(true);

    pm.fallbackHomeOdds = pm.fallbackAwayOdds = 1.1;
    expect(marker.hasSharpBaseline.value).toBe(false);
    expect(marker.evLabel(item, "Home")).toBeUndefined();
  });
});
