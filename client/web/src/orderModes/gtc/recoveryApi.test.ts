import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { GtcRecoverRequest } from "@changmen/shared/pm_gtc_recovery";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { beforeEach, expect, it, vi } from "vitest";
import { recoverGtc } from "./recoveryApi";

const mock = vi.hoisted(() => ({ post: vi.fn(), list: vi.fn(), monitor: vi.fn(), session: 1, current: true }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => mock.session, isAuthSessionCurrent: (session: number) => mock.current && session === mock.session, unwrap: (response: { success: number; msg: string; info: unknown }) => {
  if (response.success !== 1)
    throw new Error(response.msg); return response.info;
} }));
vi.mock("./api", () => ({ listGtc: mock.list }));
vi.mock("./ordersApi", () => ({ loadGtcMonitorOrders: mock.monitor }));
const id = "11111111-1111-1111-1111-111111111111";
const row = createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, orderHash: "buy" } as GtcPlan, 0);
const order = { PmGtcExecutionId: id, PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win" };
const request = (): GtcRecoverRequest => ({ discover: true, knownRevisions: {}, monitorIds: [id], recoverDiscovered: true, skipMonitorIds: [], knownOrders: {} });
const response = () => ({ executions: { ok: true, rows: [row] }, orders: [{ ok: true, ids: [id], unchangedIds: [], rows: [order] }] });
beforeEach(() => {
  vi.clearAllMocks(); mock.session = 1; mock.current = true;
  mock.post.mockResolvedValue({ success: 1, info: response() }); mock.list.mockResolvedValue([row]); mock.monitor.mockResolvedValue([order]);
});
it("combines local execution discovery and exact result reads without execution RPC", async () => {
  expect(await recoverGtc(request(), () => true)).toEqual(response());
  expect(mock.list).toHaveBeenCalledWith(undefined, {});
  expect(mock.monitor).toHaveBeenCalledWith([id], expect.any(Function));
  expect(mock.post).not.toHaveBeenCalled();
});
it("preserves financial rows when local storage reads fail", async () => {
  mock.list.mockRejectedValue(new Error("execution offline"));
  expect(await recoverGtc(request(), () => true)).toEqual({ ...response(), executions: { ok: false, message: "execution offline" } });
});
it("preserves local executions when financial reads fail", async () => {
  mock.monitor.mockRejectedValue(new Error("finance offline"));
  expect(await recoverGtc(request(), () => true)).toEqual({ ...response(), orders: [{ ok: false, message: "finance offline", ids: [id], unchangedIds: [] }] });
});
it("rejects malformed local discovery without discarding financial rows", async () => {
  mock.list.mockResolvedValue(null);
  const result = await recoverGtc(request(), () => true);
  expect(result.executions).toMatchObject({ ok: false }); expect(result.orders).toEqual(response().orders);
});
it("rejects foreign financial identities", async () => {
  mock.monitor.mockResolvedValue([{ ...order, PmGtcExecutionId: "foreign" }]);
  const result = await recoverGtc(request(), () => true);
  expect(result.executions).toEqual(response().executions); expect(result.orders[0]).toMatchObject({ ok: false, ids: [id] });
});
it("unchanged results use the existing financial fingerprint", async () => {
  const { gtcRecoveryFinancialKey } = await import("@changmen/shared/pm_gtc_recovery");
  const req = request(); req.knownOrders[id] = gtcRecoveryFinancialKey([order]);
  expect((await recoverGtc(req, () => true)).orders).toEqual([{ ok: true, ids: [id], unchangedIds: [id], rows: [] }]);
});
it("known financial reads start while local discovery is pending", async () => {
  let finish!: (rows: typeof row[]) => void;
  mock.list.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const task = recoverGtc(request(), () => true);
  await Promise.resolve(); expect(mock.monitor).toHaveBeenCalledOnce();
  finish([row]); await task;
});
it("discards a previous session's recovery response", async () => {
  mock.monitor.mockImplementation(async () => { mock.session++; return [order]; });
  await expect(recoverGtc(request(), () => true)).rejects.toThrow("登录状态已变更");
});
