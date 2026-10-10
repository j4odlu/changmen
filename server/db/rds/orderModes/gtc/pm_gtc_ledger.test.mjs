import { describe, expect, it } from "vitest";
import { gtcOrderLedger, gtcSellRowEvent, mergeGtcSellEvents } from "./pm_gtc_ledger.js";
import { sellDbRowToPositionEvent } from "../../../../backend/core/account/order/position_events.js";

const order = (raw = {}, extra = {}) => ({ bet_money: 34.17, money: 999, status: "None",
  raw: { pmGtcExecutionId: "own", pmGtcBuyShares: 10, pmGtcBuyCost: 5.1, pmSide: "buy", ...raw }, ...extra });
const sale = (raw = {}) => order({ pmAttributedSellShares: 4, pmSellProceeds: 2.4, pmSellState: "partial", ...raw });
describe("GTC cash ledger", () => {
  it("partial/canceled buy charges only actual filled principal plus its fee once", () => {
    const row = order({ pmFeeUsdc: 0.1, pmGtcOpenShares: 15 });
    expect(gtcOrderLedger(row)).toMatchObject({ money: 0, raw: { pmStakeUsdc: 5.1, pmRealizedPnlUsdc: 0 } });
    row.status = "Lose";
    expect(gtcOrderLedger(row).money).toBe(-34.17);
  });
  it("no-fill canceled/failed trade costs and loses zero", () => {
    expect(gtcOrderLedger(order({ pmGtcBuyShares: 0, pmGtcBuyCost: 0 }, { bet_money: 0, status: "Lose" })).money).toBe(0);
  });
  it.each([["Win", 32.83], ["Lose", -34.17]])("unsold %s final cash is payout minus original fee-inclusive cost", (status, expected) => {
    expect(gtcOrderLedger(order({}, { status })).money).toBe(expected);
  });
  it("manual partial sale uses fraction of original all-in cost and leaves the remaining basis", () => {
    expect(gtcOrderLedger(sale())).toMatchObject({ money: 2.412, raw: { pmRealizedPnlUsdc: 0.36, pmStakeUsdc: 3.06, pmShares: 10 } });
  });
  it.each([["win", 22.11], ["lose", -18.09]])("partial sale then %s counts residual payout once even after repeated sync", (result, expected) => {
    let row = sale({ pmMatchResult: result });
    for (let i=0; i<10; i++) {
      const ledger = gtcOrderLedger(row); expect(ledger.money).toBe(expected);
      row = { ...row, ...ledger };
    }
  });
  it("full sell has no remaining settlement amount regardless of win/lose", () => {
    for (const result of [undefined,"win","lose"])
      expect(gtcOrderLedger(sale({ pmAttributedSellShares: 10, pmSellProceeds: 6, pmMatchResult: result })))
        .toMatchObject({ money: 6.03, raw: { pmStakeUsdc: 0, pmSellState: "closed" } });
  });
  it("ignores old rounded CNY/paper pnl and uses cumulative unrounded sale cash", () => {
    expect(gtcOrderLedger(sale({ pmSellProceeds: 2.4078, pmRealizedPnlUsdc: 90 }, { money: 998 })).money).toBe(2.4643);
  });
  it("late fee changes update both realized pnl and remaining cost", () => {
    const row = sale({ pmGtcBuyCost: 5.2 }); row.bet_money = 34.84;
    expect(gtcOrderLedger(row)).toMatchObject({ money: 2.144, raw: { pmStakeUsdc: 3.12, pmRealizedPnlUsdc: 0.32 } });
  });
  it("later fills after selling previously filled shares reopen only that order's remaining position", () => {
    const row = sale({ pmGtcBuyShares: 20, pmGtcBuyCost: 10.2, pmAttributedSellShares: 10, pmSellProceeds: 6, pmSellState: "closed" });
    row.bet_money = 68.34;
    expect(gtcOrderLedger(row)).toMatchObject({ money: 6.03, raw: { pmShares: 20, pmStakeUsdc: 5.1, pmSellState: "partial" } });
  });
  it("sell ledger can correct a previous gross/fee estimate downwards using complete exact sell events", () => {
    const row = sale({ pmSellProceeds: 2.5, positionEvents: { sells: [{ id: "s1", shares: 4, proceeds: 2.4 }] } });
    expect(gtcOrderLedger(row)).toMatchObject({ money: 2.412, raw: { pmSellProceeds: 2.4 } });
  });
  it("incomplete event history cannot wipe out total sale cash", () => {
    const row = sale({ positionEvents: { sells: [{ id: "s1", shares: 2, proceeds: 1.2 }] } });
    expect(gtcOrderLedger(row).raw.pmSellProceeds).toBe(2.4);
  });
  it("sell dust closes the remaining basis exactly once", () => {
    expect(gtcOrderLedger(sale({ pmAttributedSellShares: 9.995, pmSellProceeds: 6 })))
      .toMatchObject({ money: 6.03, raw: { pmStakeUsdc: 0, pmAttributedSellShares: 10 } });
  });
  it.each([{ pmAttributedSellShares: 4 }, { pmSellState: "partial" }, { pmSellProceeds: 2 }, { pmRealizedPnlUsdc: 2 }])("does not invent missing sale evidence %j", raw => {
    expect(gtcOrderLedger(order(raw))).toBeUndefined();
  });
  it("invalidated buy fills with more shares already sold are surfaced instead of rewriting cash", () => {
    expect(() => gtcOrderLedger(sale({ pmGtcBuyShares: 3 }))).toThrow("卖出份数");
  });
  it.each([{ pmGtcExecutionId: undefined }, { pmSide: "sell" }, { pmGtcBuyCost: undefined }, { pmGtcBuyCost: NaN }])("does not recalculate unrelated/unknown rows %j", raw => {
    expect(gtcOrderLedger(order(raw))).toBeUndefined();
  });
  it("merges duplicate or stale sell snapshots by exact ID without losing another sale", () => {
    const previous = { positionEvents: { sells: [{ id: "ONE", shares: 3, proceeds: 1.8, at: 1 }, { id: "two", shares: 1, proceeds: 0.6, at: 2 }] } };
    const incoming = { positionEvents: { sells: [{ id: "one", shares: 2, proceeds: 1.2, at: 1 }] } };
    expect(mergeGtcSellEvents(previous, incoming).sells).toHaveLength(2);
    expect(gtcOrderLedger(sale({ positionEvents: mergeGtcSellEvents(previous, incoming) })).money).toBe(2.412);
  });
  it("sell row's cash comes from proceeds CNY, never its allocated buy basis", () => {
    expect(gtcSellRowEvent({ order_id: "sale", create_at: 1, bet_money: 16.08,
      raw: { pmSide: "sell", pmShares: 4, pmStakeUsdc: 2.04 } })).toMatchObject({ proceeds: 2.4, shares: 4 });
  });
  it("historical GTC sell-event backfill uses cash rather than the amortized basis", () => {
    expect(sellDbRowToPositionEvent({ provider:"Polymarket",order_id:"s",bet_money:16.08,
      raw:{pmGtcExecutionId:"g",pmSide:"sell",pmBuyOrderId:"buy",pmShares:4,pmStakeUsdc:2.04} }).event.proceeds).toBe(2.4);
  });
});
