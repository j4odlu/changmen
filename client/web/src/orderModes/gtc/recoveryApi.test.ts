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
it("uses one recovery HTTP request and does not call either old endpoint", async () => {
  expect(await recoverGtc(request(), () => true)).toEqual(response());
  expect(mock.post).toHaveBeenCalledExactlyOnceWith("Pm_GtcRecover", request(), "", { errorTip: false });
  expect(mock.list).not.toHaveBeenCalled(); expect(mock.monitor).not.toHaveBeenCalled();
});
it("preserves successful financial rows when execution reads fail", async () => {
  const result = { ...response(), executions: { ok: false, message: "execution offline" } };
  mock.post.mockResolvedValue({ success: 1, info: result });
  expect(await recoverGtc(request(), () => true)).toEqual(result);
});
it("preserves successful execution rows when financial reads fail", async () => {
  const result = { ...response(), orders: [{ ok: false, message: "finance offline", ids: [id], unchangedIds: [] }] };
  mock.post.mockResolvedValue({ success: 1, info: result });
  expect(await recoverGtc(request(), () => true)).toEqual(result);
});
it("validates the two partitions separately without discarding valid financial rows", async () => {
  mock.post.mockResolvedValue({ success: 1, info: { ...response(), executions: { ok: true, rows: null } } });
  const result = await recoverGtc(request(), () => true);
  expect(result.executions).toMatchObject({ ok: false }); expect(result.orders).toEqual(response().orders);
});
it("does not accept missing, foreign or unverified unchanged financial identities", async () => {
  for (const orders of [[], [{ ok: true, ids: ["foreign"], unchangedIds: [], rows: [] }], [{ ok: true, ids: [id], unchangedIds: [id], rows: [] }]]) {
    mock.post.mockResolvedValue({ success: 1, info: { ...response(), orders } });
    const result = await recoverGtc(request(), () => true);
    expect(result.executions).toEqual(response().executions); expect(result.orders[0]).toMatchObject({ ok: false, ids: [id] });
  }
});
it("an unsupported unified action fails without caching or calling old endpoints", async () => {
  mock.post.mockResolvedValue({ success: 0, msg: "未知预测市场 action: Pm_GtcRecover" });
  await expect(recoverGtc(request(), () => true)).rejects.toThrow("Pm_GtcRecover");
  await expect(recoverGtc(request(), () => true)).rejects.toThrow("Pm_GtcRecover");
  expect(mock.post).toHaveBeenCalledTimes(2); expect(mock.list).not.toHaveBeenCalled(); expect(mock.monitor).not.toHaveBeenCalled();
});
it("does not hide database, authorization or transport failures behind compatibility calls", async () => {
  mock.post.mockResolvedValue({ success: 0, msg: "database offline" });
  await expect(recoverGtc(request(), () => true)).rejects.toThrow("database offline");
  expect(mock.list).not.toHaveBeenCalled(); expect(mock.monitor).not.toHaveBeenCalled();
});
it("discards a previous session's recovery response", async () => {
  mock.post.mockImplementation(async () => { mock.session++; return { success: 1, info: response() }; });
  await expect(recoverGtc(request(), () => true)).rejects.toThrow("登录状态已变更");
});
