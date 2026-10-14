import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { gtcRecoveryFinancialKey } from "@changmen/shared/pm_gtc_recovery";
import { beforeEach, expect, it, vi } from "vitest";
import { recoverPmGtc } from "./recovery.js";

const mocks = vi.hoisted(() => ({ list: vi.fn(), records: vi.fn(), orders: vi.fn() }));
vi.mock("@changmen/db", () => ({ listPmGtc: mocks.list, listPmGtcByIds: mocks.records, fetchOrdersByPlayerOrderIdsStrict: mocks.orders }));
vi.mock("../../account/order/dto.js", () => ({ toClientOrder: row => ({ OrderID: row.order_id, PlayerID: row.player_id, Type: row.provider, Status: row.status, Money: row.money }) }));
vi.mock("../../account/order_store.js", () => ({}));
const id = "11111111-1111-1111-1111-111111111111";
const secondId = "22222222-2222-2222-2222-222222222222";
let execution;
const request = () => ({ discover: true, knownRevisions: {}, monitorIds: [], skipMonitorIds: [], knownOrders: {}, recoverDiscovered: true });
const raw = () => ({ user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "buy", status: "Win", money: 10 });
beforeEach(() => {
  vi.clearAllMocks();
  execution = createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, orderHash: "buy", shares: "10", otherPlayerId: 0, otherProvider: "" }, 0);
  Object.assign(execution, { pmAuthorized: true, submit: "accepted", orderId: "buy" });
  mocks.list.mockResolvedValue([execution]); mocks.records.mockResolvedValue([execution]); mocks.orders.mockResolvedValue([raw()]);
});
it("first recovery returns discovered executions and exact financial originals in one response without rereading executions", async () => {
  const response = await recoverPmGtc(request(), "owner");
  expect(response.executions).toEqual({ ok: true, rows: [execution] });
  expect(response.orders).toEqual([{ ok: true, ids: [id], unchangedIds: [], rows: [{ PmGtcExecutionId: id, OrderID: "buy", PlayerID: 1, Type: "Polymarket", Status: "Win", Money: 10 }] }]);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith("owner", undefined, {});
  expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.orders).toHaveBeenCalledExactlyOnceWith(1, "owner", ["buy"]);
});
it("execution read failure preserves successful financial recovery for requested originals", async () => {
  mocks.list.mockRejectedValue(new Error("execution unavailable"));
  const response = await recoverPmGtc({ ...request(), monitorIds: [id] }, "owner");
  expect(response.executions).toEqual({ ok: false, message: "execution unavailable" });
  expect(response.orders[0]).toMatchObject({ ok: true, ids: [id], rows: [{ PmGtcExecutionId: id }] });
});
it("financial failure preserves discovered executions and identifies only the failed financial batch", async () => {
  mocks.orders.mockRejectedValue(new Error("finance unavailable"));
  const response = await recoverPmGtc(request(), "owner");
  expect(response.executions).toEqual({ ok: true, rows: [execution] });
  expect(response.orders).toEqual([{ ok: false, message: "finance unavailable", ids: [id], unchangedIds: [] }]);
});
it("separately backed-off execution reads can be omitted while financial recovery continues", async () => {
  const response = await recoverPmGtc({ ...request(), discover: false, monitorIds: [id] }, "owner");
  expect(response.executions).toBeNull(); expect(response.orders[0].ok).toBe(true); expect(mocks.list).not.toHaveBeenCalled();
});
it("financial backoff and already settled identities exclude discovered rows without blocking execution updates", async () => {
  const response = await recoverPmGtc({ ...request(), skipMonitorIds: [id] }, "owner");
  expect(response.executions.ok).toBe(true); expect(response.orders).toEqual([]); expect(mocks.orders).not.toHaveBeenCalled();
});
it("normalizes form-serialized flags, identities and versions while ignoring supplied ownership", async () => {
  await recoverPmGtc({ discover: "true", recoverDiscovered: "false", knownRevisions: JSON.stringify({ [id]: 3 }), monitorIds: JSON.stringify([id, id]), skipMonitorIds: "[]", knownOrders: "{}", owner: "foreign" }, "owner");
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith("owner", undefined, { [id]: 3 });
  expect(mocks.records).toHaveBeenCalledExactlyOnceWith("owner", [id]);
});
it("unchanged financial content is omitted from incremental responses and monetary changes remain visible", async () => {
  const knownRow = { PmGtcExecutionId: id, OrderID: "buy", PlayerID: 1, Type: "Polymarket", Status: "Win", Money: 10 };
  const body = { ...request(), knownOrders: { [id]: gtcRecoveryFinancialKey([knownRow]) } };
  expect((await recoverPmGtc(body, "owner")).orders).toEqual([{ ok: true, ids: [id], unchangedIds: [id], rows: [] }]);
  mocks.orders.mockResolvedValue([{ ...raw(), money: 11 }]);
  expect((await recoverPmGtc(body, "owner")).orders[0]).toMatchObject({ ok: true, unchangedIds: [], rows: [{ Money: 11 }] });
});
it("does not infer financial settlement from matched shares or query never submitted and confirmed zero-fill originals", async () => {
  execution.pmAuthorized = false; execution.submit = "prepared"; execution.orderId = null;
  expect((await recoverPmGtc(request(), "owner")).orders).toEqual([]);
  Object.assign(execution, { pmAuthorized: true, submit: "accepted", orderId: "buy", terminal: true, complete: true, open: "0", order: { id: "buy", original: "10", matched: "0", tradeIds: [], status: "CANCELED" } });
  expect((await recoverPmGtc(request(), "owner")).orders).toEqual([]);
  execution.matched = "10";
  expect((await recoverPmGtc(request(), "owner")).orders[0].ok).toBe(true);
});
it("continues recovering the other original after a zero-fill PM termination", async () => {
  Object.assign(execution, { terminal: true, complete: true, open: "0", other: { state: "filled", orderId: "ray" } });
  Object.assign(execution.plan, { otherPlayerId: 2, otherProvider: "RAY" });
  mocks.orders.mockImplementation(async player => player === 2 ? [{ ...raw(), player_id: 2, provider: "RAY", order_id: "ray" }] : []);
  expect((await recoverPmGtc(request(), "owner")).orders[0].rows).toMatchObject([{ Type: "RAY", PlayerID: 2 }]);
});
it("foreign requested IDs cannot expose any financial orders", async () => {
  mocks.records.mockResolvedValue([]);
  const response = await recoverPmGtc({ ...request(), discover: false, monitorIds: [secondId] }, "owner");
  expect(response.orders[0]).toEqual({ ok: true, ids: [secondId], unchangedIds: [], rows: [] }); expect(mocks.orders).not.toHaveBeenCalled();
});
it("rejects a foreign discovered execution before publishing its facts or loading its financial originals", async () => {
  mocks.list.mockResolvedValue([{ ...execution, owner: "foreign" }]);
  const response = await recoverPmGtc(request(), "owner");
  expect(response.executions).toMatchObject({ ok: false }); expect(response.orders).toEqual([]); expect(mocks.orders).not.toHaveBeenCalled();
});
it.each([{ monitorIds: ["bad"] }, { discover: "1" }, { knownRevisions: { [id]: -1 } }, { knownOrders: { [id]: 1 } }, { skipMonitorIds: "[" }, { monitorIds: Array.from({ length: 1001 }).fill(id) }])("rejects invalid inputs before any reads: %o", async (change) => {
  await expect(recoverPmGtc({ ...request(), ...change }, "owner")).rejects.toThrow("GTC 恢复");
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.orders).not.toHaveBeenCalled();
});
it("requires authentication before reading either table", async () => {
  await expect(recoverPmGtc(request(), "")).rejects.toThrow("登录"); expect(mocks.list).not.toHaveBeenCalled();
});
it("a malformed original affects only its financial partition and does not erase the execution response", async () => {
  execution.fills = null;
  Object.assign(execution, { terminal: true, complete: true, open: "0" });
  const result = await recoverPmGtc(request(), "owner");
  expect(result.executions).toEqual({ ok: true, rows: [execution] });
  expect(result.orders[0]).toMatchObject({ ok: false, ids: [id] });
});
