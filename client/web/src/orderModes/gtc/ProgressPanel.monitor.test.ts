import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { gtcProgress } from "./gtcProgressState";
import { pmGtcMonitorCardView } from "./monitorCardView";
import { gtcOrderCardView } from "./orderCardView";
import ProgressPanel from "./ProgressPanel.vue";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), error: vi.fn(), cancel: vi.fn(), poll: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { error: mocks.error }, ElMessageBox: { confirm: mocks.confirm } }));
vi.mock("./runtime", () => ({ cancelGtc: mocks.cancel, pollGtc: mocks.poll }));
const hash = `0x${"a".repeat(64)}`;
function execution(): GtcExecution {
  const row = createGtcExecution("original", "owner", "wallet", "maker", { playerId: 1, shares: "10", price: "0.6", orderHash: hash } as GtcPlan, 1);
  row.pmAuthorized = true; row.submit = "accepted"; row.orderId = hash;
  return mergeGtcFacts(row, {
    order: { id: hash, original: "10", matched: "4", status: "LIVE", tradeIds: ["trade"] },
    fills: [{ key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "4", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1000 }],
    complete: true, observedAt: 1000,
  });
}
async function panel(row = execution(), readOnly = false) {
  let cancel!: () => Promise<void>;
  const component = { ...ProgressPanel, setup(props: Parameters<NonNullable<typeof ProgressPanel.setup>>[0], context: Parameters<NonNullable<typeof ProgressPanel.setup>>[1]) {
    const result = ProgressPanel.setup!(props, context);
    cancel = (result as unknown as { cancel: () => Promise<void> }).cancel;
    return result;
  } } as typeof ProgressPanel;
  const html = await renderToString(createSSRApp({ render: () => h(component, { execution: row, readOnly }) }));
  return { html, cancel };
}
beforeEach(() => {
  vi.clearAllMocks(); gtcProgress.owner = "owner"; gtcProgress.records = [];
  gtcProgress.queryIssues = {}; gtcProgress.otherQueryIssues = {}; gtcProgress.recoveredAt = 0;
  mocks.confirm.mockResolvedValue("confirm"); mocks.cancel.mockResolvedValue(undefined);
});
afterEach(() => { gtcProgress.owner = ""; gtcProgress.queryIssues = {}; gtcProgress.otherQueryIssues = {}; });

