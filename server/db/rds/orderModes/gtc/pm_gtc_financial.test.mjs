import { describe, expect, it } from "vitest";
import { resolveGtcFinancialOrder } from "./pm_gtc_financial.js";

const normal = { pmShares: 9.29, pmFillPrice: 0.78, pmStakeUsdc: 7.3259, pmFeeUsdc: 0.0797, odds: 1.2821, betMoney: 7.3259 * 6.7 };
const execution = () => ({ orderId: "original", complete: true, matched: "9.29", principal: "7.2462", fee: "0.07971", fills: {} });
describe("ordinary financial output is preserved by GTC persistence", () => {
  it("persists all ordinary fields without recalculating their precision", () => {
    expect(resolveGtcFinancialOrder(execution(), normal)).toEqual(normal);
  });
  it.each([{ pmShares: 10 }, { pmStakeUsdc: 8 }, { pmFeeUsdc: 0 }, { betMoney: normal.betMoney * 6.7 }, { pmFillPrice: 0.79 }, { odds: Number.NaN }])("rejects mismatched facts or repeated conversion %j", (patch) => {
    expect(() => resolveGtcFinancialOrder(execution(), { ...normal, ...patch })).toThrow("成交事实不一致");
  });
  it("does not apply stale financial output when cumulative fills change", () => {
    const row = { ...execution(), matched: "10", principal: "7.8", fee: "0.0858", financialOrder: normal };
    expect(resolveGtcFinancialOrder(row)).toBeUndefined();
  });
  it("recovers the ordinary result for subsequent close/cancel state updates", () => {
    expect(resolveGtcFinancialOrder({ ...execution(), financialOrder: normal })).toEqual(normal);
  });
  it("leaves facts intact when a legacy client has not supplied ordinary financial output", () => {
    expect(resolveGtcFinancialOrder(execution())).toBeUndefined();
  });
});
