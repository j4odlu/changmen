import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import OrderList from "@/components/order/OrderList.vue";
import { pmOrderStakeDisplayCny, pmOrderStakeDisplayUsdc } from "@/shared/pmOrderDisplay";
import { useOrderStore } from "@/stores/orderStore";
import { gtcFinancialOrder } from "./gtc/financialOrder";
import { gtcProgress } from "./gtc/gtcProgressState";
import { gtcOrderDisplayGroups } from "./gtc/orderDisplayProjection";
import PendingOrders from "./gtc/PendingOrders.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
const date = "2026-10-10";
const now = new Date(`${date}T10:00:00+08:00`).getTime();
const hash = `0x${"a".repeat(64)}`;
const row: OrderRow = { OrderID: hash, PmGtcExecutionId: "id", Type: "Polymarket", PlayerID: 1, Link: -now, Match: "match", Bet: "全场独赢", Item: "Home", CreateAt: now, Status: "Win", PmSide: "buy", PmShares: 10, PmFillPrice: 0.5, PmStakeUsdc: 5, PmFeeUsdc: 0, BetMoney: 36, Odds: 2 };
function execution(fee: string | null = "0", shares = "10", price = "0.5", role: "MAKER" | "TAKER" = "MAKER") {
  const plan = { source: "manual", fx: 7.2, playerId: 1, shares, price, orderHash: hash, match: "match", bet: "全场独赢", item: "Home", linkId: -now, originalPmLeg: "A" } as GtcPlan;
  const created = createGtcExecution("id", "owner", "wallet", "maker", plan, now);
  const accepted = applyGtcCommand(applyGtcCommand(created, { kind: "authorize_pm" }, now), { kind: "ack", state: "accepted", orderId: hash }, now);
  return mergeGtcFacts(accepted, { order: { id: hash, original: shares, matched: shares, status: "MATCHED", tradeIds: ["trade"] }, fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role, shares, price, fee, status: "CONFIRMED", updatedAt: now }], complete: true, observedAt: now });
}
async function render(rows: OrderRow[]) {
  const pinia = createPinia(); setActivePinia(pinia);
  const orders = useOrderStore(); orders.orderDate = date; orders.orders = new Map(rows.length ? [[-now, rows]] : []);
  return renderToString(createSSRApp({ render: () => h("div", [
    h(OrderList, { orderEntries: rows.length ? [[-now, rows]] : [], allowPmSell: true }),
    h(PendingOrders, { date, accountId: 0 }),
  ]) }).use(pinia));
}
beforeEach(() => { gtcProgress.owner = "owner"; gtcProgress.records = []; gtcProgress.error = ""; });
describe("one original produces one ordinary order card", () => {
  it("renders an entered GTC original once with its own progress details", async () => {
    gtcProgress.records = [execution()]; const html = await render([row]);
    expect(html.match(/class="order"/g)).toHaveLength(1);
    expect(html.match(/data-execution-id="id"/g)).toHaveLength(1);
    expect(html).toContain("买入金额"); expect(html).toContain("全部成交");
    expect(html).not.toContain("尚未入库的 GTC 挂单");
  });
  it("keeps an absent original visible without creating an ordinary statistics row", async () => {
    gtcProgress.records = [execution()]; const html = await render([]);
    expect(html.match(/class="order"/g)).toHaveLength(1);
    expect(html).toContain("尚未入库的 GTC 挂单"); expect(useOrderStore().orders.size).toBe(0);
  });
  it("ordinary FOK rendering receives no GTC badge or details", async () => {
    const html = await render([{ ...row, PmGtcExecutionId: undefined }]);
    expect(html.match(/class="order"/g)).toHaveLength(1); expect(html).not.toContain("GTC");
  });
  it("shows the same all-in cost before and after persistence without separate fee or principal lines", async () => {
    const filled = execution("0.07971", "9.29", "0.78");
    gtcProgress.records = [filled];
    const pending = gtcOrderDisplayGroups([], [filled], date, 0)[0]!.pending!;
    const financial = gtcFinancialOrder(filled)!;
    const stored = { ...row, PmShares: financial.pmShares, PmFillPrice: financial.pmFillPrice, PmStakeUsdc: financial.pmStakeUsdc, PmFeeUsdc: financial.pmFeeUsdc, BetMoney: financial.betMoney, Odds: financial.odds };
    expect(pmOrderStakeDisplayUsdc(pending)).toBe(7.3259);
    expect(pmOrderStakeDisplayCny(pending)).toBe(7.3259 * 6.7);
    expect(pmOrderStakeDisplayCny(stored)).toBe(pmOrderStakeDisplayCny(pending));
    for (const rows of [[], [stored]]) {
      const html = await render(rows);
      expect(html).toMatch(/买入金额：\s*(?:<!--[\s\S]*?-->\s*)*49/);
      expect(html).not.toContain("手续费：");
      expect(html).not.toContain("成交本金：");
    }
    // 卖出后保留原始含费买入成本，不能用剩余仓位成本替换。
    expect(pmOrderStakeDisplayCny({ ...stored, PmAttributedSellShares: 4, PmStakeUsdc: 4.1, PmSellState: "partial" })).toBe(financial.betMoney);
  });
  it("never presents principal-only cost when the fill fee is unknown", async () => {
    const filled = execution(null, "9.29", "0.78", "TAKER");
    gtcProgress.records = [filled];
    const pending = gtcOrderDisplayGroups([], [filled], date, 0)[0]!.pending!;
    expect(pending.BetMoney).toBeUndefined();
    expect(pending.PmStakeUsdc).toBeUndefined();
    expect(pending.PmFillPrice).toBe(0.78);
    const html = await render([]);
    expect(html).toMatch(/买入金额：\s*(?:<!--[\s\S]*?-->\s*)*待核实/);
    expect(html).not.toContain("手续费：");
  });
});
