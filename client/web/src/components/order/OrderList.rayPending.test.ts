import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { rayProvider, resetRayNativeOrderDisplay } from "@changmen/venue-browser/adapter/ray/bet";
import { PlatformAccount } from "@/models/platformAccount";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { resetRayMonitoring, setRayMonitoring } from "@/runtime/orderMonitoring/rayState";
import type { OrderRow } from "@/types/order";
import OrderList from "./OrderList.vue";
import RayLinkMonitorCard from "./RayLinkMonitorCard.vue";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/ray/accountHttp", () => ({ accountGet: mocks.get, accountPostForm: vi.fn() }));
const created = Date.parse("2026-11-10T12:00:00+08:00");
const nativeRow = { order_number: "original", status: 0, live: 1, create_time: "2026-11-10 12:00:00",
  detail: [{ title: "winner\nAway", odds: 2, stake: 100, risk: 0, win: -1 }] };
beforeEach(() => { vi.clearAllMocks(); resetRayNativeOrderDisplay(); resetRayMonitoring(); vi.useFakeTimers(); vi.setSystemTime(created + 30_000); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const pinia = createPinia(); setActivePinia(pinia);
  const accounts = useAccountStore(), user = useUserStore();
  user.userId = 1; vi.spyOn(user, "isLoggedIn", "get").mockReturnValue(true);
  accounts.accounts = [new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" })];
  const account = accounts.accounts[0]!;
  mocks.get.mockResolvedValue({ code: 200, time: new Date(created + 30_000).toISOString(), result: [nativeRow] });
  const venueOrders = await rayProvider.getOrders!(account);
  expect(venueOrders[0]?.status).toBe("none");
  expect(JSON.stringify(venueOrders)).not.toMatch(/Pending|live|risk|create_time/);
  const row: OrderRow = { Type: "RAY", PlayerID: 2, OrderID: "original", Link: 10, Status: "None", BetMoney: 100, Odds: 2, Money: 0 };
  const render = () => renderToString(createSSRApp(OrderList, { orderEntries: [[10, [row]]] }).use(pinia));
  const card = (monitor?: never) => renderToString(createSSRApp(RayLinkMonitorCard, { rows: [row], monitor }).use(pinia));
  return { row, render, card, account };
}
it("renders H5 Pending through 35s and unsettled at 36s without changing the stored order", async () => {
  const { row, render } = await setup();
  expect(await render()).toContain('class="status RayPending"');
  expect(await render()).toContain("盈亏：待确认");
  vi.advanceTimersByTime(5000);
  expect(await render()).toContain('class="status RayPending"');
  vi.advanceTimersByTime(1000);
  expect(await render()).toContain('class="status None"');
  expect(await render()).toContain("盈亏：待结算");
  expect(row.Status).toBe("None");
  expect(mocks.get).toHaveBeenCalledOnce();
});
it("existing monitoring and a stored rejection can still replace Pending", async () => {
  const { row, render } = await setup();
  setRayMonitoring("1", 2, "original", { phase: "closed", status: "reject" });
  expect(await render()).toContain('class="status Reject"');
  resetRayMonitoring(); row.Status = "Reject";
  expect(await render()).toContain('class="status Reject"');
});
it("preserves the monitor card workflow and an explicit refusal", async () => {
  const { card } = await setup();
  expect(await card()).toContain("等待恢复监控");
  const html = await card({ status: "rejected", boundOrderId: "original", rejectDelayMs: 30_000, updatedAt: created + 30_000 } as never);
  expect(html).toContain("延迟拒单已发现");
  expect(html).not.toContain("待确认");
});
it.each([["win", "Win"], ["lose", "Lose"], ["return", "Return"], ["reject", "Reject"]])("hides a closed %s monitor while retaining the order's result badge", async (status, badge) => {
  const { row, render, card } = await setup();
  const before = JSON.stringify(row);
  setRayMonitoring("1", 2, "original", { phase: "closed", status });
  const context = status === "reject" ? { status: "rejected", boundOrderId: "original", autoMakeupStatus: "enqueued", rejectDelayMs: 30_000 } : undefined;
  const html = await card(context as never);
  expect(html).not.toContain("ray-link-monitor");
  expect(html).not.toContain("监控已结束");
  expect(await render()).toContain(`class="status ${badge}"`);
  expect(JSON.stringify(row)).toBe(before);
  expect(mocks.get).toHaveBeenCalledOnce();
});
it("hides an explicitly closed context without independent monitoring, but keeps a current watcher over an old closed context", async () => {
  const { row, card } = await setup();
  const context = Object.freeze({ status: "closed", boundOrderId: "original", updatedAt: created + 30_000 });
  expect(await card(context as never)).not.toContain("ray-link-monitor");
  setRayMonitoring("1", 2, "original", { phase: "watching", status: "none" });
  expect(await card(context as never)).toContain("持续监控中");
  expect(row.Status).toBe("None");
  expect(context.status).toBe("closed");
});
it("keeps waiting/retrying monitors visible and hides them only after an explicit close", async () => {
  const { row, card } = await setup();
  expect(await card()).toContain("等待恢复监控");
  setRayMonitoring("1", 2, "original", { phase: "watching", status: "none", error: "场馆本次未返回该原单，继续查询" });
  expect(await card()).toContain("监控重试中");
  setRayMonitoring("1", 2, "original", { phase: "watching", status: "none" });
  expect(await card()).toContain("持续监控中");
  setRayMonitoring("1", 2, "original", { phase: "closed", status: "win" });
  expect(await card()).not.toContain("ray-link-monitor");
  expect(row.Status).toBe("None");
  expect(mocks.get).toHaveBeenCalledOnce();
});
it("does not label a local preview or monitor Pending as native Pending when venue facts are missing", async () => {
  const { row, render } = await setup();
  resetRayNativeOrderDisplay();
  row.DisplayOnly = true; row.Status = "RayConfirming";
  setRayMonitoring("1", 2, "original", { phase: "watching", status: "pending" });
  const html = await render();
  expect(html).toContain('class="status RayConfirming"');
  expect(html).not.toContain("RayPending");
  expect(html).not.toContain("待确认");
  expect(row.Status).toBe("RayConfirming");
  expect(mocks.get).toHaveBeenCalledOnce();
});
it("a local preview follows native Open instead of remaining Pending", async () => {
  const { row, render } = await setup();
  row.DisplayOnly = true; row.Status = "RayConfirming";
  expect(await render()).toContain('class="status RayPending"');
  vi.advanceTimersByTime(6000);
  const html = await render();
  expect(html).toContain('class="status None"');
  expect(html).not.toContain("RayPending");
  expect(row.Status).toBe("RayConfirming");
  expect(mocks.get).toHaveBeenCalledOnce();
});
it("native pre-match risk fields retain Pending beyond 35s and clear it only when the risk result changes", async () => {
  const { row, render, account } = await setup();
  row.DisplayOnly = true; row.Status = "RayConfirming";
  vi.setSystemTime(created + 60_000);
  const riskRow = { ...nativeRow, live: 0, detail: [{ ...nativeRow.detail[0], risk: 2, win: -1 }] };
  mocks.get.mockResolvedValue({ code: 200, time: new Date(created + 60_000).toISOString(), result: [riskRow] });
  await rayProvider.getOrders!(account);
  expect(await render()).toContain('class="status RayPending"');
  mocks.get.mockResolvedValue({ code: 200, time: new Date(created + 60_000).toISOString(),
    result: [{ ...riskRow, detail: [{ ...riskRow.detail[0], win: 0 }] }] });
  await rayProvider.getOrders!(account);
  expect(await render()).toContain('class="status None"');
  expect(row.Status).toBe("RayConfirming");
});
it.each([[2, "Reject", "拒单"], [0, "Return", "退回"]])("H5 detail cancellation with risk %s changes only UI, including the monitor's venue status", async (risk, badge, label) => {
  const { row, render, card, account } = await setup();
  setRayMonitoring("1", 2, "original", { phase: "watching", status: "none" });
  vi.setSystemTime(created + 60_000);
  mocks.get.mockResolvedValue({ code: 200, time: new Date(created + 60_000).toISOString(), result: [{
    ...nativeRow, detail: [{ ...nativeRow.detail[0], risk, win: 99 }],
  }] });
  const orders = await rayProvider.getOrders!(account);
  expect(orders[0]?.status).toBe("none");
  const html = await render();
  expect(html).toContain(`class="status ${badge}"`);
  expect(html).toContain(`盈亏：${label}`);
  expect(html).not.toContain("盈亏：待结算");
  const monitorHtml = await card();
  expect(monitorHtml).toContain("持续监控中");
  expect(monitorHtml).not.toContain("延迟拒单已发现");
  expect(row.Status).toBe("None");
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
it("H5 distinguishes returned from the unchanged raw-status-4 reject business mapping", async () => {
  const { row, render, account } = await setup();
  vi.setSystemTime(created + 60_000);
  mocks.get.mockResolvedValue({ code: 200, time: new Date(created + 60_000).toISOString(), result: [{
    ...nativeRow, status: 4, live: 0, detail: [{ ...nativeRow.detail[0], risk: 0, win: 99 }],
  }] });
  const orders = await rayProvider.getOrders!(account);
  expect(orders[0]?.status).toBe("reject");
  row.Status = "Reject";
  setRayMonitoring("1", 2, "original", { phase: "closed", status: "reject" });
  expect(await render()).toContain('class="status Return"');
  expect(row.Status).toBe("Reject");
});
