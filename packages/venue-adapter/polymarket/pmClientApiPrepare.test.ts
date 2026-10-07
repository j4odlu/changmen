import { beforeEach, afterEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pmPrepareSubmit, pmSubmitOrder } from "./pmClientApi";
import { setPmHttpModeForTests } from "./pmTransportMode";
import { setPmOrderSubmitMode, PM_ORDER_SUBMIT_MODE_KEY } from "./pmOrderSubmitMode";
import { browserSubmitClockReady, prepareBrowserSubmitClock } from "./pmBrowserSubmitClock";
const call = vi.hoisted(() => vi.fn());
vi.mock("./pmTransport", () => ({ pmEsportCall: call }));
vi.mock("./pmBrowserSubmitClock", () => ({ browserSubmitClockReady: vi.fn(() => false), prepareBrowserSubmitClock: vi.fn(async () => {}) }));
beforeEach(() => {
  globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
  vi.useFakeTimers({ toFake: ["performance"] }); call.mockReset(); setPmHttpModeForTests("vps");
  vi.mocked(browserSubmitClockReady).mockReset().mockReturnValue(false);
  vi.mocked(prepareBrowserSubmitClock).mockClear();
});
afterEach(() => { vi.useRealTimers(); setPmHttpModeForTests(null); });
const account = (id: number) => ({ accountId: id, gateway: "https://clob.polymarket.com" }) as PlatformAccount;

test("direct upstream JSON rejection is distinct from gateway and transport failures", async () => {
  call.mockRejectedValueOnce(Object.assign(new Error("400"), { response: { status: 400, data: { error: "FOK_ORDER_NOT_FILLED_ERROR" } } }));
  expect(await pmSubmitOrder(account(998), {})).toMatchObject({ success: false, pmSubmitRejected: true });
  call.mockRejectedValueOnce(Object.assign(new Error("502"), { response: { status: 502, data: { error: "gateway" } } }));
  await expect(pmSubmitOrder(account(998), {})).rejects.toThrow("502");
});

test("cold preparation is shared, hot preparations do not call server, and submit never prepares", async () => {
  call.mockResolvedValue({ ready: true, leaseMs: 2_000 });
  const a = account(991);
  await Promise.all([pmPrepareSubmit(a), pmPrepareSubmit(a)]);
  expect(call).toHaveBeenCalledOnce();
  await pmPrepareSubmit(a); expect(call).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(2_001);
  await pmPrepareSubmit(a); expect(call).toHaveBeenCalledTimes(2);
  call.mockResolvedValue({ success: false, status: "unmatched" });
  await pmSubmitOrder(a, { orderType: "FOK" });
  expect(call.mock.calls.at(-1)?.[0]).toBe("Pm_SubmitOrder");
  expect(call).toHaveBeenCalledTimes(3);
});

test("legacy query modes cannot bypass VPS order preparation; an old backend fails before submit", async () => {
  call.mockResolvedValue({ ready: true, leaseMs: 120_000 });
  for (const mode of ["direct", "extension"] as const) {
    setPmHttpModeForTests(mode); await pmPrepareSubmit(account(992));
  }
  expect(call.mock.calls.map(c => c[0])).toEqual(["Pm_PrepareSubmit"]);
  call.mockClear();
  setPmHttpModeForTests("vps"); call.mockResolvedValue({});
  await expect(pmPrepareSubmit(account(993))).rejects.toThrow("校时未就绪");
  expect(call.mock.calls.map(c => c[0])).toEqual(["Pm_PrepareSubmit"]);
});

test("server clock loss invalidates the lease for a new attempt without retrying this order", async () => {
  const a = account(994);
  call.mockResolvedValue({ ready: true, leaseMs: 120_000 });
  await pmPrepareSubmit(a);
  call.mockRejectedValueOnce(new Error("PM 提交校时未就绪，请重新预检"));
  await expect(pmSubmitOrder(a, { orderType: "FOK" })).rejects.toThrow("校时未就绪");
  expect(call.mock.calls.map(c => c[0])).toEqual(["Pm_PrepareSubmit", "Pm_SubmitOrder"]);
  await pmPrepareSubmit(a);
  expect(call.mock.calls.map(c => c[0])).toEqual(["Pm_PrepareSubmit", "Pm_SubmitOrder", "Pm_PrepareSubmit"]);
});

test("submit clock preparation follows the order preference rather than the query mode", async () => {
  setPmOrderSubmitMode("local");
  setPmHttpModeForTests("vps");
  await pmPrepareSubmit(account(995));
  expect(call).not.toHaveBeenCalled();
  expect(prepareBrowserSubmitClock).toHaveBeenCalledWith(account(995).gateway);
  setPmOrderSubmitMode("vps");
  setPmHttpModeForTests("direct");
  call.mockResolvedValue({ ready: true, leaseMs: 120_000 });
  await pmPrepareSubmit(account(995));
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0][0]).toBe("Pm_PrepareSubmit");
});
