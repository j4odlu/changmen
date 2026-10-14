/** [changmen 扩展] GTC 模块恢复频率与退避回归。 */
import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGtcSettlementEvidence } from "@/orderModes/gtc/settlementEvidence";
import { recoverMonitorRecords, resetMonitorRecovery } from "./recovery";
import { needsFinancialRecovery } from "./recoveryPolicy";

const mock = vi.hoisted(() => ({ post: vi.fn(), finance: vi.fn(), list: vi.fn(), refresh: vi.fn(), session: true, records: [] as GtcExecution[], orders: [] as OrderRow[], error: "", evidence: undefined as ReturnType<typeof createGtcSettlementEvidence> | undefined }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => mock.session, unwrap: (response: { success: number; msg?: string; info: unknown }) => {
  if (response.success !== 1)
    throw new Error(response.msg);
  return response.info;
} }));
vi.mock("@/orderModes/gtc/executionState", () => ({ captureGtcSession: () => () => mock.session, knownGtcRevisions: () => Object.fromEntries(mock.records.map(row => [row.id, row.revision])), applyRecoveredGtcRecords: () => 0, financialOrders: () => mock.evidence!.rows(mock.orders), gtcProgress: mock, settlement: { rows: (rows: OrderRow[]) => mock.evidence!.rows(rows) } }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ fetchOrders: mock.refresh, orderDate: "2026-10-14" }) }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ resolveGtcFillFee: () => 0 }));
const id = (n: number) => `${n.toString(16).padStart(8, "0")}-1111-1111-1111-111111111111`;
function record(n: number): GtcExecution {
  const row = createGtcExecution(id(n), "owner", "wallet", "maker", { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: `buy${n}`, shares: "10" } as GtcPlan, 0);
  return { ...row, pmAuthorized: true, submit: "accepted", orderId: `buy${n}`, decision: "closed", order: { id: `buy${n}`, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, open: "10", complete: true };
}
function filled(n: number): GtcExecution {
  const row = record(n);
  return { ...row, terminal: true, open: "0", matched: "10", order: { ...row.order!, matched: "10", status: "MATCHED", tradeIds: ["trade"] }, fills: { trade: { key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 0 } } };
}
function final(row: GtcExecution, pm = true): OrderRow {
  return { PmGtcExecutionId: row.id, PlayerID: pm ? 1 : 2, Type: pm ? "Polymarket" : "RAY", OrderID: pm ? row.orderId! : row.other.orderId!, Status: "Win" };
}
const requests = () => mock.finance.mock.calls.filter(([action]) => action === "Pm_GtcMonitorOrders");
async function at(ms: number) { vi.setSystemTime(ms); await recoverMonitorRecords(); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); resetMonitorRecovery();
  mock.session = true; mock.records = []; mock.orders = []; mock.error = ""; mock.evidence = createGtcSettlementEvidence();
  mock.list.mockResolvedValue(undefined); mock.refresh.mockResolvedValue(undefined);
  mock.finance.mockResolvedValue({ success: 1, info: [] });
  mock.post.mockImplementation(async (action, body) => {
    if (action !== "Pm_GtcRecover")
      throw new Error("normal recovery must use the unified endpoint");
    const finance = async (ids: string[]) => {
      try {
        const response = await mock.finance("Pm_GtcMonitorOrders", { ids });
        return response.success === 1
          ? { ok: true, ids, unchangedIds: [], rows: response.info }
          : { ok: false, ids, unchangedIds: [], message: response.msg };
      }
      catch (error) { return { ok: false, ids, unchangedIds: [], message: (error as Error).message }; }
    };
    const executionTask = body.discover
      ? mock.list().then(() => ({ ok: true, rows: [...mock.records] })).catch((error: Error) => ({ ok: false, message: error.message }))
      : Promise.resolve(null);
    const ordersTask = body.monitorIds.length ? finance(body.monitorIds) : Promise.resolve(null);
    const [executions, requested] = await Promise.all([executionTask, ordersTask]);
    const orders = requested ? [requested] : [];
    if (body.recoverDiscovered && executions?.ok) {
      const skipped = new Set([...body.skipMonitorIds, ...body.monitorIds]);
      const ids = executions.rows.filter((row: GtcExecution) => !skipped.has(row.id) && needsFinancialRecovery(row, [])).map((row: GtcExecution) => row.id);
      for (let offset = 0; offset < ids.length; offset += 1000)
        orders.push(await finance(ids.slice(offset, offset + 1000)));
    }
    return { success: 1, info: { executions, orders } };
  });
});
afterEach(() => { resetMonitorRecovery(); vi.useRealTimers(); });

