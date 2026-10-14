import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./rayLifecycle";
const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), save: vi.fn(), reject: vi.fn(), makeup: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => true }));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save }));
vi.mock("@/runtime/rayOrderMonitor/api", () => ({ loadRayMonitorOrders: mocks.load, saveRayMonitorOrders: mocks.save }));
vi.mock("@/runtime/orderPolling/ray", () => ({ readRayAccountOrders: mocks.read, resetRayOrderPolling: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner" }) }));
const account = { accountId: 2, provider: "RAY", active: false };
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: [account], findAccount: () => account }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: new Map(), fetchOrders: vi.fn(async () => true) }) }));
vi.mock("@/runtime/rayOrderMonitor/autoMakeup", () => ({ handleRayLateRejectAutoMakeup: mocks.makeup }));
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
beforeEach(() => {
  setActivePinia(createPinia());
  stopRayOrderMonitoring(); vi.clearAllMocks(); sessionStorage.clear(); vi.useFakeTimers();
  mocks.load.mockResolvedValue([{ Type: "RAY", PlayerID: 2, OrderID: "one", Status: "None" }]);
  mocks.read.mockResolvedValue([{ provider: "RAY", orderId: "one", status: "none" }]); mocks.save.mockResolvedValue(undefined);
});
afterEach(() => { stopRayOrderMonitoring(); vi.useRealTimers(); });
it("independently queries every five seconds without invoking rejection detection or makeup", async () => {
  startRayOrderMonitoring(); await flush(); expect(mocks.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4999); expect(mocks.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(mocks.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10000); expect(mocks.read).toHaveBeenCalledTimes(4);
  expect(mocks.reject).not.toHaveBeenCalled(); expect(mocks.makeup).not.toHaveBeenCalled();
});
it("repeated start keeps one timer; stop fences it and restart creates one new cycle", async () => {
  startRayOrderMonitoring(); startRayOrderMonitoring(); await flush(); expect(mocks.read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  stopRayOrderMonitoring(); await vi.advanceTimersByTimeAsync(20000); expect(mocks.read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  startRayOrderMonitoring(); await flush(); await vi.advanceTimersByTimeAsync(5000); expect(mocks.read).toHaveBeenCalledTimes(3);
});
it("a slow account request does not overlap subsequent scheduled polls", async () => {
  mocks.read.mockImplementation(() => new Promise(() => {})); startRayOrderMonitoring(); await flush();
  await vi.advanceTimersByTimeAsync(20000); expect(mocks.read).toHaveBeenCalledOnce();
});
