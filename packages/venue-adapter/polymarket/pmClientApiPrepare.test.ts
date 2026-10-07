import { beforeEach, afterEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pmPrepareSubmit, pmSubmitOrder } from "./pmClientApi";
import { setPmHttpModeForTests } from "./pmTransportMode";
const call = vi.hoisted(() => vi.fn());
vi.mock("./pmTransport", () => ({ pmEsportCall: call }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["performance"] }); call.mockReset(); setPmHttpModeForTests("vps"); });
afterEach(() => { vi.useRealTimers(); setPmHttpModeForTests(null); });
const account = (id: number) => ({ accountId: id, gateway: "https://clob.polymarket.com" }) as PlatformAccount;

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

test("direct/extension preparation adds no clock requests; an old backend fails before submit", async () => {
  for (const mode of ["direct", "extension"] as const) {
    setPmHttpModeForTests(mode); await pmPrepareSubmit(account(992));
  }
  expect(call).not.toHaveBeenCalled();
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
