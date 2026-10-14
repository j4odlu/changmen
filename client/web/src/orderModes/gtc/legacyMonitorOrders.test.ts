import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { beforeEach, expect, it, vi } from "vitest";
import { loadGtcMonitorOrders } from "./ordersApi";
import { readLegacyGtcMonitorOrders } from "./legacyMonitorOrders";
const mock = vi.hoisted(() => ({ post: vi.fn(), current: true }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => mock.current,
  unwrap: (response: { success: number; msg?: string; info: unknown }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
const id = "11111111-1111-1111-1111-111111111111";
const secondId = "22222222-2222-2222-2222-222222222222";
const at = Date.UTC(2026, 9, 8, 23, 59);
function record(): GtcExecution {
  const row = createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: "BUY", linkId: at } as GtcPlan, at);
  row.other.orderId = "other"; row.other.submittedAt = at + 120000;
  return row;
}
const order = (): OrderRow => ({ PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win", PmGtcExecutionId: id });
function reader(records: unknown = [record()], rows: OrderRow[] = [order()]) {
  return vi.fn(async (action: string, body: Record<string, unknown>) => {
    if (action === "Pm_GtcList") return records;
    if (action !== "Pm_GtcOrders") throw new Error("unexpected write/shared endpoint");
    return { list: body.pageIndex === 1 ? rows : [], total: rows.length, pageIndex: body.pageIndex, pageSize: body.pageSize };
  });
}
beforeEach(() => { vi.clearAllMocks(); mock.current = true; });
it("uses modern identity endpoint without legacy reads and chunks at 1000", async () => {
  mock.post.mockResolvedValue({ success: 1, info: [] });
  await expect(loadGtcMonitorOrders(Array(1001).fill(id))).resolves.toEqual([]);
  expect(mock.post.mock.calls.map(call => [call[0], call[1].ids.length])).toEqual([["Pm_GtcMonitorOrders", 1000], ["Pm_GtcMonitorOrders", 1]]);
});
it("uses only the exact old-backend unknown-action response and keeps exact terminal originals", async () => {
  const read = reader([record()], [order(), { PlayerID: 2, Type: "RAY", OrderID: "other", Status: "Lose" }]);
  mock.post.mockImplementation(async (action, body) => action === "Pm_GtcMonitorOrders"
    ? { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders", info: null }
    : { success: 1, info: await read(action, body) });
  expect(await loadGtcMonitorOrders([id])).toEqual([order(), { PlayerID: 2, Type: "RAY", OrderID: "other", Status: "Lose", PmGtcExecutionId: id }]);
  expect(new Set(read.mock.calls.filter(call => call[0] === "Pm_GtcOrders").map(call => call[1].date))).toEqual(new Set(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]));
});
for (const response of [
  { success: 0, msg: "数据库不可用" }, { success: 0, msg: "请先登录" },
  { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders", code: "AUTH_REQUIRED" },
  { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders " },
  { success: 0, msg: "未知预测市场 action: Other" }, { success: 1, info: null },
]) it(`does not downgrade a failed or malformed response ${JSON.stringify(response)}`, async () => {
  mock.post.mockResolvedValue(response); await expect(loadGtcMonitorOrders([id])).rejects.toThrow();
  expect(mock.post).toHaveBeenCalledTimes(1);
});
it("does not downgrade network failure or cache downgrade across upgrades", async () => {
  mock.post.mockRejectedValue(new Error("timeout")); await expect(loadGtcMonitorOrders([id])).rejects.toThrow("timeout"); expect(mock.post).toHaveBeenCalledTimes(1);
  mock.post.mockResolvedValue({ success: 1, info: [] }); await loadGtcMonitorOrders([id]); expect(mock.post.mock.calls.at(-1)?.[0]).toBe("Pm_GtcMonitorOrders");
});
for (const stage of ["before", "modern", "list", "page"]) it(`stops requests on session change at ${stage}`, async () => {
  mock.current = stage !== "before";
  mock.post.mockImplementation(async (action, body) => {
    if ((stage === "modern" && action === "Pm_GtcMonitorOrders") || (stage === "list" && action === "Pm_GtcList") || (stage === "page" && action === "Pm_GtcOrders")) mock.current = false;
    if (action === "Pm_GtcMonitorOrders") return { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders" };
    return { success: 1, info: await reader()(action, body) };
  });
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow("登录状态已变更");
  expect(mock.post).toHaveBeenCalledTimes({ before: 0, modern: 1, list: 2, page: 3 }[stage]!);
});
it("does not stop at legacy short-page total and deduplicates adjacent dates", async () => {
  const read = vi.fn(async (action, body) => action === "Pm_GtcList" ? [record()] : {
    list: body.pageIndex === 2 ? [order()] : body.pageIndex === 1 ? [{ PlayerID: 3, Type: "Polymarket", OrderID: "buy", Status: "Win" }] : [],
    total: 1, pageIndex: body.pageIndex, pageSize: body.pageSize,
  });
  expect(await readLegacyGtcMonitorOrders([id], read)).toEqual([order()]); expect(read.mock.calls.some(call => call[1].pageIndex === 3)).toBe(true);
});
it("accepts repeated display groups from distinct raw pages until the actual empty page", async () => {
  const read = vi.fn(async (action, body) => action === "Pm_GtcList" ? [record()] : {
    list: body.pageIndex < 3 ? [order()] : [], total: 1, pageIndex: body.pageIndex, pageSize: body.pageSize,
  });
  expect(await readLegacyGtcMonitorOrders([id], read)).toEqual([order()]);
  expect(read.mock.calls.some(call => call[1].pageIndex === 3)).toBe(true);
});
it("stops obsolete generation requests while the same auth session remains current", async () => {
  let current = true;
  mock.post.mockImplementation(async (action) => {
    if (action === "Pm_GtcMonitorOrders") return { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders" };
    if (action === "Pm_GtcList") { current = false; return { success: 1, info: [record()] }; }
    throw new Error("obsolete read");
  });
  await expect(loadGtcMonitorOrders([id], () => current)).rejects.toThrow("登录状态已变更");
  expect(mock.post).toHaveBeenCalledTimes(2);
});
it("filters wrong player, provider, id, sells and unrelated executions without changing rows", async () => {
  const rows: OrderRow[] = [order(), { ...order(), PlayerID: 3 }, { ...order(), Type: "OB" }, { ...order(), OrderID: "different" }, { ...order(), PmSide: "sell" }, { ...order(), PfSide: "sell" }];
  const before = structuredClone(rows); expect(await readLegacyGtcMonitorOrders([id], reader([record()], rows))).toEqual([order()]); expect(rows).toEqual(before);
});
for (const mutation of [
  (r: GtcExecution) => { r.owner = ""; }, (r: GtcExecution) => { r.createdAt = NaN; },
  (r: GtcExecution) => { r.plan.playerId = -1; }, (r: GtcExecution) => { r.other.submittedAt = Infinity; },
]) it("rejects incomplete persisted identity or date instead of guessing", async () => {
  const r = record(); mutation(r); await expect(readLegacyGtcMonitorOrders([id], reader([r]))).rejects.toThrow("证据不完整");
});
it("rejects duplicate identities, mixed owners, and malformed list", async () => {
  for (const records of [null, {}, [record(), record()], [record(), { ...record(), id: secondId, owner: "other-owner" }]])
    await expect(readLegacyGtcMonitorOrders([id, secondId], reader(records))).rejects.toThrow();
});
it("rejects mismatched execution and ambiguous untagged anchors", async () => {
  await expect(readLegacyGtcMonitorOrders([id], reader([record()], [{ ...order(), PmGtcExecutionId: secondId }]))).rejects.toThrow();
  await expect(readLegacyGtcMonitorOrders([id, secondId], reader([record(), { ...record(), id: secondId }], [{ ...order(), PmGtcExecutionId: undefined }]))).rejects.toThrow();
});
it("rejects conflicting pages and never returns partial terminal evidence after read failure", async () => {
  for (const fault of ["error", "conflict"]) {
    const read = vi.fn(async (action, body) => {
      if (action === "Pm_GtcList") return [record()];
      if (body.pageIndex === 2 && fault === "error") throw new Error("database unavailable");
      return { list: body.pageIndex < 3 ? [{ ...order(), Status: body.pageIndex === 2 ? "Lose" : "Win" }] : [], pageIndex: body.pageIndex, pageSize: body.pageSize };
    });
    await expect(readLegacyGtcMonitorOrders([id], read)).rejects.toThrow();
  }
});
for (const shape of [null, {}, { list: [] }, { list: [], pageIndex: 2, pageSize: 5000 }, { list: [], pageIndex: 1, pageSize: 1 }])
  it(`rejects invalid paging envelope ${JSON.stringify(shape)}`, async () => {
    await expect(readLegacyGtcMonitorOrders([id], vi.fn(async action => action === "Pm_GtcList" ? [record()] : shape))).rejects.toThrow();
  });
it("rejects repeated pages and overflow instead of pretending the read is complete", async () => {
  await expect(readLegacyGtcMonitorOrders([id], vi.fn(async (action, body) => action === "Pm_GtcList" ? [record()] : { list: [order()], pageIndex: body.pageIndex, pageSize: 5000 }))).rejects.toThrow();
  await expect(readLegacyGtcMonitorOrders([id], vi.fn(async (action, body) => action === "Pm_GtcList" ? [record()] : { list: [{ ...order(), OrderID: `unrelated-${body.pageIndex}` }], pageIndex: body.pageIndex, pageSize: 5000 }))).rejects.toThrow();
});
it("empty evidence does not manufacture a terminal original and invalid ids do not send I/O", async () => {
  expect(await readLegacyGtcMonitorOrders([id], reader([], []))).toEqual([]);
  for (const ids of [["not-id"], ["------------------------------------"], [id + " "]]) {
    await expect(loadGtcMonitorOrders(ids)).rejects.toThrow(); expect(mock.post).not.toHaveBeenCalled();
  }
  expect(await loadGtcMonitorOrders([])).toEqual([]); expect(mock.post).not.toHaveBeenCalled();
});
it("missing a durably filled original is an unresolved sync failure, while an unfilled pending original may have no ledger row", async () => {
  const filled = record(); filled.financialOrder = { pmShares: 10, pmFillPrice: 0.5, pmStakeUsdc: 5, pmFeeUsdc: 0, odds: 2, betMoney: 5 };
  await expect(readLegacyGtcMonitorOrders([id], reader([filled], []))).rejects.toThrow("跨日期改绑");
  expect(await readLegacyGtcMonitorOrders([id], reader([record()], []))).toEqual([]);
});