it("renders the local monitor layout from existing facts without queries, commands or mutations", async () => {
  const row = execution(); const before = JSON.stringify(row);
  const { html } = await panel(row);
  expect(html).toContain('aria-label="PM GTC 订单监控"');
  expect(html).toMatch(/<dt[^>]*>成交<\/dt><dd[^>]*>4 \/ 10 份<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>挂单<\/dt><dd[^>]*>6 份<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>TAKER<\/dt><dd[^>]*>0 份<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>MAKER<\/dt><dd[^>]*>4 份<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>均价<\/dt><dd[^>]*>0\.5<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>限价<\/dt><dd[^>]*>0\.6<\/dd>/);
  expect(html).toContain("核对"); expect(html).toContain("取消 PM 剩余挂单");
  expect(html).not.toContain("GTC 详情"); expect(html).not.toContain(hash);
  expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  expect(mocks.poll).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  expect(gtcProgress.records).toEqual([]); expect(JSON.stringify(row)).toBe(before);
});
it("shows zero fills without fabricating an average execution price", async () => {
  const row = execution(); row.matched = "0"; row.principal = "0"; row.open = "10";
  row.order!.matched = "0"; row.order!.tradeIds = []; row.fills = {};
  const { html } = await panel(row);
  expect(html).toMatch(/<dt[^>]*>均价<\/dt><dd[^>]*>—<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>TAKER<\/dt><dd[^>]*>0 份<\/dd>/);
  expect(pmGtcMonitorCardView(row).averagePrice).toBeNull();
});
it("uses exact role quantities and excludes failed fills from the displayed execution mix", () => {
  const row = execution(); row.matched = "0.300001"; row.principal = "0.1500005";
  row.order!.matched = row.matched;
  row.fills = {
    maker: { ...row.fills.trade!, key: "maker", shares: "0.1" },
    taker: { ...row.fills.trade!, key: "taker", role: "TAKER", shares: "0.200001" },
    failed: { ...row.fills.trade!, key: "failed", shares: "9", status: "FAILED" },
  };
  expect(pmGtcMonitorCardView(row)).toMatchObject({ makerShares: "0.1", takerShares: "0.200001", averagePrice: "0.5" });
});
it.each(["missing fills", "order mismatch", "detail mismatch"])("shows unknown roles and average for %s without changing confirmed facts", (kind) => {
  const row = execution();
  if (kind === "missing fills") row.fills = {};
  else if (kind === "order mismatch") row.order!.matched = "5";
  else row.fills.trade!.shares = "3";
  const before = JSON.stringify(row);
  expect(pmGtcMonitorCardView(row)).toMatchObject({ averagePrice: null, takerShares: null, makerShares: null });
  expect(JSON.stringify(row)).toBe(before);
});
it("keeps an execution average separate from unknown fees and the limit price", () => {
  const row = execution(); row.plan.price = "0.9"; row.fills.trade!.role = "TAKER"; row.fills.trade!.fee = null;
  expect(pmGtcMonitorCardView(row)).toMatchObject({ averagePrice: "0.5", fee: null, state: "部分成交", takerShares: "4" });
});
it("retains terminal status and reconciliation evidence while hiding cancellation", async () => {
  const row = execution(); row.terminal = true; row.open = "0"; row.order!.status = "CANCELED";
  const { html } = await panel(row);
  expect(html).toContain("核对完成"); expect(html).toContain("部分成交 · 余量已终止");
  expect(html).toContain("已停止挂单查询"); expect(html).not.toContain('class="pm-gtc-monitor__cancel"');
  expect(mocks.poll).not.toHaveBeenCalled();
});
it.each(["prepared", "rejected", "delayed", "zero open", "dispatching", "requested", "unknown", "acknowledged"])("retains the published cancellation qualification for %s", async (kind) => {
  const row = execution();
  if (kind === "prepared") { row.submit = "prepared"; row.orderId = null; row.pmAuthorized = false; }
  else if (kind === "rejected") row.submit = "rejected";
  else if (kind === "delayed") row.order!.status = "DELAYED";
  else if (kind === "zero open") row.open = "0";
  else row.cancel = { commandId: "cancel", state: kind as NonNullable<GtcExecution["cancel"]>["state"], message: "已有撤单核对" };
  const old = gtcOrderCardView(row);
  const view = pmGtcMonitorCardView(row);
  expect(view.showCancel).toBe(old.showCancel); expect(view.canCancel).toBe(old.canCancel); expect(view.state).toBe(old.state);
  const { html } = await panel(row);
  expect(html.includes('class="pm-gtc-monitor__cancel"')).toBe(old.showCancel);
  if (old.showCancel) expect(/<button[^>]* disabled/.test(html)).toBe(!old.canCancel);
  if (row.cancel) expect(html).toContain(row.cancel.message);
});
it("retains the read-only button guard even for an otherwise cancellable original", async () => {
  const { html } = await panel(execution(), true);
  expect(html).toMatch(/<button[^>]*class="pm-gtc-monitor__cancel"[^>]* disabled/);
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("uses the published command, confirmation and exact original ID when cancellation is requested", async () => {
  const p = await panel(); await p.cancel();
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("只取消这笔 PM 原挂单的剩余份额。已成交部分保留，本组继续由您处理。", "取消PM挂单", { type: "warning" });
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("original"); expect(mocks.poll).not.toHaveBeenCalled();
});
it("keeps confirmation dismissal and command failures isolated from monitoring facts", async () => {
  const row = execution(); const before = JSON.stringify(row); const p = await panel(row);
  mocks.confirm.mockRejectedValueOnce("cancel"); await p.cancel(); expect(mocks.cancel).not.toHaveBeenCalled();
  mocks.cancel.mockRejectedValueOnce(new Error("撤单服务暂时不可用")); await p.cancel();
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith("撤单服务暂时不可用"); expect(JSON.stringify(row)).toBe(before);
});
it("keeps PM and other-leg synchronization failures visible without turning them into rejection", async () => {
  const row = execution(); row.plan.otherProvider = "RAY";
  gtcProgress.queryIssues.original = { kind: "auth", message: "登录服务暂时不可用", at: 3000 };
  gtcProgress.otherQueryIssues.original = { kind: "query", message: "Network Error", at: 3000 };
  let html = (await panel(row)).html;
  expect(html).toContain("同步暂停"); expect(html).toContain("部分成交"); expect(html).toContain("RAY 同步提示");
  expect(html).toContain("Network Error"); expect(html).not.toContain("明确拒单");
  delete gtcProgress.queryIssues.original;
  html = (await panel(row)).html; expect(html).not.toContain("同步暂停"); expect(html).toContain("Network Error");
  delete gtcProgress.otherQueryIssues.original;
  expect((await panel(row)).html).not.toContain("Network Error");
});
