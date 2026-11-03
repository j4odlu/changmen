import { describe, expect, it } from "vitest";
import { exactGtcSellCash } from "@changmen/venue-browser/polymarket/gtc/sellCash";
const trade = { id: "t", taker_order_id: "sell", asset_id: "token", side: "SELL", size: "4", status: "CONFIRMED", transaction_hash: "tx" };
const activity = { type: "TRADE", side: "SELL", asset: "token", size: 4, usdcSize: 2.352, transactionHash: "tx" };
describe("GTC sell cash proof", () => {
  it.each(["CONFIRMED", "TRADE_STATUS_CONFIRMED", " trade_status_confirmed "])("accepts %s for both exact taker and maker net credits", (status) => {
    expect(exactGtcSellCash([{ ...trade, status }], [activity], "sell", "token", 4)).toBe(2.352);
    expect(exactGtcSellCash([{ ...trade, status, taker_order_id: "other", maker_orders: [{ order_id: "sell", asset_id: "token", side: "SELL", matched_amount: "4" }] }],
      [activity], "sell", "token", 4)).toBe(2.352);
  });
  it.each(["MATCHED", "MATCHED_NOT_BROADCASTED", "MINED", "RETRYING", "FAILED", "UNKNOWN"])("does not count prefixed %s as confirmed sale proceeds", (status) => {
    expect(() => exactGtcSellCash([{ ...trade, status: `TRADE_STATUS_${status}` }], [activity], "sell", "token", 4)).toThrow("GTC");
  });
  it("ignores prefixed failed fills without losing a different confirmed fill", () => {
    expect(exactGtcSellCash([{ ...trade, status: "TRADE_STATUS_CONFIRMED" },
      { ...trade, id: "failed", status: "TRADE_STATUS_FAILED", transaction_hash: "failed-tx" }], [activity], "sell", "token", 4)).toBe(2.352);
  });
  it("uses net wallet credit once rather than subtracting a fee from it again", () => {
    expect(exactGtcSellCash([trade, trade], [activity], "SELL", "token", 4)).toBe(2.352);
  });
  it("maker sell is matched through its own maker leg and actual cash", () => {
    expect(exactGtcSellCash([{ ...trade, taker_order_id: "other", maker_orders: [{ order_id: "sell", asset_id: "token", side: "SELL", matched_amount: "4" }] }], [{ ...activity, usdcSize: 2.4 }], "sell", "token", 4)).toBe(2.4);
  });
  it("sums multiple confirmed transactions only for the exact sell order", () => {
    expect(exactGtcSellCash([trade, { ...trade, id: "t2", transaction_hash: "tx2" }, { ...trade, id: "foreign", taker_order_id: "other" }],
      [activity, { ...activity, transactionHash: "tx2" }], "sell", "token", 8)).toBe(4.704);
  });
  it.each([
    [[{ ...trade, status: "MINED" }], [activity], 4],
    [[{ ...trade, status: "FAILED" }], [activity], 4],
    [[{ ...trade, asset_id: "other" }], [activity], 4],
    [[trade], [{ ...activity, transactionHash: "other" }], 4],
    [[trade], [{ ...activity, size: 8 }], 4],
    [[trade], [{ ...activity, usdcSize: undefined }], 4],
    [[trade], [activity], 8],
  ] as const)("unknown or unrelated sale proof is not converted to estimated proceeds %#", (trades, rows, shares) => {
    expect(() => exactGtcSellCash([...trades], [...rows], "sell", "token", shares)).toThrow("GTC");
  });
});
