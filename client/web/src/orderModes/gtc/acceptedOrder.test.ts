import { describe, expect, it } from "vitest";
import { gtcAcceptedOrder, isUnfilledGtcOrder, normalizeGtcAcceptedOrder } from "@changmen/shared/pm_gtc_result";
import { isRebindableOrderRow, isPolymarketOpenPosition, polymarketMoneyForAggregate, estimateArbLockedProfitCny } from "@/shared/orderLink";
import { pmOrderFillPriceText } from "@/shared/pmOrderDisplay";

const accepted = () => ({ shares: "10", price: "0.5" });
const zero = () => ({ Type: "Polymarket", PmSide: "buy" as const, PmOrderType: "GTC" as const, PmGtcExecutionId: "id",
  OrderID: "original", Link: -Date.now(), PmGtcBuyShares: 0, PmShares: 0,
  BetMoney: 0, Money: 0, Odds: 0, Status: "None" });

describe("accepted GTC uses ordinary order identity", () => {
  it("allows dragging before the first fill without counting zero shares as exposure", () => {
    const row = zero();
    expect(isRebindableOrderRow(row)).toBe(true);
    expect(isUnfilledGtcOrder(row)).toBe(true);
    expect(pmOrderFillPriceText(row)).toBeNull();
    expect(isPolymarketOpenPosition(row)).toBe(false);
    expect(polymarketMoneyForAggregate(row, [row])).toBe(0);
    expect(estimateArbLockedProfitCny([row, { OrderID: "other", Link: row.Link, Type: "RAY", BetMoney: 10, Odds: 2, Status: "None" }])).toBeNull();
  });
  it("keeps the existing accounting for FOK, sells and fully sold originals", () => {
    expect(isUnfilledGtcOrder({ Type: "Polymarket", PmGtcBuyShares: 0 })).toBe(false);
    expect(isUnfilledGtcOrder({ ...zero(), PmSide: "sell" })).toBe(false);
    const sold = { ...zero(), PmShares: 0, PmGtcBuyShares: 3 };
    expect(isUnfilledGtcOrder(sold)).toBe(false);
  });
  it.each([{ price: "1" }, { price: "0" }, { shares: "0" }, { shares: "bad" }, { shares: 10 }, { authorize: true }])(
    "rejects invalid original parameters %j", patch => {
      expect(normalizeGtcAcceptedOrder({ ...accepted(), ...patch })).toBeUndefined();
    });
  it("queues an original only after its submission is accepted", () => {
    const row = { submit: "unknown" as const, orderId: null, plan: accepted() };
    expect(gtcAcceptedOrder(row)).toBeUndefined();
    expect(gtcAcceptedOrder({ ...row, submit: "accepted", orderId: "original" })).toEqual(accepted());
  });
});
