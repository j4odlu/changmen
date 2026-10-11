import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { toFixed } from "@changmen/client-core/shared/format";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import OrderList from "@/components/order/OrderList.vue";
import { groupOrdersByEffectiveLink, isRebindableOrderRow, orderLinkMapEntries } from "@/shared/orderLink";
import { pmOrderStakeDisplayCny, pmOrderStakeDisplayUsdc } from "@/shared/pmOrderDisplay";
import { useOddsStore } from "@/stores/oddsStore";
import { useOrderStore } from "@/stores/orderStore";
import { canManualSellPmBuy } from "@/stores/account/pmManualSell";
import { gtcFinancialOrder } from "./gtc/financialOrder";
import { gtcProgress } from "./gtc/gtcProgressState";
import { gtcOrderDisplayGroups, gtcPendingDisplayRows, mergeGtcPendingDisplayEntries } from "./gtc/orderDisplayProjection";

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
async function render(rows: OrderRow[], selectedDate = date) {
  const pinia = createPinia(); setActivePinia(pinia);
  const orders = useOrderStore(); orders.orderDate = selectedDate; orders.orders = groupOrdersByEffectiveLink(rows);
  const pending = gtcPendingDisplayRows(rows, gtcProgress.records, selectedDate, 0);
  const entries = mergeGtcPendingDisplayEntries(orderLinkMapEntries(orders.orders), pending, gtcProgress.records);
  useOddsStore().save("Polymarket", { id: "token", odds: 2, clobPrice: 0.5, isLock: false, time: now });
  const before = JSON.stringify({ orders: orders.$state, executions: gtcProgress.records });
  const html = await renderToString(createSSRApp({ render: () => h(OrderList, { orderEntries: entries, allowPmSell: true, allowLinkRebind: true }, pending.length
    ? {
        "buy-amount": ({ row }: { row: OrderRow }) => row.PmGtcExecutionId && row.BetMoney == null ? "待核实" : toFixed(pmOrderStakeDisplayCny(row), 0),
      }
    : undefined) }).use(pinia));
  expect(JSON.stringify({ orders: orders.$state, executions: gtcProgress.records })).toBe(before);
  return html;
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
    expect(html).not.toContain("尚未入库的 GTC 挂单"); expect(useOrderStore().orders.size).toBe(0);
  });
  it("ordinary FOK rendering receives no GTC badge or details", async () => {
    const html = await render([{ ...row, PmGtcExecutionId: undefined }]);
    expect(html.match(/class="order"/g)).toHaveLength(1); expect(html).not.toContain("GTC");
  });
  it("shows an accepted zero-fill original and its cancel action even after orchestration closes", async () => {
    const pending = execution(); pending.plan.source = undefined; pending.plan.linkId = now;
    pending.matched = "0"; pending.principal = "0"; pending.open = "10"; pending.terminal = false;
    pending.order = { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] }; pending.fills = {};
    pending.decision = "closed"; pending.groupComplete = true; pending.manual = true;
    const ray: OrderRow = { OrderID: "ray", PmGtcExecutionId: pending.id, Type: "RAY", PlayerID: 2, Link: now, CreateAt: now, Status: "None", BetMoney: 100 };
    gtcProgress.records = [pending];
    const html = await render([ray]);
    expect(html).not.toContain("PM GTC 挂单"); expect(html).toContain("0 / 10 份"); expect(html).toContain("挂单中");
    expect(html.match(/class="order"/g)).toHaveLength(2);
    expect(html.match(/data-link-id=/g)).toHaveLength(1);
    expect(html).toContain("取消 PM 剩余挂单"); expect(html.match(/data-execution-id="id"/g)).toHaveLength(1);
    expect(useOrderStore().orders.get(now)).toEqual([ray]);
    expect(gtcOrderDisplayGroups([ray], [pending], "2026-10-09", 1)).toEqual([]);
    const stored = { ...row, Link: now, Status: "None" };
    expect(gtcOrderDisplayGroups([stored, ray], [pending], date, 0)[0]!.pending).toBeUndefined();
  });
  it("replaces the pending original inside the same Link after partial and full fills without duplicates", async () => {
    const pending = execution(); pending.plan.source = undefined; pending.plan.linkId = now;
    pending.matched = "0"; pending.principal = "0"; pending.open = "10"; pending.terminal = false;
    pending.order = { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] }; pending.fills = {};
    const ray: OrderRow = { OrderID: "ray", PmGtcExecutionId: pending.id, Type: "RAY", PlayerID: 2, Link: now, CreateAt: now, Status: "None", BetMoney: 100 };
    for (const shares of ["0", "4", "10"]) {
      const current = shares === "0"
        ? pending
        : mergeGtcFacts(pending, {
            order: { id: hash, original: "10", matched: shares, status: shares === "10" ? "MATCHED" : "LIVE", tradeIds: ["trade"] },
            fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares, price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: now }],
            complete: true,
            observedAt: now,
          });
      if (shares === "10") {
        current.released = true;
        gtcProgress.records = [current];
        const beforeListRefresh = await render([ray]);
        // 独立显示发布沿用已释放正成交历史的现有排除规则，不扩大其它 GTC 展示范围。
        expect(beforeListRefresh.match(/class="order"/g)).toHaveLength(1);
        expect(beforeListRefresh.match(/data-link-id=/g)).toHaveLength(1);
        expect(beforeListRefresh).not.toContain("全部成交");
        expect(gtcPendingDisplayRows([], [current], "2026-10-09", 0)).toEqual([]);
      }
      gtcProgress.records = [current];
      const stored = { ...row, Link: now, Status: "None" as const, PmShares: Number(shares), PmStakeUsdc: Number(shares) * 0.5, BetMoney: Number(shares) * 3.6 };
      const financial = shares === "0" ? [ray] : [ray, stored];
      const base = orderLinkMapEntries(groupOrdersByEffectiveLink(financial));
      const display = mergeGtcPendingDisplayEntries(base, gtcPendingDisplayRows(financial, [current], date, 0));
      expect(display).toHaveLength(1); expect(display[0]![0]).toBe(now);
      expect(display[0]![1].filter(r => r.Type === "Polymarket")).toHaveLength(1);
      const html = await render(financial);
      expect(html.match(/class="order"/g)).toHaveLength(2); expect(html.match(/data-link-id=/g)).toHaveLength(1);
      expect(html.match(/data-execution-id="id"/g)).toHaveLength(1);
      expect(html.includes("取消 PM 剩余挂单")).toBe(shares !== "10");
      expect(useOrderStore().orders.get(now)).toEqual(financial);
    }
  });
  it("keeps FOK groups untouched and deduplicates only the exact account and PM original", () => {
    const current = execution();
    const pending = gtcPendingDisplayRows([], [current], date, 0)[0]!;
    const fok = { ...row, OrderID: "fok", PmGtcExecutionId: undefined, Link: now + 1 };
    const entries: [number, OrderRow[]][] = [[now + 1, [fok]]];
    expect(mergeGtcPendingDisplayEntries(entries, [])).toBe(entries);
    const result = mergeGtcPendingDisplayEntries(entries, [pending, pending]);
    expect(result.find(([link]) => link === now + 1)![1]).toBe(entries[0]![1]);
    expect(result.find(([link]) => link === -now)![1]).toEqual([pending]);
    expect(entries).toEqual([[now + 1, [fok]]]);
    expect(gtcPendingDisplayRows([{ ...row, PmGtcExecutionId: undefined }], [current], date, 0)).toEqual([]);
    expect(gtcPendingDisplayRows([{ ...row, PlayerID: 2 }], [current], date, 0)).toHaveLength(1);
    expect(gtcPendingDisplayRows([], [current], date, 2)).toEqual([]);
    expect(gtcPendingDisplayRows([{ ...row, PmSide: "sell" }], [current], date, 1)).toHaveLength(1);
  });
  it("restores the monitor on an exact persisted original missing its GTC tag without changing FOK or source rows", async () => {
    const current = execution(); current.terminal = false; current.open = "6";
    const stored = { ...row, PmGtcExecutionId: undefined, Status: "None" as const };
    const fok = { ...stored, OrderID: "fok", Link: now + 1 };
    const base = orderLinkMapEntries(groupOrdersByEffectiveLink([stored, fok]));
    const display = mergeGtcPendingDisplayEntries(base, [], [current]);
    expect(display.find(([link]) => link === -now)![1][0]!.PmGtcExecutionId).toBe(current.id);
    expect(display.find(([link]) => link === now + 1)![1]).toBe(base.find(([link]) => link === now + 1)![1]);
    expect(stored.PmGtcExecutionId).toBeUndefined();
    gtcProgress.records = [current];
    const html = await render([stored, fok]);
    expect(html.match(/data-execution-id="id"/g)).toHaveLength(1);
    expect(html).toContain("取消 PM 剩余挂单");
    expect(html.match(/class="order"/g)).toHaveLength(2);
    expect(mergeGtcPendingDisplayEntries(base, [], [{ ...current, plan: { ...current.plan, playerId: 2 } }])).toBe(base);
    expect(mergeGtcPendingDisplayEntries(base, [], [{ ...current, orderId: "different" }]).find(([link]) => link === -now)![1][0]!.PmGtcExecutionId).toBe(current.id);
  });
  it("retains completed zero-fill originals on the Link home date when creation crosses midnight", () => {
    const current = execution(); current.createdAt = new Date("2026-10-11T00:00:01+08:00").getTime(); current.released = true;
    current.matched = "0"; current.principal = "0"; current.fills = {}; current.open = "0";
    current.order = { id: hash, original: "10", matched: "0", status: "CANCELED", tradeIds: [] };
    const pending = gtcPendingDisplayRows([], [current], date, 0);
    expect(pending).toHaveLength(1); expect(pending[0]!.Link).toBe(-now);
    expect(gtcPendingDisplayRows([], [current], "2026-10-11", 0)).toEqual([]);
  });
  it.each(["filled", "partially-filled-canceled", "open", "unknown"] as const)("keeps an unreleased %s original on its home date without recreating it on the next day", async (state) => {
    const current = execution(); current.plan.source = undefined; current.plan.linkId = now;
    current.manual = true; current.released = false; current.decision = "closed";
    if (state === "partially-filled-canceled") {
      current.plan.shares = "20";
      current.order = { ...current.order!, original: "20", status: "CANCELED" };
      current.open = "0";
    }
    if (state === "open" || state === "unknown") {
      current.matched = "0"; current.principal = "0"; current.fills = {};
      current.terminal = false; current.complete = false;
      current.open = state === "open" ? "10" : null;
      current.order = state === "open" ? { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] } : null;
      if (state === "unknown") { current.submit = "unknown"; current.orderId = null; }
    }
    gtcProgress.records = [current];
    const before = JSON.stringify(current);
    expect((await render([])).match(/class="order"/g)).toHaveLength(1);
    const nextDay = await render([], "2026-10-11");
    expect(nextDay).not.toContain('class="order"');
    expect(nextDay).not.toContain('data-execution-id="id"');
    expect(gtcPendingDisplayRows([], [current], "2026-10-09", 0)).toEqual([]);
    expect(JSON.stringify(current)).toBe(before);
    expect(useOrderStore().orders.size).toBe(0);
  });
  it.each([
    { Status: "Win" as const },
    { Status: "Lose" as const },
    { Status: "None" as const, PmSellState: "closed" as const, PmShares: 0, PmAttributedSellShares: 10 },
  ])("keeps the persisted original's financial state $Status instead of replacing it with a pending row", (financialState) => {
    const current = execution(); current.plan.source = undefined; current.manual = true; current.released = false;
    const stored = { ...row, ...financialState };
    const entries = orderLinkMapEntries(groupOrdersByEffectiveLink([stored]));
    const pending = gtcPendingDisplayRows([stored], [current], date, 0);
    expect(pending).toEqual([]);
    expect(mergeGtcPendingDisplayEntries(entries, pending, [current])).toBe(entries);
    expect(entries[0]![1][0]).toBe(stored);
    expect(gtcPendingDisplayRows([stored], [current], "2026-10-11", 0)).toEqual([]);
  });
  it("keeps canceled zero-fill originals in their Link group without a pending-settlement badge", async () => {
    const current = execution(); current.released = true; current.terminal = true; current.open = "0"; current.matched = "0"; current.principal = "0"; current.fills = {};
    current.order = { id: hash, original: "10", matched: "0", status: "CANCELED", tradeIds: [] };
    const pending = gtcPendingDisplayRows([], [current], date, 0);
    expect(pending).toHaveLength(1); expect(pending[0]!.Status).toBe("Return");
    gtcProgress.records = [current]; const html = await render([]);
    expect(html).toContain("余量已终止"); expect(html).not.toContain("盈亏：待结算"); expect(html).not.toContain("取消 PM 剩余挂单");
  });
  it("uses the original token for live quotes and keeps unpersisted display rows out of rebind and sell actions", async () => {
    const current = execution(); current.plan.tokenId = "token"; current.plan.conditionId = "condition";
    const pending = gtcPendingDisplayRows([], [current], date, 0)[0]!;
    expect(pending.PmTokenId).toBe("token"); expect(pending.PmConditionId).toBe("condition"); expect(isRebindableOrderRow(pending)).toBe(false);
    gtcProgress.records = [current]; const html = await render([]);
    expect(html).toContain("当前价：0.5"); expect(html).not.toContain("order__sell-btn");
    expect(isRebindableOrderRow(row)).toBe(true);
  });
  it("shows plain team names on originals whose match title contains HTML entities", () => {
    const current = execution(); current.plan.match = "Essences vs Nothin&apos;Here"; current.plan.item = "Away";
    expect(gtcPendingDisplayRows([], [current], date, 0)[0]!.Item).toBe("Nothin'Here");
    current.plan.item = "Nothin&#x27;Here";
    expect(gtcPendingDisplayRows([], [current], date, 0)[0]!.Item).toBe("Nothin'Here");
  });
  it("blocks selling and rebinding a display row even when the equivalent persisted position is sellable", async () => {
    const persisted = { ...row, Status: "None" as const, PmGtcExecutionId: undefined, PmTokenId: "token", PmOrigin: "changmen" as const };
    expect(canManualSellPmBuy(persisted)).toBe(true);
    const display = { ...persisted, DisplayOnly: true as const };
    const html = await render([display]);
    expect(html).not.toContain("order__sell-btn");
    expect(html).not.toContain("data-rebind-order-id=");
    expect(isRebindableOrderRow(display)).toBe(false);
    const ordinary = await render([persisted]);
    expect(ordinary).toContain("order__sell-btn");
    expect(ordinary).toContain("data-rebind-order-id=");
    expect(isRebindableOrderRow(persisted)).toBe(true);
  });
  it("does not guess a GTC controller for an original with conflicting execution identities", () => {
    const current = execution();
    const stored = { ...row, PmGtcExecutionId: undefined };
    const another = { ...current, id: "conflict" };
    const base = orderLinkMapEntries(groupOrdersByEffectiveLink([stored]));
    expect(gtcPendingDisplayRows([stored], [current, another], date, 0)).toEqual([]);
    expect(mergeGtcPendingDisplayEntries(base, [], [current, another])).toBe(base);
    expect(stored.PmGtcExecutionId).toBeUndefined();
  });
  it("keeps same-Link FOK and makeup rows intact when adding a zero-fill original", () => {
    const current = execution(); current.matched = "0"; current.fills = {}; current.terminal = false; current.open = "10";
    current.order = { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] };
    const fok = { ...row, PmGtcExecutionId: undefined, OrderID: "fok" };
    const makeup: OrderRow = { OrderID: "makeup-7", Link: -now, Type: "RAY", PlayerID: 2, Status: "Makeup", BetMoney: 50 };
    const base: [number, OrderRow[]][] = [[-now, [fok, makeup]]];
    const before = JSON.stringify(base);
    const result = mergeGtcPendingDisplayEntries(base, gtcPendingDisplayRows([fok], [current], date, 0), [current]);
    expect(result).toHaveLength(1); expect(result[0]![1]).toHaveLength(3);
    expect(result[0]![1][0]).toBe(fok); expect(result[0]![1][1]).toBe(makeup);
    expect(JSON.stringify(base)).toBe(before);
    expect(result[0]![1][2]!.DisplayOnly).toBe(true);
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
    filled.plan.tokenId = "token";
    gtcProgress.records = [filled];
    const pending = gtcOrderDisplayGroups([], [filled], date, 0)[0]!.pending!;
    expect(pending.BetMoney).toBeUndefined();
    expect(pending.PmStakeUsdc).toBeUndefined();
    expect(pending.PmFillPrice).toBe(0.78);
    const html = await render([]);
    expect(html).toMatch(/买入金额：\s*(?:<!--[\s\S]*?-->\s*)*待核实/);
    expect(html).not.toContain("手续费：");
    expect(html).toContain("盈亏待核实");
    expect(html).not.toContain("浮盈"); expect(html).not.toContain("浮亏");
  });
});
