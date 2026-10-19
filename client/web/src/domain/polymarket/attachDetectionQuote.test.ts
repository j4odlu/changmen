import type { BetOption } from "@changmen/client-core/models/betOption";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { useOddsStore } from "@/stores/oddsStore";
import { resetPmArbPriceBufferPrefsForTests, setPmArbPriceBufferPrefs } from "@changmen/venue-browser/adapter/polymarket";

function pmOption(
  data: Record<string, unknown> | null = null,
  odds = 1.47,
): BetOption {
  return {
    type: "Polymarket",
    itemId: "token-1",
    odds,
    data,
  } as BetOption;
}

describe("attachPolymarketDetectionQuote", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetPmArbPriceBufferPrefsForTests();
  });

  afterEach(() => {
    resetPmArbPriceBufferPrefsForTests();
  });

  test("writes fo clobPrice when it matches option.odds", () => {
    const fo = useOddsStore();
    fo.save("Polymarket", {
      id: "token-1",
      odds: 1.47,
      clobPrice: 0.68,
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    const option = pmOption();
    attachPolymarketDetectionQuote(option);

    expect(option.data).toMatchObject({ detectionClobPrice: 0.68 });
  });

  test("skips fo clob when it no longer matches build-time odds", () => {
    const fo = useOddsStore();
    fo.save("Polymarket", {
      id: "token-1",
      odds: 1.724,
      clobPrice: 0.58,
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    // 建腿时 0.60 → 1.666；fo 已变 0.58，不得写入限价
    const option = pmOption(null, 1.666);
    attachPolymarketDetectionQuote(option);

    expect(option.data).toBeNull();
  });

  test("does not overwrite locked detection cap on PM recheck", () => {
    const fo = useOddsStore();
    fo.save("Polymarket", {
      id: "token-1",
      odds: 1.449,
      clobPrice: 0.69,
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    const option = pmOption({
      detectionOdds: 1.47,
      detectionMaxPrice: 0.68,
      detectionClobPrice: 0.68,
      tokenId: "token-1",
      side: "BUY",
    }, 1.47);
    attachPolymarketDetectionQuote(option);

    expect(option.data).toMatchObject({
      detectionOdds: 1.47,
      detectionMaxPrice: 0.68,
      detectionClobPrice: 0.68,
    });
  });

  test("buffer on writes execCap even when option.odds is effective", () => {
    const fo = useOddsStore();
    fo.save("Polymarket", {
      id: "token-1",
      odds: 1.128,
      clobPrice: 0.886,
      isLock: false,
      time: Date.now(),
    }, "mqtt");
    setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    const option = pmOption(null, 1.117);
    attachPolymarketDetectionQuote(option);
    expect(option.data).toMatchObject({
      detectionClobPrice: 0.8949,
      detectionMaxPrice: 0.8949,
    });
  });
});
