import { describe, expect, it, beforeEach } from "vitest";
import {
  isPfOrderListRow,
  isPfSellOrderListRow,
  pfBuyLifecycleTagText,
  pfOrderBetText,
  pfOrderItemText,
  pfOrderMatchText,
  pfOrderProfitDisplayCny,
  pfOrderSharesText,
  pfOrderSideTagText,
  pfOrderStakeDisplayCny,
  pfUnrealizedPnlAtLiveCny,
  resolvePfDisplayShares,
  resolvePfOrderListStatusClass,
  truncateSharesDisplay,
} from "./pfOrderDisplay";
import { formatLiveUnrealizedPnlText } from "./pmOrderDisplay";
import type { OrderRow } from "@/types/order";
import {
  __resetPredictFunTokenMarketIdsForTests,
  rememberPredictFunTokenMarketIds,
} from "@changmen/venue-browser/adapter/predictfun";

const pfBuy: OrderRow = {
  Type: "PredictFun",
  PfSide: "buy",
  PfSellState: "open",
  PfShares: 1.5,
  Odds: 1.666,
  BetMoney: 1,
  Money: 0,
  Status: "None",
  Match: "Team A vs Team B",
  Bet: "全场胜负",
  Item: "Team A",
  PfMarketId: "844582",
  PfTokenId: "81019144045327892",
};

