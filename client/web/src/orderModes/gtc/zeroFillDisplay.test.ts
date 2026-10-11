import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { useOrderStore } from "@/stores/orderStore";
import { gtcFinancialOrder } from "./financialOrder";
import { gtcProgress } from "./gtcProgressState";
import { gtcOrderDisplayGroups } from "./orderDisplayProjection";
import PendingOrders from "./PendingOrders.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
const date = "2026-10-10";
const now = new Date(`${date}T10:00:00+08:00`).getTime();
const hash = `0x${"b".repeat(64)}`;
const plan = { source: "manual", playerId: 1, shares: "10", price: "0.5", orderHash: hash,
  match: "zero fill match", bet: "全场独赢", item: "Home", linkId: -now, originalPmLeg: "A" } as GtcPlan;

function acceptedZero(status = "CANCELED", source: "manual" | "arb" = "manual"): GtcExecution {
  const created = createGtcExecution("zero", "owner", "wallet", "maker", { ...plan, source: source === "manual" ? "manual" : undefined }, now);
  const accepted = applyGtcCommand(applyGtcCommand(created, { kind: "authorize_pm" }, now),
    { kind: "ack", state: "accepted", orderId: hash }, now);
  const closed = applyGtcCommand(accepted, { kind: "close" }, now);
  return mergeGtcFacts(closed, { order: { id: hash, original: "10", matched: "0", status, tradeIds: [] },
    fills: [], complete: true, observedAt: now });
}

async function render(executions: GtcExecution[], rows: OrderRow[] = [], accountId = 0, selectedDate = date) {
  const pinia = createPinia(); setActivePinia(pinia);
  const orders = useOrderStore(); orders.orderDate = selectedDate;
  orders.orders = new Map(rows.length ? [[-now, rows]] : []);
  gtcProgress.records = executions;
  const before = JSON.stringify({ orders: [...orders.orders], executions });
  const html = await renderToString(createSSRApp({ render: () => h(PendingOrders, { date: selectedDate, accountId }) }).use(pinia));
  expect(JSON.stringify({ orders: [...orders.orders], executions })).toBe(before);
  return html;
}

beforeEach(() => { gtcProgress.owner = "owner"; gtcProgress.records = []; gtcProgress.error = ""; });

describe("[changmen 扩展] zero-fill GTC display without financial persistence", () => {
  it.each(["CANCELED", "CANCELLED", "EXPIRED"])("keeps an accepted %s zero-fill original visible after release", async (status) => {
    const record = acceptedZero(status);
    expect(record.released).toBe(true);
    expect(gtcFinancialOrder(record)).toBeUndefined();
    const html = await render([record]);
    expect(html.match(/class="order"/g)).toHaveLength(1);
    expect(html).toContain("成交：0 / 10 份");
    expect(html).toContain("余量已终止");
    expect(html).toMatch(/买入金额：\s*(?:<!--[\s\S]*?-->\s*)*0/);
    expect(html).not.toContain("取消PM挂单");
    expect(html).not.toContain("卖出</");
    expect(useOrderStore().orders.size).toBe(0);
    const pending = gtcOrderDisplayGroups([], [record], date, 0)[0]!.pending!;
    expect(pending).toMatchObject({ Status: "Return", PmShares: 0, BetMoney: 0, PmStakeUsdc: 0, PmFeeUsdc: 0 });
    expect(pending.PmFillPrice).toBeUndefined();
    expect(pending.Odds).toBeUndefined();
  });

  it("also retains an already released arbitrage zero-fill original without changing its controls", async () => {
    const record = { ...acceptedZero("CANCELED", "arb"), released: true };
    const html = await render([record]);
    expect(html).toContain("GTC · 套利");
    expect(html).toContain("成交：0 / 10 份");
  });

  it("preserves active zero-fill visibility across the old date filter and its cancel action", async () => {
    const record = acceptedZero("LIVE");
    expect(record.released).toBe(false);
    const html = await render([record], [], 0, "2026-10-11");
    expect(html).toContain("挂单中");
    expect(html).toContain("取消PM挂单");
    expect(gtcOrderDisplayGroups([], [record], date, 0)[0]!.pending!.Status).toBe("None");
  });

  it("filters released history by Link date and account", async () => {
    const record = acceptedZero();
    expect(await render([record], [], 0, "2026-10-11")).not.toContain('class="order"');
    expect(await render([record], [], 2)).not.toContain('class="order"');
    expect(await render([record], [], 1)).toContain('class="order"');
    // Original Link day wins over a later execution timestamp, as for existing financial orders.
    expect(await render([{ ...record, createdAt: now + 86400000 }])).toContain('class="order"');
  });

  it("does not duplicate the exact original once a financial row exists", async () => {
    const record = acceptedZero();
    const stored: OrderRow = { OrderID: hash.toUpperCase(), PmGtcExecutionId: record.id, Type: "Polymarket",
      PlayerID: 1, Link: -now, CreateAt: now, PmSide: "buy", Status: "Return", BetMoney: 0 };
    expect(await render([record], [stored])).not.toContain('class="order"');
    expect(gtcOrderDisplayGroups([stored], [record], date, 0)[0]!.pending).toBeUndefined();
  });

  it("does not treat a different original with the same Link or a sell row as the original", async () => {
    const record = acceptedZero();
    const another: OrderRow = { OrderID: "different", PmGtcExecutionId: record.id, Type: "Polymarket",
      PlayerID: 1, Link: -now, CreateAt: now, PmSide: "buy" };
    expect(await render([record], [another])).toContain('class="order"');
    expect(await render([record], [{ ...another, OrderID: hash, PmSide: "sell" }])).toContain('class="order"');
  });

  it("does not broaden released positive-fill history or change FOK financial rows", () => {
    const positive = { ...acceptedZero(), matched: "1" };
    const fok: OrderRow = { OrderID: "fok", Type: "Polymarket", PlayerID: 1, Link: -now, CreateAt: now,
      PmSide: "buy", BetMoney: 36, Status: "None" };
    const before = JSON.stringify(fok);
    expect(gtcOrderDisplayGroups([fok], [positive], date, 0)).toEqual([]);
    expect(JSON.stringify(fok)).toBe(before);
  });

  it("keeps unsubmitted and explicitly rejected released executions excluded", async () => {
    const unsubmitted = applyGtcCommand(createGtcExecution("not-sent", "owner", "wallet", "maker", plan, now), { kind: "close" }, now);
    const rejected = { ...acceptedZero(), submit: "rejected" as const };
    expect(await render([unsubmitted, rejected])).not.toContain('class="order"');
  });

  it("keeps unreleased rejection and uncertain-submit displays unchanged", async () => {
    const base = acceptedZero();
    for (const submit of ["rejected", "unknown"] as const) {
      const record = { ...base, released: false, submit };
      const html = await render([record]);
      expect(html).toContain('class="order"');
      expect(gtcOrderDisplayGroups([], [record], date, 0)[0]!.pending!.Status).toBe(submit === "rejected" ? "Reject" : "None");
    }
  });
});
