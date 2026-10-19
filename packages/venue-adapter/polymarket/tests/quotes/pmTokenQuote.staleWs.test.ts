import { afterEach, describe, expect, test, vi } from "vitest";
import { registerOddsAccess, clearOddsAccess, type VenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { clearPmExecutionMetrics, getPmExecutionMetrics } from "@changmen/venue-browser/polymarket/pmExecutionMetrics";
import {
  notePolymarketLiveBookQuote,
  resetPolymarketLiveQuoteTsForTests,
  saveTokenQuote,
  shouldApplyPolymarketWsQuote,
  syncPolymarketFoOnPriceAboveDetection,
  PolymarketPriceAboveDetectionError,
} from "@changmen/venue-browser/polymarket/quotes/pmTokenQuote";

describe("shouldApplyPolymarketWsQuote", () => {
  afterEach(() => {
    resetPolymarketLiveQuoteTsForTests();
    clearPmExecutionMetrics();
    clearOddsAccess();
    vi.useRealTimers();
  });

  test("applies first quote without timestamp", () => {
    expect(shouldApplyPolymarketWsQuote("tok")).toBe(true);
  });

  test("drops older exchange timestamp", () => {
    expect(shouldApplyPolymarketWsQuote("tok", 2000)).toBe(true);
    expect(shouldApplyPolymarketWsQuote("tok", 1999)).toBe(false);
    expect(shouldApplyPolymarketWsQuote("tok", 2001)).toBe(true);
  });

  test("after fo correction, drops timestamp-less WS for 2s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    notePolymarketLiveBookQuote("tok");
    expect(shouldApplyPolymarketWsQuote("tok")).toBe(false);
    vi.setSystemTime(1_700_000_000_000 + 1_999);
    expect(shouldApplyPolymarketWsQuote("tok")).toBe(false);
    vi.setSystemTime(1_700_000_000_000 + 2_001);
    expect(shouldApplyPolymarketWsQuote("tok")).toBe(true);
  });

  test("records quote_to_fo metric when saving WS quote", () => {
    const saved: VenueOddsEntry[] = [];
    registerOddsAccess({
      read: (_platform, _id, fallback) => fallback,
      save: (_platform, entry) => saved.push(entry),
      clean: () => {},
      isOdds: () => false,
      getEntry: () => undefined,
      updateOddsLock: () => {},
      updateBetLock: () => {},
      updateMessage: () => {},
      getLimit: () => undefined,
      setLimit: () => {},
    });

    saveTokenQuote({
      tokenId: "tok-ws",
      clobPrice: 0.4,
      betId: "market-1",
      side: "home",
      locked: false,
    }, "mqtt");

    expect(saved).toHaveLength(1);
    expect(getPmExecutionMetrics()).toMatchObject([
      {
        kind: "quote_to_fo",
        tokenId: "tok-ws",
        betId: "market-1",
        side: "home",
        quotePrice: 0.4,
        quoteSource: "ws",
        success: true,
      },
    ]);
  });

  test("records book-correct quote source when syncing fo after price-above-detection", () => {
    const entries = new Map<string, VenueOddsEntry>();
    registerOddsAccess({
      read: (_platform, _id, fallback) => fallback,
      save: (platform, entry) => {
        if (platform === PLATFORMS.Polymarket)
          entries.set(entry.id, entry);
      },
      clean: () => {},
      isOdds: () => false,
      getEntry: (_platform, oddsId) => entries.get(String(oddsId)),
      updateOddsLock: () => {},
      updateBetLock: () => {},
      updateMessage: () => {},
      getLimit: () => undefined,
      setLimit: () => {},
    });

    syncPolymarketFoOnPriceAboveDetection(
      {
        itemId: "tok-book",
        betId: "market-2",
        target: "Home",
      } as BetOption,
      new PolymarketPriceAboveDetectionError("too high", 0.55, 0.5),
    );

    expect(entries.get("tok-book")?.clobPrice).toBe(0.55);
    expect(getPmExecutionMetrics()).toMatchObject([
      {
        kind: "quote_to_fo",
        tokenId: "tok-book",
        betId: "market-2",
        side: "home",
        quotePrice: 0.55,
        quoteSource: "book-correct",
        success: true,
      },
    ]);
  });
});
