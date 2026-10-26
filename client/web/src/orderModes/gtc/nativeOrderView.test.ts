import type { Ref } from "vue";
import type { OrderRow } from "@/types/order";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h, reactive } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { createGtcOrderRecord, applyGtcOrderCommand } from "./core/orderRecord";
import { gtcOrders } from "./orderState";
import { nativeGtcPendingRows } from "./orderDisplay";
import { mergeGtcPendingDisplayEntries } from "./orderDisplayProjection";
import { toOrderDateKeyLocal } from "@/shared/orderLink";
import ProgressPanel from "./ProgressPanel.vue";
import OrderDetails from "./OrderDetails.vue";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), error: vi.fn(), cancel: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { error: mocks.error }, ElMessageBox: { confirm: mocks.confirm } }));
vi.mock("./orders", () => ({ cancelGtcOrder: mocks.cancel }));
const hash = `0x${"a".repeat(64)}`;
function order() {
  let row = createGtcOrderRecord("original", "owner", 1, "maker", { tokenId: "token", conditionId: "condition", shares: "10", targetShares: "10", price: "0.5",
    maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: hash }, { match: "M", bet: "B", item: "YES" }, Date.now());
  row = applyGtcOrderCommand(row, { kind: "authorize" });
  row = applyGtcOrderCommand(row, { kind: "receipt", receipt: { success: true, orderID: hash } });
  return applyGtcOrderCommand(row, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "3", status: "LIVE", tradeIds: ["trade"] },
    fills: [{ key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }], complete: true, observedAt: 1 } });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.confirm.mockResolvedValue("confirm"); mocks.cancel.mockResolvedValue(undefined);
  gtcOrders.owner = "owner"; gtcOrders.records = []; gtcOrders.queryIssues = {}; gtcOrders.saveIssues = {}; gtcOrders.resultIssues = {}; gtcOrders.cancelInFlight = {};
});
it("renders the native record and cancels that same order without constructing a paired plan", async () => {
  const row = reactive(order()); let state!: { cancel: () => Promise<void>; cancelBusy: Ref<boolean> };
  const component = { ...ProgressPanel, setup(props: Parameters<NonNullable<typeof ProgressPanel.setup>>[0], context: Parameters<NonNullable<typeof ProgressPanel.setup>>[1]) {
    const result = ProgressPanel.setup!(props, context); state = result as unknown as typeof state; return result;
  } } as typeof ProgressPanel;
  const html = await renderToString(createSSRApp({ render: () => h(component, { execution: row }) }));
  expect(html).toContain("3 / 10 份"); expect(html).toContain("7 份"); expect(html).toContain("GTC · 订单");
  await state.cancel(); expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("original");
  expect(row.plan).not.toHaveProperty("otherProvider"); expect(row).not.toHaveProperty("other");
});
it("native original details stay read-only in admin/historical preview", async () => {
  const row = order(); gtcOrders.records = [row];
  const display = { Type: "Polymarket", PlayerID: 1, OrderID: hash, PmGtcExecutionId: row.id } as OrderRow;
  const html = await renderToString(createSSRApp({ render: () => h(OrderDetails, { row: display, readonly: true }) }));
  expect(html).not.toContain("取消 PM 剩余挂单"); expect(mocks.cancel).not.toHaveBeenCalled();
});
it("merges only a missing native display row, preserving all FOK rows and the original empty-case references", () => {
  const native = order(); const fok: OrderRow = { OrderID: "fok", Type: "Polymarket", PlayerID: 1, Link: 12, BetMoney: 100 };
  const entries: [number, OrderRow[]][] = [[12, [fok]]];
  expect(mergeGtcPendingDisplayEntries(entries, [], [])).toBe(entries);
  const rows = nativeGtcPendingRows([fok], [native], toOrderDateKeyLocal(Date.now()), 0);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ PmOrderType: "GTC", DisplayOnly: true, PmGtcExecutionId: native.id });
  const merged = mergeGtcPendingDisplayEntries(entries, rows);
  expect(merged.find(([link]) => link === 12)![1]).toBe(entries[0]![1]); expect(fok).not.toHaveProperty("PmGtcExecutionId");
  expect(nativeGtcPendingRows([...rows], [native], toOrderDateKeyLocal(Date.now()), 0)).toEqual([]);
});
it("unknown fees never become a zero-fee stake or a fabricated full fill in pending display", () => {
  const row = order(); row.fills.trade!.role = "TAKER"; row.fills.trade!.fee = null; row.fee = null; row.complete = false; row.error = "成交费用待核实";
  const pending = nativeGtcPendingRows([], [row], toOrderDateKeyLocal(Date.now()), 0)[0]!;
  expect(pending.PmShares).toBe(3); expect(pending.BetMoney).toBeUndefined(); expect(pending.PmStakeUsdc).toBeUndefined();
});
it("keeps the existing plain-text item display for escaped team names", () => {
  const row = order(); row.context.item = "A &amp; B";
  expect(nativeGtcPendingRows([], [row], toOrderDateKeyLocal(Date.now()), 0)[0]!.Item).toBe("A & B");
});
