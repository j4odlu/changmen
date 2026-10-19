import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewBetItem } from "@/models/match";
import { useOddsStore } from "@/stores/oddsStore";
import { resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs } from "@changmen/venue-browser/adapter/polymarket";

/**
 * 保证套利/展示读 fo 即时价，不依赖 refreshOddsOnBets → updateOdds 抄 fallback。
 */
describe("ViewBetItem Polymarket getOdds reads fo without updateOdds", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetPmArbPriceBufferPrefsForTests();
  });

  afterEach(() => {
    resetPmArbPriceBufferPrefsForTests();
  });

  it("returns live fo odds while fallback stays stale", () => {
    const odds = useOddsStore();
    odds.save("Polymarket", {
      id: "tok-home",
      odds: 1.95,
      clobPrice: 0.5128,
      isLock: false,
      betId: "cond-1",
      side: "home",
      time: Date.now(),
    }, "mqtt");

    const item = new ViewBetItem(
      {
        Type: "Polymarket",
        BetID: "cond-1",
        HomeID: "tok-home",
        AwayID: "tok-away",
        HomeOdds: 0,
        AwayOdds: 0,
        Status: "Normal",
      },
      "pm-match-1",
    );

    expect(item.fallbackHomeOdds).toBe(0);
    expect(item.getOdds("Home")).toBe(1.95);
  });

  it("buffer on: getOdds is the single read chokepoint (display/scan/bet follow)", () => {
    const odds = useOddsStore();
    odds.save("Polymarket", {
      id: "tok-home",
      odds: 1.128,
      clobPrice: 0.886,
      isLock: false,
      betId: "cond-1",
      time: Date.now(),
    }, "mqtt");
    const item = new ViewBetItem(
      {
        Type: "Polymarket",
        BetID: "cond-1",
        HomeID: "tok-home",
        AwayID: "tok-away",
        HomeOdds: 0,
        AwayOdds: 0,
        Status: "Normal",
      },
      "pm-match-1",
    );
    expect(item.getOdds("Home")).toBe(1.128);
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    expect(item.getOdds("Home")).toBe(1.117);
  });

  it("buffer on without fo: fallback stays true odds (no invert-and-discount)", () => {
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    const odds = useOddsStore();
    expect(odds.getOdds("Polymarket", "no-fo-token", 1.128)).toBe(1.128);
    const item = new ViewBetItem(
      {
        Type: "Polymarket",
        BetID: "cond-sport",
        HomeID: "no-fo-token",
        AwayID: "no-fo-away",
        HomeOdds: 0,
        AwayOdds: 0,
        Status: "Normal",
      },
      "pm-sport-1",
    );
    item.fallbackHomeOdds = 1.128;
    expect(item.getOdds("Home")).toBe(1.128);
  });
});
