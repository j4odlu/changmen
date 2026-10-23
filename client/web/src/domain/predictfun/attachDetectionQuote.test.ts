import type { BetOption } from "@changmen/client-core/models/betOption";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { attachPredictFunDetectionQuote } from "@/services/predictFunQuotes";
import { useOddsStore } from "@/stores/oddsStore";
import { resetPfArbPriceBufferPrefsForTests, setPfArbPriceBufferPrefs } from "@changmen/venue-browser/adapter/predictfun";

function pfOption(
  data: Record<string, unknown> | null = null,
  odds = 1.818,
): BetOption {
  return {
    type: "PredictFun",
    itemId: "token-1",
    odds,
    data,
  } as BetOption;
}

describe("attachPredictFunDetectionQuote", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetPfArbPriceBufferPrefsForTests();
  });

  afterEach(() => {
    resetPfArbPriceBufferPrefsForTests();
  });

  test("writes fo clobPrice when it matches option.odds", () => {
    const fo = useOddsStore();
    fo.save("PredictFun", {
      id: "token-1",
      odds: 1.818,
      clobPrice: 0.55,
      marketId: "m1",
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    const option = pfOption();
    attachPredictFunDetectionQuote(option);

    expect(option.data).toMatchObject({
      detectionClobPrice: 0.55,
      marketId: "m1",
    });
  });

  test("skips fo clob when it no longer matches build-time odds", () => {
    const fo = useOddsStore();
    fo.save("PredictFun", {
      id: "token-1",
      odds: 1.724,
      clobPrice: 0.58,
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    const option = pfOption(null, 1.666);
    attachPredictFunDetectionQuote(option);

    expect(option.data).toBeNull();
  });

  test("does not overwrite locked detection cap on recheck", () => {
    const fo = useOddsStore();
    fo.save("PredictFun", {
      id: "token-1",
      odds: 1.449,
      clobPrice: 0.69,
      isLock: false,
      time: Date.now(),
    }, "mqtt");

    const option = pfOption({
      detectionOdds: 1.818,
      detectionMaxPrice: 0.55,
      detectionClobPrice: 0.55,
      marketId: "m1",
    }, 1.818);
    attachPredictFunDetectionQuote(option);

    expect(option.data).toMatchObject({
      detectionClobPrice: 0.55,
      detectionMaxPrice: 0.55,
      marketId: "m1",
    });
  });

  test("buffer on writes execCap even when option.odds is effective", () => {
    const fo = useOddsStore();
    fo.save("PredictFun", {
      id: "token-1",
      odds: 1.128,
      clobPrice: 0.886,
      isLock: false,
      time: Date.now(),
    }, "mqtt");
    setPfArbPriceBufferPrefs({ enabled: true, multiplier: 1.01 });
    const option = pfOption(null, 1.117);
    attachPredictFunDetectionQuote(option);
    expect(option.data).toMatchObject({
      detectionClobPrice: 0.8949,
      detectionMaxPrice: 0.8949,
    });
  });
});
