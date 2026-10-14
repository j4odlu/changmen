import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { Ref } from "vue";
import { createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h, reactive } from "vue";
import { gtcProgress } from "./gtcProgressState";
import { pmGtcMonitorCardView } from "./monitorCardView";
import ProgressPanel from "./ProgressPanel.vue";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), error: vi.fn(), cancel: vi.fn(), poll: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { error: mocks.error }, ElMessageBox: { confirm: mocks.confirm } }));
vi.mock("@/runtime/gtcOrderMonitor/pm", () => ({ cancelGtc: mocks.cancel, pollGtc: mocks.poll }));
const hash = `0x${"a".repeat(64)}`;
function execution(): GtcExecution {
  const row = createGtcExecution("original", "owner", "wallet", "maker", { playerId: 1, shares: "10", price: "0.6", orderHash: hash } as GtcPlan, 1);
  row.pmAuthorized = true; row.submit = "accepted"; row.orderId = hash;
  return mergeGtcFacts(row, {
    order: { id: hash, original: "10", matched: "4", status: "LIVE", tradeIds: ["trade"] },
    fills: [{ key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "4", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1000 }],
    complete: true,
    observedAt: 1000,
  });
}

interface PanelState { cancelBusy: Ref<boolean>; cancel: () => Promise<void> }
// Render the real SSR template and exercise its action handler with a mocked PM command.
async function panel(initial = execution()) {
  const row = reactive(initial); let state!: PanelState;
  const component = { ...ProgressPanel, setup(props: Parameters<NonNullable<typeof ProgressPanel.setup>>[0], context: Parameters<NonNullable<typeof ProgressPanel.setup>>[1]) {
    const result = ProgressPanel.setup!(props, context);
    state = result as unknown as PanelState;
    return result;
  } } as typeof ProgressPanel;
  const html = await renderToString(createSSRApp({ render: () => h(component, { execution: row }) }));
  return { html, row, state };
}
beforeEach(() => { vi.clearAllMocks(); gtcProgress.owner = "owner"; gtcProgress.queryIssues = {}; gtcProgress.otherQueryIssues = {}; mocks.confirm.mockResolvedValue("confirm"); mocks.cancel.mockResolvedValue(undefined); });
afterEach(() => { gtcProgress.owner = ""; });

it("shows compact latest facts and the cancel action without expandable details or starting queries", async () => {
  const p = await panel();
  expect(p.html).toContain("PM GTC 订单监控"); expect(p.html).toContain("4 / 10 份"); expect(p.html).toContain("6 份");
  expect(p.html).toMatch(/<dd[^>]*>0\.5<\/dd>/); expect(p.html).toContain("取消 PM 剩余挂单");
  expect(p.html).not.toContain(hash); expect(p.html).not.toContain("成交本金"); expect(p.html).not.toContain("成交费用");
  expect(p.html).not.toContain("aria-expanded"); expect(p.html).not.toContain("GTC 详情"); expect(p.html).not.toContain("成交明细");
  expect(mocks.poll).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  const updated = execution(); updated.open = "5"; updated.observedAt = 2000;
  expect((await panel(updated)).html).toContain("5 份");
  expect(mocks.poll).not.toHaveBeenCalled();
});
it("retains a compact completed snapshot and hides cancellation for terminal orders", async () => {
  const completed = execution(); completed.terminal = true; completed.open = "0"; completed.order!.status = "CANCELED";
  const p = await panel(completed);
  expect(p.html).toContain("核对完成"); expect(p.html).toContain("部分成交 · 剩余挂单已取消");
  expect(p.html).toContain("已停止挂单查询"); expect(p.html).not.toContain("pm-gtc-monitor__cancel"); expect(mocks.poll).not.toHaveBeenCalled();
});
it("uses only the existing cancellation command for this exact original and blocks concurrent clicks", async () => {
  let release!: () => void; mocks.cancel.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const p = await panel();
  const request = p.state.cancel();
  await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("original"));
  expect(p.state.cancelBusy.value).toBe(true); await p.state.cancel(); expect(mocks.cancel).toHaveBeenCalledTimes(1);
  release(); await request; expect(p.state.cancelBusy.value).toBe(false); expect(mocks.poll).not.toHaveBeenCalled();
});
it("does not send a cancel after dismissal, owner switch, or a terminal update during confirmation", async () => {
  const p = await panel(); mocks.confirm.mockRejectedValueOnce("cancel"); await p.state.cancel(); expect(mocks.cancel).not.toHaveBeenCalled();
  mocks.confirm.mockImplementationOnce(async () => { gtcProgress.owner = "other-owner"; });
  await p.state.cancel(); expect(mocks.cancel).not.toHaveBeenCalled();
  gtcProgress.owner = "owner";
  mocks.confirm.mockImplementationOnce(async () => { p.row.terminal = true; p.row.open = "0"; });
  await p.state.cancel(); expect(mocks.cancel).not.toHaveBeenCalled();
});
it("allows retrying an unknown cancellation while keeping its verification notice", async () => {
  const row = execution(); row.cancel = { commandId: "cancel", state: "unknown", message: "结果待核实" };
  const p = await panel(row);
  expect(p.html).toContain("取消结果待核实"); expect(p.html).toContain("重试取消 PM 剩余挂单");
  expect(p.html).not.toMatch(/<button[^>]*class="pm-gtc-monitor__cancel"[^>]* disabled/); await p.state.cancel();
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("original");
});
it("keeps PM monitoring and order facts independent of RAY errors and unavailable fee facts", () => {
  const row = execution(); row.plan.price = "0.9"; row.fills.trade!.fee = null; row.fills.trade!.role = "TAKER";
  const view = pmGtcMonitorCardView(row, { kind: "query", message: "Network Error", at: 3000 });
  expect(view).toMatchObject({ state: "部分成交", averagePrice: "0.5", fee: null, monitorLabel: "监控重试中" });
  row.fills = {};
  expect(pmGtcMonitorCardView(row).averagePrice).toBeNull();
});
