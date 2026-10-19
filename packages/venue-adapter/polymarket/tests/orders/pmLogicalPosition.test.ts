import { describe, expect, it } from "vitest";
import { Currency, getExchange } from "@changmen/shared/currency";
import {
  hasOpenPolymarketPosition,
  resolveBuyStakeUsdc,
  resolvePmRemainingShares,
  venueOrderFromOrderRow,
} from "@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition";

describe("pmLogicalPosition", () => {
  const baseRow = {
    OrderID: "0xbuy",
    Type: "Polymarket",
    Status: "None",
    Odds: 2,
    BetMoney: 70,
    Money: 0,
    CreateAt: 1_000,
    PmTokenId: "tok",
    PmShares: 10,
    PmStakeUsdc: 10,
    PmOrigin: "changmen" as const,
    PmSide: "buy" as const,
  };

  it("resolveBuyStakeUsdc falls back from CNY BetMoney when pmStakeUsdc missing", () => {
    const buy = venueOrderFromOrderRow({ ...baseRow, PmStakeUsdc: undefined, BetMoney: 70 });
    expect(resolveBuyStakeUsdc(buy)).toBeCloseTo(10.4478, 4);
    expect(getExchange(Currency.USDT)).toBe(6.7);
  });

  it("resolvePmRemainingShares subtracts attributed sells", () => {
    const order = venueOrderFromOrderRow({ ...baseRow, PmAttributedSellShares: 4 });
    expect(resolvePmRemainingShares(order)).toBe(6);
  });

  it("venueOrderFromOrderRow maps PmMatchResult", () => {
    const win = venueOrderFromOrderRow({ ...baseRow, PmMatchResult: "Win" });
    expect(win.pmMatchResult).toBe("win");
    const none = venueOrderFromOrderRow(baseRow);
    expect(none.pmMatchResult).toBeUndefined();
  });

  it("resolvePmRemainingShares treats FOK dust as zero", () => {
    const order = venueOrderFromOrderRow({
      ...baseRow,
      PmShares: 48.2353,
      PmAttributedSellShares: 48.23,
    });
    expect(resolvePmRemainingShares(order)).toBe(0);
  });

  it("hasOpenPolymarketPosition false when official settled (hides sell)", () => {
    const order = venueOrderFromOrderRow({
      ...baseRow,
      Status: "Win",
      PmSellState: "settled",
    });
    expect(hasOpenPolymarketPosition(order)).toBe(false);
  });

  it("hasOpenPolymarketPosition true when price-win keeps sell open", () => {
    const order = venueOrderFromOrderRow({
      ...baseRow,
      Status: "Win",
      PmSellState: "open",
    });
    expect(hasOpenPolymarketPosition(order)).toBe(true);
  });

  it("hasOpenPolymarketPosition false when fill shares missing", () => {
    const order = venueOrderFromOrderRow({ ...baseRow, PmShares: 0 });
    expect(hasOpenPolymarketPosition(order)).toBe(false);
  });

  it("hasOpenPolymarketPosition true while Status=None and shares remain", () => {
    const order = venueOrderFromOrderRow(baseRow);
    expect(hasOpenPolymarketPosition(order)).toBe(true);
  });
});
