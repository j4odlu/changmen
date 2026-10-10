import { describe, expect, it } from "vitest";
import { mergePolymarketProviderSave } from "./save_pm.js";
import { gtcOrderLedger } from "../../../../db/rds/orderModes/gtc/pm_gtc_ledger.js";

function settle(status, cost, money, extra = {}) {
  const raw = { status, betMoney: cost, money, pmOrigin: "changmen", pmSide: "buy",
    pmShares: 9.29, pmFillPrice: 0.78, pmStakeUsdc: cost / 6.7,
    pmFeeUsdc: 0.0797, pmSellState: "settled", pmAttributedSellShares: 0, ...extra };
  return mergePolymarketProviderSave({ status, bet_money: cost, money }, raw, raw,
    "changmen", { ...raw }, money, cost);
}
describe("FOK legacy settlement and GTC exclusive precision", () => {
  it("preserves the VPS FOK sub-yuan settlement behavior", () => {
    const result = settle("win", 49.08353, 12.86802);
    expect(result.money).toBe(12.86802);
    expect(result.raw.money).toBe(result.money);
    expect(result.bet_money).toBe(49.08353);
  });
  it("corrects losing money without charging fees twice", () => {
    const result = settle("lose", 50.34112, -50.54279);
    expect(result.money).toBe(-50.3411);
    expect(result.raw.money).toBe(result.money);
    expect(result.raw.reward).toBeUndefined(); // FOK 基线不会补写输单 reward。
    expect(result.raw.pmFeeUsdc).toBe(0.0797);
  });
  it("preserves FOK sub-yuan drift which never crosses the integer display boundary", () => {
    expect(settle("lose", 50.34112, -50.49).money).toBe(-50.49);
    expect(settle("lose", 50.34112, -50.3411).money).toBe(-50.3411);
  });
  it.each([
    { pmSellState: "partial", pmAttributedSellShares: 2 },
    { pmSellState: "closed", pmAttributedSellShares: 9.29 },
  ])("preserves actual selling PnL for %j", extra => {
    const result = settle("win", 49.08353, 3.2, extra);
    expect(result.money).toBe(3.2);
  });
  it("does not settle an open pending order", () => {
    expect(settle("none", 49.08353, 0).money).toBe(0);
  });
  it.each([["Win", 49.08353, 12.86802, 13.1595], ["Lose", 50.34112, -50.49, -50.3411]])(
    "GTC %s precision remains exclusively in its own ledger", (status, cost, money, expected) => {
      const merged = settle(status, cost, money, { pmGtcExecutionId: "own-gtc", pmGtcBuyShares: 9.29, pmGtcBuyCost: cost / 6.7 });
      const ledger = gtcOrderLedger({ status, bet_money: merged.bet_money, money: merged.money, raw: merged.raw });
      expect(ledger.money).toBe(expected);
      expect(ledger.raw.money).toBe(expected);
      expect(merged.bet_money).toBe(cost);
    });
  it("FOK rows never enter the GTC accounting ledger", () => {
    const merged = settle("none", 49.08353, 0);
    expect(gtcOrderLedger({ status: "None", bet_money: merged.bet_money, money: merged.money, raw: merged.raw })).toBeUndefined();
  });
});
