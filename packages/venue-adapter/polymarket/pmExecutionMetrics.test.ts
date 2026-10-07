import { beforeEach, describe, expect, test } from "vitest";
import {
  clearPmExecutionMetrics,
  getPmExecutionMetrics,
  getPmExecutionMetricsSummary,
  recordPmExecutionMetric,
  recordPmQuoteToFoMetric,
} from "./pmExecutionMetrics";
import { resetPmMarketWsSourceModeForTests } from "./pmMarketWsMode";
import { setPmHttpModeForTests } from "./pmTransportMode";

describe("pmExecutionMetrics", () => {
  beforeEach(() => {
    clearPmExecutionMetrics();
    resetPmMarketWsSourceModeForTests("official");
    setPmHttpModeForTests("vps");
  });

  test("quote floods cannot evict execution samples", () => {
    recordPmExecutionMetric({ kind: "check", ms: 42, success: true });
    for (let i = 0; i < 400; i++) recordPmExecutionMetric({ kind: "quote_to_fo", success: true });
    expect(getPmExecutionMetricsSummary().byKind.check.count).toBe(1);
  });
  test("records runtime route context with book metrics", () => {
    recordPmExecutionMetric({
      kind: "book",
      tokenId: "tok-1",
      bookSource: "direct-live",
      ms: 12,
      success: true,
    });

    expect(getPmExecutionMetrics()).toMatchObject([
      {
        kind: "book",
        tokenId: "tok-1",
        bookSource: "direct-live",
        wsSource: "official",
        httpMode: "vps",
        ms: 12,
        success: true,
      },
    ]);
  });

  test("records quote-to-fo rejection reasons", () => {
    recordPmQuoteToFoMetric({
      tokenId: "tok-2",
      quotePrice: 0.42,
      quoteSource: "ws",
      success: false,
      rejectReason: "missing_mapping",
    });

    expect(getPmExecutionMetrics()).toMatchObject([
      {
        kind: "quote_to_fo",
        tokenId: "tok-2",
        quotePrice: 0.42,
        quoteSource: "ws",
        success: false,
        rejectReason: "missing_mapping",
      },
    ]);
  });

  test("summarizes PM execution hot-path metrics", () => {
    recordPmExecutionMetric({
      kind: "book",
      tokenId: "tok-1",
      bookSource: "direct-live",
      ms: 10,
      success: true,
    });
    recordPmExecutionMetric({
      kind: "book",
      tokenId: "tok-2",
      bookSource: "vps-fallback",
      fallback: true,
      ms: 50,
      success: true,
    });
    recordPmExecutionMetric({
      kind: "sign",
      tokenId: "tok-1",
      ms: 20,
      success: true,
      bookReuse: true,
      bookAgeMs: 100,
      signWarm: true,
      orderClientCacheHit: false,
      detectionMaxPrice: 0.42,
      bookPrice: 0.4,
      fillPrice: 0.41,
      limitPrice: 0.42,
      apiBetMoney: 12,
      depthAvailableAtCap: 100,
      depthNeedUsdc: 12,
    });
    recordPmExecutionMetric({
      kind: "sign",
      tokenId: "tok-2",
      ms: 40,
      success: true,
      bookReuse: false,
      bookAgeMs: 1501,
      reuseRejectReason: "expired",
      signWarm: true,
      orderClientCacheHit: true,
      detectionMaxPrice: 0.5,
      bookPrice: 0.49,
      fillPrice: 0.5,
      limitPrice: 0.5,
      apiBetMoney: 20,
      depthAvailableAtCap: 40,
      depthNeedUsdc: 20,
      submitStatus: "matched",
    });
    recordPmQuoteToFoMetric({
      tokenId: "tok-3",
      quoteSource: "ws",
      success: false,
      rejectReason: "stale_ws_guard",
    });

    const summary = getPmExecutionMetricsSummary();

    expect(summary.total).toBe(5);
    expect(summary.byKind.book).toMatchObject({
      count: 2,
      success: 2,
      p50Ms: 10,
      p90Ms: 50,
      p95Ms: 50,
      maxMs: 50,
    });
    expect(summary.book).toMatchObject({
      total: 2,
      directLive: 1,
      vpsFallback: 1,
      directLiveRate: 0.5,
      fallbackRate: 0.5,
    });
    expect(summary.bookReuse).toMatchObject({
      observed: 2,
      hit: 1,
      miss: 1,
      hitRate: 0.5,
      ageP50Ms: 100,
      ageP90Ms: 1501,
      rejectReasons: { expired: 1 },
    });
    expect(summary.sign).toMatchObject({
      observed: 2,
      warm: 2,
      cacheHit: 1,
      warmRate: 1,
      cacheHitRate: 0.5,
    });
    expect(summary.execution).toMatchObject({
      observed: 2,
      detectionMaxPriceP50: 0.42,
      bookPriceP50: 0.4,
      fillPriceP50: 0.41,
      limitPriceP50: 0.42,
      apiBetMoneyP50: 12,
      depthAvailableAtCapP50: 40,
      depthNeedUsdcP50: 12,
      submitStatuses: { matched: 1 },
    });
    expect(summary.quoteToFo).toMatchObject({
      total: 1,
      fail: 1,
      sources: { ws: 1 },
      rejectReasons: { stale_ws_guard: 1 },
    });
    expect(summary.recentErrors[0]).toMatchObject({
      kind: "quote_to_fo",
      tokenId: "tok-3",
      rejectReason: "stale_ws_guard",
    });
  });
});
