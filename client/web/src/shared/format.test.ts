import { describe, expect, it } from "vitest";
import {
  createLowOddsSingleLinkId,
  isLowOddsSingleLink,
  orderLinkSortKey as lowOddsSortKey,
  arbPercent,
  arbProfitRate,
  classifyLinkId,
  createValueBetLinkId,
  formatDisplayOdds,
  formatLinkId,
  formatSecond,
  isSingleLegLink,
  isSingleLegRateLink,
  isValueBetLink,
  linkIdSourceLabel,
  orderLinkSortKey,
  percent,
  toFixed,
  VALUE_BET_LINK_BASE,
} from "@changmen/client-core/shared/format";

describe("format shared helpers", () => {
  it("rounds display odds to three decimals and drops invalid values", () => {
    expect(formatDisplayOdds(1.23456)).toBe(1.235);
    expect(formatDisplayOdds(0)).toBe(0);
    expect(formatDisplayOdds(Number.NaN)).toBe(0);
  });

  it("formats seconds without allowing negative time", () => {
    expect(formatSecond(125.9)).toBe("2:05");
    expect(formatSecond(-3)).toBe("0:00");
  });

  it("formats fixed decimals and percentages", () => {
    expect(toFixed(1.239, 2, "floor")).toBe("1.23");
    expect(toFixed(1.239, 2, "round")).toBe("1.24");
    expect(percent(0.1234, 1)).toBe("12.3%");
    expect(percent(Number.NaN)).toBe("N/A");
  });

  it("computes arbitrage percentage from both sides", () => {
    expect(arbPercent(2, 2)).toBe("100.0%");
    expect(arbPercent(0, 2)).toBe("N/A");
  });

  it("converts implied multiplier to profit rate", () => {
    expect(arbProfitRate(1.05)).toBe("5.0%");
    expect(arbProfitRate(1.032, 2)).toBe("3.20%");
  });

  it("formats link id as numeric string", () => {
    expect(isSingleLegLink(-1710000000123)).toBe(true);
    expect(isSingleLegLink(1710000000123)).toBe(false);
    expect(formatLinkId(-1710000000123)).toBe("🏆");
    expect(formatLinkId(42)).toBe("42");
    expect(formatLinkId(0)).toBe("—");
  });

  it("distinguishes valueBet 💎 from 9999 🏆", () => {
    const ts = 1_780_000_000_000;
    const vb = createValueBetLinkId(ts);
    expect(vb).toBe(-(VALUE_BET_LINK_BASE + ts));
    expect(isValueBetLink(vb)).toBe(true);
    expect(isSingleLegRateLink(vb)).toBe(false);
    expect(isSingleLegLink(vb)).toBe(true);
    expect(formatLinkId(vb)).toBe("💎");
    expect(orderLinkSortKey(vb)).toBe(ts);
    expect(orderLinkSortKey(-ts)).toBe(ts);
    expect(classifyLinkId(vb)).toBe("valueBet");
    expect(linkIdSourceLabel("valueBet")).toBe("正EV");
  });

  it("classifies link id source for admin tags", () => {
    expect(classifyLinkId(1781532641651)).toBe("arb");
    expect(linkIdSourceLabel("arb")).toBe("套利");
    expect(classifyLinkId(-1781532641651)).toBe("single");
    expect(linkIdSourceLabel("single")).toBe("单边");
    expect(classifyLinkId(3864266867)).toBe("hash");
    expect(linkIdSourceLabel("hash")).toBe("hash");
    expect(classifyLinkId(0)).toBeNull();
  });
  it("🎯 uses an independent negative Link with the original booking timestamp", () => {
    const at = 1_792_680_000_123;
    const link = createLowOddsSingleLinkId(at);
    expect(formatLinkId(link)).toBe("🎯");
    expect(classifyLinkId(link)).toBe("lowOddsSingle");
    expect(isLowOddsSingleLink(link)).toBe(true);
    expect(isSingleLegRateLink(link)).toBe(false);
    expect(isValueBetLink(link)).toBe(false);
    expect(lowOddsSortKey(link)).toBe(at);
  });

});
