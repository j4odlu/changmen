import { describe, expect, test } from "vitest";
import type { BetOption } from "@changmen/client-core/models/betOption";
import {
  detectionMaxPriceFromOdds,
  polymarketClobMatchesOdds,
  resolvePolymarketDetectionMaxPrice,
} from "../../pmDetection";

function optionWithData(data: Record<string, unknown> | null, odds = 1.47): BetOption {
  return {
    odds,
    data,
  } as BetOption;
}

describe("polymarketClobMatchesOdds", () => {
  test("matches truncateOddsTo3(1/clob) with display odds", () => {
    expect(polymarketClobMatchesOdds(0.68, 1.47)).toBe(true);
    expect(polymarketClobMatchesOdds(0.6, 1.666)).toBe(true);
  });

  test("rejects when fo moved to a different tick than detection odds", () => {
    expect(polymarketClobMatchesOdds(0.58, 1.666)).toBe(false);
  });
});

describe("resolvePolymarketDetectionMaxPrice", () => {
  test("uses fo clobPrice when it matches detection odds", () => {
    expect(resolvePolymarketDetectionMaxPrice(
      optionWithData({ detectionClobPrice: 0.68 }, 1.47),
      1.47,
    )).toBe(0.68);
  });

  test("falls back to 1/odds when clobPrice missing", () => {
    expect(resolvePolymarketDetectionMaxPrice(optionWithData(null), 5)).toBe(0.2);
    expect(detectionMaxPriceFromOdds(1.471)).toBe(0.6798);
  });

  test("falls back to 1/odds when fo clob no longer matches detection odds", () => {
    // 建腿 0.60 → odds 1.666；预检时 fo 已变 0.58 → 不得用 0.58 收紧限价
    expect(resolvePolymarketDetectionMaxPrice(
      optionWithData({ detectionClobPrice: 0.58 }, 1.666),
      1.666,
    )).toBe(detectionMaxPriceFromOdds(1.666));
  });

  test("keeps locked detection cap that still matches detection odds", () => {
    expect(resolvePolymarketDetectionMaxPrice(
      optionWithData({
        detectionOdds: 1.47,
        detectionMaxPrice: 0.68,
        detectionClobPrice: 0.69,
      }, 1.47),
      1.47,
    )).toBe(0.68);
  });
});