describe("pfOrderDisplay", () => {
  beforeEach(() => {
    __resetPredictFunTokenMarketIdsForTests();
  });

  it("detects PF rows and side tags", () => {
    expect(isPfOrderListRow(pfBuy)).toBe(true);
    expect(isPfOrderListRow({ ...pfBuy, Type: "OB" })).toBe(false);
    expect(pfOrderSideTagText(pfBuy)).toBe("买单");
    expect(pfOrderSideTagText({ ...pfBuy, PfSide: "sell" })).toBe("卖单");
    expect(isPfSellOrderListRow({ ...pfBuy, PfSide: "sell" })).toBe(true);
  });

  it("remaps sold/sell status badges", () => {
    expect(resolvePfOrderListStatusClass(pfBuy)).toBe("None");
    expect(resolvePfOrderListStatusClass({
      ...pfBuy,
      PfSellState: "closed",
      Money: 1.5,
    })).toBe("Win");
    expect(resolvePfOrderListStatusClass({
      ...pfBuy,
      PfSellState: "closed",
      Money: -0.2,
    })).toBe("Lose");
    expect(resolvePfOrderListStatusClass({
      ...pfBuy,
      PfSide: "sell",
      BetMoney: 1.2,
    })).toBe("PfSell");
    expect(resolvePfOrderListStatusClass({
      ...pfBuy,
      Status: "Reject",
    })).toBe("Reject");
  });

  it("keeps readable labels as-is", () => {
    expect(pfOrderMatchText(pfBuy)).toBe("Team A vs Team B");
    expect(pfOrderBetText(pfBuy)).toBe("全场胜负");
    expect(pfOrderItemText(pfBuy)).toBe("Team A");
  });

  it("shows buy hold shares truncated to 2dp (no round)", () => {
    const row: OrderRow = {
      ...pfBuy,
      PfShares: 44.125,
      PfFeeType: "SHARES",
      PfFeeAmountWei: "794250000000000000",
      PfHoldShares: 43.33075,
    };
    expect(resolvePfDisplayShares(row)).toBeCloseTo(43.33075, 8);
    expect(pfOrderSharesText(row)).toBe("43.33");
    // 截断非四舍五入：43.339 → 43.33
    expect(pfOrderSharesText({
      ...pfBuy,
      PfHoldShares: 43.339,
    })).toBe("43.33");
  });

  it("prefers PfHoldShares over fill for buy display", () => {
    expect(pfOrderSharesText({
      ...pfBuy,
      PfShares: 44.125,
      PfHoldShares: 43.33075,
    })).toBe("43.33");
  });

  it("sell row shares also truncate to 2dp", () => {
    expect(resolvePfDisplayShares({ ...pfBuy, PfShares: 44.125 })).toBe(44.125);
    expect(pfOrderSharesText({
      ...pfBuy,
      PfSide: "sell",
      PfShares: 44.125,
      PfFeeType: "SHARES",
      PfFeeAmountWei: "794250000000000000",
    })).toBe("44.12");
  });

  it("truncateSharesDisplay never rounds up", () => {
    expect(truncateSharesDisplay(43.33075)).toBe("43.33");
    expect(truncateSharesDisplay(43.339)).toBe("43.33");
    expect(truncateSharesDisplay(1.999)).toBe("1.99");
    expect(truncateSharesDisplay(2)).toBe("2.00");
  });

  it("marks unrealized pnl from live price × hold − notional", () => {
    const row: OrderRow = {
      ...pfBuy,
      PfHoldShares: 43.33075,
      PfNotionalUsdt: 14.12,
      PfBookPrice: 0.32,
    };
    // 43.33075*0.4 - 14.12 ≈ 3.21U → ×6.7 ≈ 22
    expect(pfUnrealizedPnlAtLiveCny(row, 0.4)).toBe(22);
    expect(pfUnrealizedPnlAtLiveCny(row, 0.2)).toBe(-37);
    expect(formatLiveUnrealizedPnlText(22)).toBe("浮盈：+22");
  });

  it("lifecycle tag is 已结算 for market settle; full sell has no tag", () => {
    expect(pfBuyLifecycleTagText({ ...pfBuy, PfSellState: "closed" })).toBeNull();
    expect(pfBuyLifecycleTagText({ ...pfBuy, PfSellState: "settled" })).toBe("已结算");
    expect(pfBuyLifecycleTagText({ ...pfBuy, Status: "Win" })).toBe("已结算");
    expect(pfBuyLifecycleTagText(pfBuy)).toBeNull();
    expect(resolvePfOrderListStatusClass({
      ...pfBuy,
      PfSellState: "settled",
      Money: 20,
    })).toBe("Win");
  });

  it("scales notional USDT for sidebar stake when PfNotionalUsdt present", () => {
    // 14.12 USDT × 6.7 = 95.999… → scale
    expect(pfOrderStakeDisplayCny({
      Type: "PredictFun",
      PfSide: "buy",
      BetMoney: 13.68,
      PfNotionalUsdt: 14.12,
    })).toBeCloseTo(14.12 * 6.7, 5);
  });

  it("scales USDT BetMoney to CNY for sidebar (same as PM)", () => {
    // 1 USDT × 6.7 = 6.7 CNY
    expect(pfOrderStakeDisplayCny({
      Type: "PredictFun",
      BetMoney: 1,
    })).toBe(6.7);
    expect(pfOrderProfitDisplayCny({
      Type: "PredictFun",
      PfSide: "buy",
      Money: 0.5,
    })).toBe(3.35);
  });

  it("sell row stake display uses BetMoney mirror; sell profit display is null", () => {
    const sell: OrderRow = {
      Type: "PredictFun",
      PfSide: "sell",
      BetMoney: 13.75,
      Money: 99,
      Status: "None",
    };
    expect(pfOrderStakeDisplayCny(sell)).toBe(13.75 * 6.7);
    expect(pfOrderProfitDisplayCny(sell)).toBeNull();
    expect(resolvePfOrderListStatusClass(sell)).toBe("PfSell");
  });

  it("sell row stake prefers PfSellProceeds over BetMoney mirror", () => {
    expect(pfOrderStakeDisplayCny({
      Type: "PredictFun",
      PfSide: "sell",
      BetMoney: 13.75,
      PfSellProceeds: 4.2,
      Status: "None",
    })).toBeCloseTo(4.2 * 6.7, 5);
  });

  it("treats 市场 N as bare and enriches from MarketIndex", () => {
    rememberPredictFunTokenMarketIds({
      updatedAt: Date.now(),
      marketIds: ["844582"],
      entries: [{
        sourceMatchId: "1",
        categoryId: "c1",
        sourceBetId: "bet1",
        homeName: "Kits",
        awayName: "SDM",
        homeTokenId: "81019144045327892",
        awayTokenId: "999",
        homeOdds: 1.6,
        awayOdds: 2.2,
        homeMarketId: "844582",
        awayMarketId: "844582",
        map: 0,
        status: "Open",
      }],
    });
    const bare: OrderRow = {
      Type: "PredictFun",
      Match: "市场 844582",
      Bet: "全场胜负",
      Item: "81019144045327892",
      PfMarketId: "844582",
      PfTokenId: "81019144045327892",
    };
    expect(pfOrderMatchText(bare)).toBe("Kits vs SDM");
    expect(pfOrderBetText(bare)).toBe("全场胜负");
    expect(pfOrderItemText(bare)).toBe("Kits");
  });

  it("enriches bare marketId/token from MarketIndex cache", () => {
    rememberPredictFunTokenMarketIds({
      updatedAt: Date.now(),
      marketIds: ["844582"],
      entries: [{
        sourceMatchId: "1",
        categoryId: "c1",
        sourceBetId: "bet1",
        homeName: "Kits",
        awayName: "SDM",
        homeTokenId: "81019144045327892",
        awayTokenId: "999",
        homeOdds: 1.6,
        awayOdds: 2.2,
        homeMarketId: "844582",
        awayMarketId: "844582",
        map: 0,
        status: "Open",
      }],
    });
    const bare: OrderRow = {
      Type: "PredictFun",
      Match: "844582",
      Bet: "PredictFun",
      Item: "81019144045327892",
      PfMarketId: "844582",
      PfTokenId: "81019144045327892",
    };
    expect(pfOrderMatchText(bare)).toBe("Kits vs SDM");
    expect(pfOrderBetText(bare)).toBe("全场胜负");
    expect(pfOrderItemText(bare)).toBe("Kits");
  });
});
