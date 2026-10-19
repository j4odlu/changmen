/** [changmen 扩展] 真实首单 → PM polling → adapter，在模拟 HTTP 和可控时钟下验证首腿受理后第二腿发送不依赖原单核对。 */
import type { GtcCommand, GtcPlan } from "@changmen/shared/pm_gtc";
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { startPmGtcMonitoring, stopPmGtcMonitoring } from "@/runtime/gtcOrderMonitor/pm";
import { executeGtc } from "@/test/executeOriginalPair";
import { currentGtc, gtcInitialDispatches, gtcProgress, initializeGtcState, resetGtcState } from "./executionState";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  other: vi.fn(),
  settle: vi.fn(),
  getOrder: vi.fn(),
  trades: vi.fn(),
  accounts: [] as PlatformAccount[],
  trace: [] as Array<[string, number]>,
  orderMs: 100,
  historyMs: 200,
  remaining: 250,
  quantity: "10",
  failHistory: false,
}));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", config: { betting: true } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ refreshBalance: vi.fn(), findAccount: (id: number) => mocks.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@changmen/client-core/models/betResult", () => ({ BetResult: class { orderId = null; constructor(public provider: string, public success: boolean) {} saveLog() {} } }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetPhase: vi.fn(), syncActiveBetLeg: vi.fn(), syncActiveBetPlaceResults: vi.fn(), syncActiveBetLegSettleResult: vi.fn() }));
vi.mock("@/stores/betting/autoBet/retryFailedLeg", () => ({ retryFailedLeg: vi.fn(() => { throw new Error("unexpected retry"); }) }));
vi.mock("@/stores/betting/autoBet/makeUp", () => ({ enqueueMakeUpOrder: vi.fn(() => { throw new Error("unexpected makeup"); }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/services/bettingLog", () => ({ saveVenueSettlementLog: vi.fn() }));
vi.mock("@/services/orderExecutionObservation", () => ({ observeArbSubmissionBlocked: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbLegOrder: vi.fn(), resolveArbBindOrderId: vi.fn() }));
vi.mock("@/stores/betting/pendingOrderBind", () => ({ enqueuePendingOrderBind: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: vi.fn(() => { throw new Error("unexpected FOK settlement"); }) }));
vi.mock("@/stores/betting/autoBet/rejectWait", () => ({ maxLegRejectWaitSec: vi.fn(), showRejectDetectionTip: vi.fn() }));
vi.mock("@/shared/betNotification", () => ({ notifyBet: async (_account: unknown, _option: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("./gateway", () => ({ prepareOtherLeg: (...args: unknown[]) => () => mocks.other(...args) }));
vi.mock("./otherOrders", () => ({ settleGtcOtherLeg: mocks.settle }));
vi.mock("./api", () => ({
  createGtc: async (id: string, maker: string, plan: GtcPlan) => {
    return createGtcExecution(id, "owner", "wallet", maker, plan, Date.now());
  },
  commandGtc: async (row: Parameters<typeof applyGtcCommand>[0], command: GtcCommand) => applyGtcCommand(structuredClone(JSON.parse(JSON.stringify(row))), command, Date.now()),
}));
vi.mock("./runtime", async () => ({
  ...await import("./executionState"),
  pollGtc: (await import("@/runtime/gtcOrderMonitor/pm")).pollGtc,
  startGtcRuntime: vi.fn(),
  pollGtcOther: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/runtime/gtcOrderMonitor/recovery", () => ({ recoverMonitorRecords: async () => {} }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ recordPmExecutionMetric: vi.fn(), observePolymarketOrderWatch: () => () => {} }));
// [changmen 扩展] 仅模拟公开 HTTP 边界，保留真实 PM 查询、分页与 transport；未知请求直接失败。
vi.mock("@changmen/client-core/shared/platformHttp", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/client-core/shared/platformHttp")>(),
  changmenPmEsportCall: (action: string, body: { playerId?: number; orderId?: string }) => {
    if (action !== "Pm_GetOrder" || body.playerId !== 1 || body.orderId !== "pm-original")
      throw new Error(`Unexpected PM API request: ${action}`);
    return mocks.getOrder();
  },
  changmenPmHttpRequest: async (request: { method: string; url: string; playerId?: number; l2Path?: string }) => {
    if (request.method !== "GET" || request.playerId !== 1 || request.l2Path !== "/data/trades" || new URL(request.url).pathname !== "/data/trades")
      throw new Error(`Unexpected PM HTTP request: ${request.method} ${request.url}`);
    return { status: 200, text: JSON.stringify(await mocks.trades()) };
  },
}));
vi.mock("@changmen/client-core/shared/http", () => ({
  directGet: (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/data/order/pm-original")
      return mocks.getOrder();
    if (path === "/data/trades")
      return mocks.trades();
    throw new Error(`Unexpected PM direct GET: ${url}`);
  },
  directPostJson: () => { throw new Error("Unexpected PM direct POST"); },
  directDeleteJson: () => { throw new Error("Unexpected PM direct DELETE"); },
}));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/venue-browser/polymarket/gtc/index")>(),
  pmSubmitMaker: () => "maker",
  prepareGtcBuy: async () => ({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, orderHash: "pm-original", route: "direct", prepareSubmit: async () => {}, validate() {}, submit: mocks.submit }),
}));

function inputs(pmFirst = true, parallel = false) {
  const pm = { type: "Polymarket", betMoney: 5, odds: 2, betId: "condition", itemId: "token", target: "Home", data: {} };
  const other = { type: "RAY", betMoney: 33.5, odds: 2, matchId: "match", itemId: "away", target: "Away", data: {} };
  return {
    params: { match: { id: 1, title: "match" }, bet: { id: 2, getBetName: () => "market" }, config: { profit: 0.99, betSorting: parallel ? "Parallel" : "Auto" } } as ArbBetAttemptParams,
    checked: { betBothLegs: true, singleLegByRate: false, legA: pmFirst ? pm : other, legB: pmFirst ? other : pm, accountA: mocks.accounts[pmFirst ? 0 : 1], accountB: mocks.accounts[pmFirst ? 1 : 0], waitSec: 30, linkId: 3 } as ArbBetChecked,
  };
}
async function finishAttempt(task: ReturnType<typeof executeGtc>) {
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(10000 - mocks.remaining);
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(30000);
  return task;
}
beforeEach(async () => {
  await import("@changmen/venue-browser/polymarket/gtc/index");
  stopPmGtcMonitoring(); resetGtcState(); initializeGtcState("owner"); vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); sessionStorage.clear();
  mocks.trace = []; mocks.orderMs = 100; mocks.historyMs = 200; mocks.remaining = 250; mocks.quantity = "10"; mocks.failHistory = false;
  mocks.accounts = [new PlatformAccount({ accountId: 1, provider: "Polymarket", playerName: "PM" }), new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" })];
  mocks.submit.mockImplementation(async () => {
    mocks.trace.push(["submit", Date.now()]);
    await new Promise(r => setTimeout(r, 10000 - mocks.remaining));
    return { success: true, orderID: "pm-original" };
  });
  mocks.other.mockImplementation(async () => { mocks.trace.push(["other", Date.now()]); return { provider: "RAY", success: true, orderId: "ray-original" }; });
  mocks.settle.mockResolvedValue({ rejected: false, pendingConfirm: false, orders: [{ provider: "RAY", orderId: "ray-original", status: "none" }] });
  mocks.getOrder.mockImplementation(async () => {
    mocks.trace.push(["order", Date.now()]);
    await new Promise(r => setTimeout(r, mocks.orderMs));
    return { id: "pm-original", asset_id: "token", side: "BUY", original_size: "10", size_matched: mocks.quantity, status: mocks.quantity === "10" ? "MATCHED" : "LIVE", associate_trades: mocks.quantity === "0" ? [] : ["trade"] };
  });
  mocks.trades.mockImplementation(async () => {
    mocks.trace.push(["trades", Date.now()]);
    await new Promise(r => setTimeout(r, mocks.historyMs));
    if (mocks.failHistory)
      throw new Error("Network Error");
    return { data: mocks.quantity === "0" ? [] : [{ id: "trade", taker_order_id: "unrelated", asset_id: "token", side: "SELL", size: mocks.quantity, price: "0.5", status: "CONFIRMED", last_update: "10", maker_orders: [{ order_id: "pm-original", asset_id: "token", side: "BUY", matched_amount: mocks.quantity, price: "0.5" }] }], next_cursor: "LTE=" };
  });
  gtcProgress.ready = true;
});
afterEach(() => { stopPmGtcMonitoring(); resetGtcState(); vi.useRealTimers(); });

it.each([-1000, 0, 249, 250, 300, 301])("PM-first acceptance sends the original other leg even with %sms on the historical clock", async (remaining) => {
  mocks.remaining = remaining;
  const { params, checked } = inputs(); const task = executeGtc(params, checked);
  await finishAttempt(task);
  expect(mocks.other).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.trace[0]).toEqual(["submit", 0]);
  expect(mocks.trace[1]).toEqual(["other", 10000 - remaining]);
  expect(mocks.trace.filter(([name]) => name === "order" || name === "trades")).toEqual([["order", 10000 - remaining], ["trades", 10100 - remaining]]);
  expect(currentGtc(gtcProgress.records[0]!.id).decision).toBe("closed");
  expect(gtcInitialDispatches.size).toBe(0);
});
it.each(["0", "5"])("PM-first acceptance sends the original other quantity without waiting for %s shares", async (quantity) => {
  mocks.quantity = quantity; mocks.remaining = 1000;
  const { params, checked } = inputs(); const task = executeGtc(params, checked);
  await finishAttempt(task);
  expect(mocks.other).toHaveBeenCalledExactlyOnceWith(mocks.accounts[1], expect.objectContaining({ betMoney: 33.5, deferPostAcceptSettlement: true }), 3, checked.waitSec);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(gtcProgress.records[0]!.matched).toBe(quantity); expect(gtcProgress.records[0]!.groupComplete).toBe(false);
});
it("a failed order-history query preserves both submissions and records only a query issue", async () => {
  mocks.failHistory = true; mocks.remaining = 1000;
  const { params, checked } = inputs(); const task = executeGtc(params, checked);
  await finishAttempt(task);
  expect(gtcProgress.records[0]!.submit).toBe("accepted"); expect(mocks.other).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
  expect(gtcProgress.queryIssues[gtcProgress.records[0]!.id]?.message).toBe("Network Error");
});
it.each([[false, false], [true, true]])("other-first/parallel sends each original once (%s, %s)", async (pmFirst, parallel) => {
  const { params, checked } = inputs(pmFirst, parallel); const task = executeGtc(params, checked);
  await finishAttempt(task);
  expect(mocks.other).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.settle).toHaveBeenCalledOnce();
});
it("an overlapping background tick cannot query or close the first attempt before its other POST", async () => {
  mocks.submit.mockImplementationOnce(async () => {
    await new Promise(r => setTimeout(r, 10000 - mocks.remaining));
    startPmGtcMonitoring(); await vi.dynamicImportSettled();
    return { success: true, orderID: "pm-original" };
  });
  const { params, checked } = inputs(); const task = executeGtc(params, checked);
  await finishAttempt(task);
  expect(mocks.trace.filter(([name]) => name === "order" || name === "trades")).toEqual([["order", 9750], ["trades", 9850]]);
  expect(mocks.other).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
});
it("the real coordinator cannot expire a slow active first dispatch, but still closes abandoned records", async () => {
  const coordinator = await vi.importActual<typeof import("./runtime")>("./runtime");
  mocks.remaining = -1000;
  coordinator.startGtcCoordinator();
  try {
    const { params, checked } = inputs(); const task = executeGtc(params, checked);
    await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(10500);
    expect(currentGtc(gtcProgress.records[0]!.id).decision).toBe("open");
    expect(mocks.other).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500); await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(30300); await task;
    expect(mocks.other).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
    const abandoned = createGtcExecution("abandoned", "owner", "wallet", "maker", gtcProgress.records[0]!.plan, 0);
    (await import("./executionState")).acceptGtc(abandoned);
    await vi.advanceTimersByTimeAsync(5000);
    expect(currentGtc("abandoned").decision).toBe("closed");
  }
  finally { coordinator.stopGtcCoordinator(); }
});