it("only reads unsettled or unrecovered originals, skipping settled, zero-fill canceled and never submitted records", async () => {
  const settled = filled(1); const zero = record(2);
  Object.assign(zero, { terminal: true, open: "0", order: { ...zero.order!, status: "CANCELED" } });
  const pending = filled(3); const unknown = record(4); unknown.orderId = null; unknown.submit = "unknown";
  const prepared = createGtcExecution(id(5), "owner", "wallet", "maker", pending.plan, 0);
  mock.records = [settled, zero, pending, unknown, prepared]; mock.orders = [final(settled)];
  await recoverMonitorRecords();
  expect(requests()).toHaveLength(1); expect(requests()[0]![1]).toEqual({ ids: [pending.id, unknown.id] });
  expect(mock.post).toHaveBeenCalledOnce();
  expect(mock.refresh).not.toHaveBeenCalled();
});
it("still reads an unsettled other leg after PM has settled, and stops only when the exact other original settles", async () => {
  const row = filled(1); row.other = { ...row.other, state: "filled", orderId: "ray1" };
  mock.records = [row]; mock.orders = [final(row), { ...final(row, false), PlayerID: 99 }, { ...final(row, false), OrderID: "another" }];
  await recoverMonitorRecords(); expect(requests()).toHaveLength(1);
  mock.orders.push(final(row, false)); await at(60000); await at(360000);
  expect(requests()).toHaveLength(1); expect(mock.refresh).not.toHaveBeenCalled();
});
it("does not confuse filled with financially settled, and keeps incomplete canceled facts eligible for recovery", async () => {
  const row = filled(1); const incomplete = record(2);
  Object.assign(incomplete, { terminal: true, open: "0", complete: false, order: { ...incomplete.order!, status: "CANCELED" } });
  mock.records = [row, incomplete]; await recoverMonitorRecords();
  expect(requests()[0]![1]).toEqual({ ids: [row.id, incomplete.id] });
});
it("unchanged financial reads and record discovery back off to five minutes; timestamps and revisions do not bypass it", async () => {
  mock.records = [filled(1)]; const times: number[] = [];
  mock.finance.mockImplementation(async () => { times.push(Date.now()); return { success: 1, info: [] }; });
  for (const time of [0, 5000, 59999, 60000, 120000, 179999, 180000, 240000, 419999, 420000, 600000, 720000]) {
    mock.records[0]!.observedAt = time; mock.records[0]!.revision++;
    await at(time);
  }
  expect(times).toEqual([0, 60000, 180000, 420000, 720000]); expect(mock.list).toHaveBeenCalledTimes(5);
  expect(mock.refresh).not.toHaveBeenCalled();
});
it("new executions and meaningful original changes query immediately without rereading unchanged neighbors or the common list", async () => {
  const row = record(1); mock.records = [row, filled(2)]; await at(0);
  mock.records.push(record(3)); await at(5000);
  expect(requests()[1]![1]).toEqual({ ids: [id(3)] });
  row.matched = "2"; await at(10000);
  expect(requests()[2]![1]).toEqual({ ids: [row.id] });
  row.revision++; row.observedAt++; await at(15000);
  expect(requests()).toHaveLength(3); expect(mock.list).toHaveBeenCalledOnce(); expect(mock.refresh).not.toHaveBeenCalled();
});
it("newly discovered records receive one exact lookup in the same recovery round", async () => {
  mock.list.mockImplementation(async () => { mock.records = [record(1)]; });
  await recoverMonitorRecords();
  expect(requests()).toHaveLength(1); expect(requests()[0]![1]).toEqual({ ids: [id(1)] });
  expect(mock.post).toHaveBeenCalledOnce();
});
it("incremental unchanged markers retain cached financial content and extend the next read interval", async () => {
  mock.records = [filled(1)];
  mock.post.mockImplementation(async (_action, body) => ({ success: 1, info: {
    executions: body.discover ? { ok: true, rows: [] } : null,
    orders: [{ ok: true, ids: body.monitorIds, unchangedIds: body.knownOrders[id(1)] == null ? [] : [id(1)], rows: [] }],
  } }));
  await at(0); await at(60000); await at(120000);
  expect(mock.post).toHaveBeenCalledTimes(2);
  expect(mock.post.mock.calls[1]![1].knownOrders).toEqual({ [id(1)]: "[]" });
  await at(180000); expect(mock.post).toHaveBeenCalledTimes(3);
});
it("changed financial status resets the read interval and terminal evidence survives ordinary date filtering", async () => {
  const row = filled(1); mock.records = [row];
  mock.finance.mockResolvedValue({ success: 1, info: [{ ...final(row), Status: "Pending" }] });
  await at(0); await at(60000);
  mock.finance.mockResolvedValue({ success: 1, info: [{ ...final(row), Status: "Accepted" }] });
  await at(180000); await at(239999); expect(requests()).toHaveLength(3);
  mock.finance.mockResolvedValue({ success: 1, info: [final(row)] });
  await at(240000); mock.orders = []; await at(540000);
  expect(requests()).toHaveLength(4); expect(mock.evidence!.rows([])).toEqual([final(row)]); expect(mock.refresh).not.toHaveBeenCalled();
});
it("financial failures retry with increasing intervals up to five minutes despite continuing record changes", async () => {
  mock.records = [record(1)]; const times: number[] = [];
  mock.finance.mockImplementation(async () => { times.push(Date.now()); throw new Error("offline"); });
  for (const time of [0, 4999, 5000, 14999, 15000, 34999, 35000, 74999, 75000, 154999, 155000, 314999, 315000, 614999, 615000]) {
    mock.records[0]!.matched = String(time);
    vi.setSystemTime(time); await recoverMonitorRecords().catch(() => {});
  }
  expect(times).toEqual([0, 5000, 15000, 35000, 75000, 155000, 315000, 615000]);
  expect(mock.refresh).not.toHaveBeenCalled();
  mock.finance.mockResolvedValue({ success: 1, info: [] }); await at(915000);
  mock.records[0]!.matched = "1"; await at(920000); expect(requests()).toHaveLength(10);
  expect(mock.error).toBe("");
});
it("record discovery failures do not block loaded financial reads or force successful financial reads to repeat", async () => {
  const row = filled(1); mock.records = [row]; mock.list.mockRejectedValue(new Error("list offline"));
  mock.finance.mockResolvedValue({ success: 1, info: [final(row)] });
  await expect(recoverMonitorRecords()).rejects.toThrow("list offline");
  expect(mock.evidence!.rows([])).toEqual([final(row)]);
  for (const time of [5000, 15000, 35000]) { vi.setSystemTime(time); await recoverMonitorRecords().catch(() => {}); }
  expect(requests()).toHaveLength(1); expect(mock.list).toHaveBeenCalledTimes(4);
});
it("financial failures never force early record discovery, and healthy new executions are read while another backs off", async () => {
  mock.records = [record(1)]; mock.finance.mockRejectedValue(new Error("first offline"));
  await expect(recoverMonitorRecords()).rejects.toThrow("first offline");
  mock.records.push(record(2)); mock.finance.mockResolvedValue({ success: 1, info: [] });
  await at(1000); expect(requests()[1]![1]).toEqual({ ids: [id(2)] });
  await at(5000); expect(requests()[2]![1]).toEqual({ ids: [id(1)] }); expect(mock.list).toHaveBeenCalledOnce();
  expect(mock.post.mock.calls[2]![1].discover).toBe(false);
});
it("large restores use batches of at most 1000 and failed batches do not reread successful batches", async () => {
  mock.records = Array.from({ length: 1001 }, (_, n) => record(n + 1));
  mock.finance.mockImplementation(async (_action, body) => {
    if (body.ids.length === 1000)
      throw new Error("first batch offline");
    return { success: 1, info: [] };
  });
  await expect(recoverMonitorRecords()).rejects.toThrow("first batch offline");
  expect(requests().map(([, body]) => body.ids.length)).toEqual([1000, 1]);
  mock.finance.mockResolvedValue({ success: 1, info: [] }); await at(5000);
  expect(requests().map(([, body]) => body.ids.length)).toEqual([1000, 1, 1000]);
});
it("starts financial reads independently of discovery, and concurrent callers share one aggregate response", async () => {
  mock.records = [filled(1)]; let finish!: () => void;
  mock.list.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  mock.finance.mockResolvedValue({ success: 1, info: [final(mock.records[0]!)] });
  const task = recoverMonitorRecords(); expect(recoverMonitorRecords()).toBe(task);
  await vi.advanceTimersByTimeAsync(0);
  expect(requests()).toHaveLength(1); expect(mock.post).toHaveBeenCalledOnce();
  finish(); await task; expect(mock.evidence!.rows([])).toHaveLength(1);
});
it("owner reset discards in-flight reads and clears the previous owner's backoff", async () => {
  mock.records = [filled(1)]; let finish!: (value: unknown) => void;
  mock.finance.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const task = recoverMonitorRecords(); resetMonitorRecovery();
  finish({ success: 1, info: [final(mock.records[0]!)] }); await task.catch(() => {});
  expect(mock.evidence!.rows([])).toEqual([]);
  mock.finance.mockResolvedValue({ success: 1, info: [] }); await recoverMonitorRecords();
  expect(requests()).toHaveLength(2); expect(mock.list).toHaveBeenCalledTimes(2);
});
