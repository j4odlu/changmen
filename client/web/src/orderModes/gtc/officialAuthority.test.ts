import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { createGtcPmOrderPolling } from "@/runtime/gtcOrderMonitor/pmPolling";
import { recoverMonitorRecords, resetMonitorRecovery } from "@/runtime/gtcOrderMonitor/recovery";
import { acceptGtc, captureGtcSession, currentGtc, flushGtcCopies, gtcProgress, initializeGtcState, mutateGtc, refreshGtcRecords, resetGtcState } from "./executionState";
import { pmGtcMonitorCardView } from "./monitorCardView";

const mocks = vi.hoisted(() => ({ command: vi.fn(), list: vi.fn(), monitor: vi.fn(), read: vi.fn(), cancel: vi.fn(), active: true }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => mocks.active }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => ({ accountId: 1, provider: "Polymarket", token: "test" }) }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", extensionPrefs: {} }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: new Map() }) }));
vi.mock("./api", () => ({ commandGtc: mocks.command, listGtc: mocks.list }));
vi.mock("./ordersApi", () => ({ loadGtcMonitorOrders: mocks.monitor }));
vi.mock("./recoveryApi", () => ({ resetGtcRecoveryApi: () => {}, recoverGtc: async (request: { discover: boolean; monitorIds: string[] }) => {
  const executionsTask = request.discover ? mocks.list().then((rows: GtcExecution[]) => ({ ok: true, rows })) : Promise.resolve(null);
  const ordersTask = request.monitorIds.length
    ? mocks.monitor().then((rows: unknown[]) => ({ ok: true, rows, ids: request.monitorIds, unchangedIds: [] })).catch((error: Error) => ({ ok: false, message: error.message, ids: request.monitorIds, unchangedIds: [] }))
    : Promise.resolve(null);
  const [executions, orders] = await Promise.all([executionsTask, ordersTask]);
  return { executions, orders: orders ? [orders] : [] };
} }));
vi.mock("./successMarkers", () => ({ markGtcSuccess: vi.fn() }));
vi.mock("@/shared/pmOrderDisplay", () => ({ formatPolymarketApiDecimal: (value: number) => String(value) }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcFacts: mocks.read, pmCancelOrder: mocks.cancel }));
const hash = `0x${"a".repeat(64)}`;
const plan = { source: "manual", playerId: 1, otherPlayerId: 0, otherProvider: "", shares: "10", tokenId: "token", orderHash: hash, betRowId: 2, target: "Home", otherTarget: "Away" } as GtcPlan;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const live = () => ({ order: { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() });
function filled() {
  return { order: { id: hash, original: "10", matched: "10", status: "MATCHED", tradeIds: ["trade"] }, fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER" as const, shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: Date.now() }], complete: true, observedAt: Date.now() };
}
let server: GtcExecution;
const polling = createGtcPmOrderPolling({ current: currentGtc, mutate: mutateGtc, captureCurrent: captureGtcSession, mark: vi.fn() });
beforeEach(() => {
  resetGtcState(); resetMonitorRecovery(); sessionStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers(); mocks.active = true;
  initializeGtcState("owner");
  server = createGtcExecution("original", "owner", "wallet", "maker", plan, Date.now());
  server = applyGtcCommand(server, { kind: "authorize_pm" }, Date.now());
  server = applyGtcCommand(server, { kind: "ack", state: "accepted", orderId: hash }, Date.now());
  server = mergeGtcFacts(server, live()); acceptGtc(server);
  mocks.list.mockImplementation(async () => [clone(server)]);
  mocks.monitor.mockResolvedValue([]);
  mocks.command.mockImplementation(async (row: GtcExecution, command: GtcCommand) => {
    if (row.revision !== server.revision)
      throw new Error("GTC 记录已更新");
    server = applyGtcCommand(server, command, Date.now()); return clone(server);
  });
  mocks.read.mockResolvedValue(live()); mocks.cancel.mockResolvedValue({ canceled: [hash] });
});
afterEach(() => { polling.reset(); resetGtcState(); resetMonitorRecovery(); sessionStorage.clear(); vi.useRealTimers(); });

it.each(["failure", "stalled"])("financial recovery %s cannot delay PM polling, official updates or cancellation", async (mode) => {
  if (mode === "failure")
    mocks.monitor.mockRejectedValue(new Error("monitor backend offline"));
  else mocks.monitor.mockImplementation(() => new Promise(() => {}));
  mocks.read.mockImplementation(async () => ({ ...live(), order: { ...live().order, status: "UNMATCHED" } }));
  const loop = createOrderMonitorLoop({ recover: recoverMonitorRecords, active: () => true, tick: () => { void polling.poll("original").catch(() => {}); } });
  try {
    loop.start(); await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(currentGtc("original")).toMatchObject({ order: { status: "UNMATCHED" }, observedAt: Date.now() });
    expect(gtcProgress.queryIssues.original).toBeUndefined();
    await polling.cancel("original");
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(expect.anything(), hash);
    expect(currentGtc("original")).toMatchObject({ terminal: true, open: "0" });
    expect(mocks.monitor.mock.calls.length).toBe(mode === "failure" ? 3 : 1);
  }
  finally { loop.stop(); }
});

it("adopts confirmed PM fills immediately despite a failed copy and ignores an older backend snapshot", async () => {
  mocks.read.mockResolvedValue(filled()); mocks.command.mockRejectedValue(new Error("backend unavailable"));
  await polling.poll("original");
  expect(currentGtc("original")).toMatchObject({ matched: "10", open: "0", terminal: true, complete: true });
  expect(gtcProgress.queryIssues.original).toBeUndefined(); expect(gtcProgress.saveIssues.original).toBeDefined();
  acceptGtc({ ...clone(server), revision: 100 });
  expect(currentGtc("original")).toMatchObject({ matched: "10", open: "0", terminal: true });
});
it("a stalled backend copy cannot hold either official status updates or cancellation", async () => {
  mocks.command.mockImplementation(() => new Promise(() => {}));
  mocks.read.mockResolvedValue({ ...live(), order: { ...live().order, status: "UNMATCHED" } });
  await polling.poll("original");
  await polling.cancel("original");
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(expect.anything(), hash);
  expect(currentGtc("original")).toMatchObject({ open: "0", terminal: true });
});
it("retries a committed copy after response loss with the refreshed durable revision and no PM resubmission", async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.command.mockImplementationOnce(async (row, command) => { await normal(row, command); throw new Error("response lost after commit"); });
  mocks.read.mockResolvedValue(filled()); await polling.poll("original");
  expect(currentGtc("original").matched).toBe("10");
  await vi.advanceTimersByTimeAsync(5000);
  expect(gtcProgress.saveIssues.original).toBeUndefined(); expect(server.matched).toBe("10");
  expect(mocks.list).toHaveBeenCalledWith(2); expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.command.mock.calls.every(([, command]) => !command.kind.startsWith("authorize"))).toBe(true);
});
it.each(["dispatching", "unknown"] as const)("allows manual cancellation of a recovered %s intent and deduplicates concurrent clicks", async (state) => {
  server.cancel = { commandId: "old", state, message: "pending" }; acceptGtc(server);
  let finish!: (value: { canceled: string[] }) => void;
  mocks.cancel.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = polling.cancel("original"); const duplicate = polling.cancel("original");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.cancel).toHaveBeenCalledOnce(); expect(pmGtcMonitorCardView(currentGtc("original")).canCancel).toBe(false);
  finish({ canceled: [hash] }); await Promise.all([first, duplicate]);
  expect(currentGtc("original")).toMatchObject({ terminal: true, open: "0" });
  expect(gtcProgress.cancelInFlight.original).toBeUndefined();
});
it("allows retry after PM transport failure and a successful LIVE query", async () => {
  mocks.cancel.mockRejectedValueOnce(new Error("PM timeout")); await polling.cancel("original");
  expect(pmGtcMonitorCardView(currentGtc("original"))).toMatchObject({ canCancel: true, cancelPending: true });
  await polling.cancel("original"); expect(mocks.cancel).toHaveBeenCalledTimes(2);
  expect(currentGtc("original").open).toBe("0");
});
it("keeps an official cancel acknowledgement effective when another page updated the cancellation intent", async () => {
  mocks.cancel.mockImplementation(async () => {
    server.cancel = { commandId: "another-page", state: "dispatching", message: "pending" }; server.revision++;
    acceptGtc(clone(server)); return { canceled: [hash] };
  });
  await polling.cancel("original");
  expect(currentGtc("original")).toMatchObject({ open: "0", terminal: true });
});
it("restores an unsaved official result across a same-owner restart and then synchronizes it", async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.read.mockResolvedValue(filled()); mocks.command.mockRejectedValue(new Error("offline"));
  await polling.poll("original"); resetGtcState(); initializeGtcState("owner");
  expect(currentGtc("original").matched).toBe("10");
  mocks.command.mockImplementation(normal); await flushGtcCopies("original", true);
  expect(server.matched).toBe("10"); expect(gtcProgress.saveIssues.original).toBeUndefined();
  expect(sessionStorage.getItem("PM_GTC_RESULT_COPIES:owner")).toBeNull();
});
it("does not send former-owner pending copies or accept late write responses in a new session", async () => {
  let finish!: (row: GtcExecution) => void;
  mocks.command.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mocks.read.mockResolvedValue(filled()); await polling.poll("original");
  resetGtcState(); initializeGtcState("another-owner");
  finish(clone(server)); await vi.advanceTimersByTimeAsync(10000);
  expect(gtcProgress.records).toEqual([]); expect(gtcProgress.saveIssues).toEqual({});
  expect(mocks.command).toHaveBeenCalledOnce();
});
it("keeps irreversible dispatch authorization dependent on persistence", async () => {
  const prepared = createGtcExecution("original", "owner", "wallet", "maker", plan, Date.now());
  resetGtcState(); initializeGtcState("owner"); acceptGtc(prepared);
  mocks.command.mockRejectedValue(new Error("authorization unavailable"));
  await expect(mutateGtc("original", { kind: "authorize_pm" })).rejects.toThrow("authorization unavailable");
  expect(currentGtc("original").pmAuthorized).toBe(false);
});
it("a failed accepted-ack copy cannot turn an explicit official acceptance into unknown", async () => {
  server.submit = "dispatching"; server.orderId = null; server.revision++;
  acceptGtc(server); mocks.command.mockRejectedValue(new Error("ack save failed"));
  await mutateGtc("original", { kind: "ack", state: "accepted", orderId: hash });
  await mutateGtc("original", { kind: "close" });
  expect(currentGtc("original")).toMatchObject({ submit: "accepted", orderId: hash, decision: "closed" });
  acceptGtc({ ...clone(server), revision: 100 });
  expect(currentGtc("original")).toMatchObject({ submit: "accepted", orderId: hash });
});
it("concurrent dispatch requests still receive only one durable authorization", async () => {
  resetGtcState(); initializeGtcState("owner");
  server = createGtcExecution("original", "owner", "wallet", "maker", plan, Date.now()); acceptGtc(server);
  const results = await Promise.allSettled([mutateGtc("original", { kind: "authorize_pm" }), mutateGtc("original", { kind: "authorize_pm" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(mocks.command).toHaveBeenCalledOnce();
});
it("incremental discovery uses only persisted revisions and retains unchanged local records", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  resetGtcState(); initializeGtcState("owner"); server = { ...clone(server), id }; acceptGtc(server);
  mocks.list.mockResolvedValue([]); await refreshGtcRecords();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(undefined, { [id]: server.revision });
  expect(currentGtc(id).orderId).toBe(hash);
});

it("a minute of unchanged PM polls updates observedAt without any background writes", async () => {
  mocks.read.mockImplementation(async () => live());
  const revision = server.revision;
  for (let poll = 0; poll < 12; poll++) {
    await vi.advanceTimersByTimeAsync(5000); await polling.poll("original");
  }
  expect(mocks.read).toHaveBeenCalledTimes(12); expect(mocks.command).not.toHaveBeenCalled();
  expect(currentGtc("original").observedAt).toBe(Date.now()); expect(server.revision).toBe(revision);
});
it("saves an initial snapshot once and then only meaningful order transitions", async () => {
  server.order = null; server.complete = false; server.observedAt = 0; acceptGtc(server);
  mocks.read.mockImplementation(async () => live());
  await polling.poll("original"); await flushGtcCopies("original");
  for (let poll = 0; poll < 5; poll++) {
    await vi.advanceTimersByTimeAsync(5000); await polling.poll("original");
  }
  expect(mocks.command).toHaveBeenCalledOnce();
  mocks.read.mockResolvedValue({ ...live(), order: { ...live().order, status: "DELAYED" } });
  await polling.poll("original"); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledTimes(2); expect(server).toMatchObject({ order: { status: "DELAYED" } });
  mocks.read.mockResolvedValue(live()); await polling.poll("original"); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledTimes(3); expect(server).toMatchObject({ order: { status: "LIVE" } });
});
it("ignores fill and trade-ID array ordering but saves fee and confirmation changes", async () => {
  const evidence = filled();
  evidence.order.tradeIds = ["trade-a", "trade-b"];
  evidence.fills = ["a", "b"].map(key => ({ ...evidence.fills[0]!, key, tradeId: `trade-${key}`, shares: "5" }));
  server = mergeGtcFacts(server, evidence); server.counted = true; acceptGtc(server);
  const reversed = { ...clone(evidence), order: { ...evidence.order, tradeIds: [...evidence.order.tradeIds].reverse() }, fills: [...evidence.fills].reverse() };
  mocks.read.mockResolvedValue(reversed); await polling.poll("original");
  expect(mocks.command).not.toHaveBeenCalled();
  const feeChanged = clone(reversed); feeChanged.fills[0]!.fee = "0.01";
  mocks.read.mockResolvedValue(feeChanged); await polling.poll("original"); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledOnce(); expect(server.fee).toBe("0.01");
  const failed = clone(feeChanged); failed.fills[0]!.status = "FAILED";
  mocks.read.mockResolvedValue(failed); await polling.poll("original"); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledTimes(2);
  expect(Object.values(server.fills).some(fill => fill.status === "FAILED")).toBe(true);
});
it("does not enqueue duplicate snapshots while a previous copy response is stalled", async () => {
  const normal = mocks.command.getMockImplementation()!;
  let finish!: () => void;
  mocks.command.mockImplementationOnce(async (row, command) => {
    const result = await normal(row, command); await new Promise<void>((resolve) => { finish = resolve; }); return result;
  });
  mocks.read.mockImplementation(async () => ({ ...live(), order: { ...live().order, status: "UNMATCHED" } }));
  for (let poll = 0; poll < 6; poll++) {
    await polling.poll("original"); await vi.advanceTimersByTimeAsync(5000);
  }
  expect(mocks.command).toHaveBeenCalledOnce(); finish(); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledOnce();
});
it("backs off at 5/10/20/40/60 seconds while changing PM data continues to update locally", async () => {
  const started = Date.now(); const requests: number[] = [];
  mocks.command.mockImplementation(async () => { requests.push(Date.now() - started); throw new Error("offline"); });
  let snapshots = 0;
  mocks.read.mockImplementation(async () => ({ ...live(), order: { ...live().order, status: snapshots++ % 2 ? "DELAYED" : "UNMATCHED" } }));
  await polling.poll("original"); let attempts = 1;
  for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
    for (let elapsed = 5000; elapsed < delay; elapsed += 5000) {
      await vi.advanceTimersByTimeAsync(5000); await polling.poll("original");
      expect(mocks.command).toHaveBeenCalledTimes(attempts);
    }
    await vi.advanceTimersByTimeAsync(5000); await polling.poll("original"); attempts++;
    expect(mocks.command).toHaveBeenCalledTimes(attempts);
    expect(currentGtc("original").order?.status).toBe(snapshots % 2 ? "UNMATCHED" : "DELAYED");
  }
  expect(requests).toEqual([0, 5000, 15000, 35000, 75000, 135000, 195000]);
  expect(mocks.read.mock.calls.length).toBeGreaterThan(30);
});
it("resets backoff after success so a new official change saves immediately", async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.read.mockImplementation(async () => ({ ...live(), order: { ...live().order, status: "UNMATCHED" } }));
  mocks.command.mockRejectedValue(new Error("offline")); await polling.poll("original");
  await vi.advanceTimersByTimeAsync(5000); expect(mocks.command).toHaveBeenCalledTimes(2);
  mocks.command.mockImplementation(normal); await vi.advanceTimersByTimeAsync(10000);
  expect(gtcProgress.saveIssues.original).toBeUndefined(); expect(server.order?.status).toBe("UNMATCHED");
  mocks.read.mockResolvedValue(live()); await polling.poll("original"); await flushGtcCopies("original");
  expect(mocks.command).toHaveBeenCalledTimes(4); expect(server.order?.status).toBe("LIVE");
});
it("preserves retry deadlines across a same-owner restart", async () => {
  mocks.read.mockImplementation(async () => ({ ...live(), order: { ...live().order, status: "UNMATCHED" } }));
  mocks.command.mockRejectedValue(new Error("offline")); await polling.poll("original");
  await vi.advanceTimersByTimeAsync(5000); expect(mocks.command).toHaveBeenCalledTimes(2);
  resetGtcState(); initializeGtcState("owner");
  await vi.advanceTimersByTimeAsync(5000); await polling.poll("original");
  expect(mocks.command).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000); expect(mocks.command).toHaveBeenCalledTimes(3);
});
it("lets critical cancellation events save immediately despite a failed polling copy", async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.command.mockImplementation(async (row, command) => {
    if (command.kind === "facts")
      throw new Error("copy unavailable");
    return normal(row, command);
  });
  mocks.read.mockResolvedValue({ ...live(), order: { ...live().order, status: "UNMATCHED" } });
  mocks.cancel.mockResolvedValue({ not_canceled: { [hash]: "still processing" } });
  const at = Date.now(); await polling.poll("original"); await polling.cancel("original");
  await vi.advanceTimersByTimeAsync(0);
  expect(Date.now()).toBe(at); expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.command.mock.calls.some(([, command]) => command.kind === "cancel")).toBe(true);
  expect(mocks.command.mock.calls.some(([, command]) => command.kind === "cancel_result")).toBe(true);
});
it("keeps retries independent per execution so one failed copy does not delay another", async () => {
  const otherHash = `0x${"b".repeat(64)}`;
  const other = { ...clone(server), id: "second", orderId: otherHash, plan: { ...plan, orderHash: otherHash }, order: { ...server.order!, id: otherHash } };
  acceptGtc(other);
  mocks.command.mockImplementation(async (row: GtcExecution, command: GtcCommand) => {
    if (row.id === "original")
      throw new Error("one execution unavailable");
    return applyGtcCommand(clone(row), command, Date.now());
  });
  await mutateGtc("original", { kind: "facts", facts: { ...live(), order: { ...live().order, status: "UNMATCHED" } } });
  await mutateGtc("second", { kind: "facts", facts: { ...live(), order: { ...live().order, id: otherHash, status: "UNMATCHED" } } });
  await flushGtcCopies("second"); expect(currentGtc("second").order?.status).toBe("UNMATCHED");
  expect(gtcProgress.saveIssues.second).toBeUndefined(); expect(gtcProgress.saveIssues.original).toBeDefined();
  await vi.advanceTimersByTimeAsync(4999); expect(mocks.command).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(mocks.command).toHaveBeenCalledTimes(3);
});
it("reads back a committed but lost copy response without writing the same facts again", async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.command.mockImplementationOnce(async (row, command) => { await normal(row, command); throw new Error("lost response"); });
  mocks.read.mockResolvedValue({ ...live(), order: { ...live().order, status: "UNMATCHED" } });
  await polling.poll("original"); await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.command).toHaveBeenCalledOnce(); expect(gtcProgress.saveIssues.original).toBeUndefined();
});
