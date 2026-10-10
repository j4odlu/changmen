import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { buildPolymarketMatchedBuyVenueOrderForSave } from "@changmen/venue-adapter/polymarket";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { commandGtc } from "./api";
import { gtcFinancialOrder } from "./financialOrder";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/api/client", () => ({ post: mocks.post, unwrap: (value: unknown) => value }));
const hash = `0x${"a".repeat(64)}`;
function accepted() {
  // 计划汇率故意不同：财务应沿用普通 PM 转换，而不是另取 GTC 预算汇率。
  const plan = { source: "manual", fx: 99, playerId: 1, shares: "9.29", price: "0.78", orderHash: hash } as GtcPlan;
  const initial = createGtcExecution("id", "owner", "wallet", "maker", plan, 1);
  return applyGtcCommand(applyGtcCommand(initial, { kind: "authorize_pm" }, 1), { kind: "ack", state: "accepted", orderId: hash }, 2);
}
function facts(fee: string | null) {
  return { order: { id: hash, original: "9.29", matched: "9.29", status: "MATCHED", tradeIds: ["trade"] }, fills: [{ key: "trade:taker", tradeId: "trade", bucket: "taker", role: "TAKER" as const, shares: "9.29", price: "0.78", fee, status: "CONFIRMED", updatedAt: 3 }], complete: true, observedAt: 3 };
}
beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue({}); });
describe("gTC uses the ordinary PM financial chain", () => {
  it.each(["0", "0.07971", "0.123456"])("matches every ordinary financial field for fee %s", (fee) => {
    const row = mergeGtcFacts(accepted(), facts(fee));
    const ordinary = buildPolymarketMatchedBuyVenueOrderForSave(hash, { status: "matched", takingAmount: "9.29" }, { fallbackStakeUsdc: 7.2462, feeUsdc: Number(fee) })!;
    expect(gtcFinancialOrder(row)).toEqual({ pmShares: ordinary.pmShares, pmFillPrice: ordinary.pmFillPrice, pmStakeUsdc: ordinary.pmStakeUsdc, pmFeeUsdc: ordinary.pmFeeUsdc ?? 0, odds: ordinary.odds, betMoney: ordinary.betMoney });
  });
  it("keeps fee rounding and currency conversion identical for the reported order", () => {
    expect(gtcFinancialOrder(mergeGtcFacts(accepted(), facts("0.07971")))).toEqual({ pmShares: 9.29, pmFillPrice: 0.78, pmStakeUsdc: 7.3259, pmFeeUsdc: 0.0797, odds: 1.2821, betMoney: 7.3259 * 6.7 });
  });
  it("preserves six-decimal official shares in the financial command instead of the ordinary four-decimal quantity", async () => {
    const row = accepted(); row.plan.shares = "29.27";
    const incoming = {
      order: { id: hash, original: "29.27", matched: "29.260001", status: "MATCHED", tradeIds: ["trade"] },
      fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER" as const, shares: "29.260001", price: "0.5100000167464197", fee: "0", status: "CONFIRMED", updatedAt: 3 }],
      complete: true, observedAt: 3,
    };
    await commandGtc(row, { kind: "facts", facts: incoming });
    const financial = mocks.post.mock.calls[0]![1].command.financialOrder;
    expect(financial).toMatchObject({ pmShares: 29.260001, pmStakeUsdc: 14.9226, pmFeeUsdc: 0, pmFillPrice: 0.51 });
    expect(financial.betMoney).toBe(14.9226 * 6.7);
  });
  it("does not turn accepted zero or unknown fees into a financial order", () => {
    expect(gtcFinancialOrder(accepted())).toBeUndefined();
    expect(gtcFinancialOrder(mergeGtcFacts(accepted(), facts(null)))).toBeUndefined();
  });
  it("submits ordinary financial output with facts without changing the reactive original", async () => {
    const row = reactive(accepted()); const before = JSON.stringify(row);
    await commandGtc(row, { kind: "facts", facts: facts("0.07971") });
    const [action, body] = mocks.post.mock.calls[0]!;
    expect(action).toBe("Pm_GtcCommand");
    expect(body.command.financialOrder).toEqual(gtcFinancialOrder(mergeGtcFacts(accepted(), facts("0.07971"))));
    expect(JSON.stringify(row)).toBe(before);
  });
});
