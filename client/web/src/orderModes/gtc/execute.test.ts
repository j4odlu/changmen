import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { wait } from "@changmen/client-core/shared/wait";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentArbExecution } from "@/orderModes/gtc/presentation";
import { syncActiveBetFail, syncActiveBetLeg, syncActiveBetPhase, syncActiveBetPlaceResults } from "@/stores/betting/activeBetRunSync";
import { showRejectDetectionTip } from "@/stores/betting/autoBet/rejectWait";
import { executeGtc } from "@/test/executeOriginalPair";
import { prepareGtcLegExecution } from "./arbLeg";
import { markGtcSuccess } from "./successMarkers";
import * as pmOrders from "@changmen/venue-adapter/polymarket/orders";

const notices = vi.hoisted(() => ({ notify: vi.fn(), close: vi.fn() }));
vi.mock("element-plus", () => ({ ElNotification: notices.notify }));

const mocks = vi.hoisted(() => ({ submit: vi.fn(), prepareSubmit: vi.fn(), betting: vi.fn(), prepare: vi.fn(), settle: vi.fn(), create: vi.fn(), refresh: vi.fn(), poll: vi.fn(), otherPoll: vi.fn(), count: vi.fn(), log: vi.fn(), ratio: 0.99, record: null as GtcExecution | null, existing: [] as GtcExecution[], initial: "0", ready: true, owner: "owner", commands: [] as GtcCommand[], error: "", failAuthorization: "" }));
vi.mock("@changmen/client-core/models/betResult", () => ({ BetResult: class { orderId = null; constructor(public provider: string, public success: boolean) {} saveLog = mocks.log; } }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.owner, config: { betting: true } }) }));
vi.mock("./gateway", () => ({ prepareOtherLeg: (...args: unknown[]) => () => mocks.betting(...args) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ recordPmExecutionMetric: vi.fn(), validatePolymarketPreparedBuy: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ refreshBalance: vi.fn() }) }));
vi.mock("@/stores/betting/autoBet/retryFailedLeg", () => ({ retryFailedLeg: vi.fn(() => { throw new Error("unexpected retry"); }) }));
vi.mock("@/stores/betting/autoBet/makeUp", () => ({ enqueueMakeUpOrder: vi.fn(() => { throw new Error("unexpected makeup"); }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/services/bettingLog", () => ({ saveVenueSettlementLog: vi.fn() }));
vi.mock("@/services/orderExecutionObservation", () => ({ observeArbSubmissionBlocked: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbLegOrder: vi.fn(), resolveArbBindOrderId: vi.fn() }));
vi.mock("@/stores/betting/pendingOrderBind", () => ({ enqueuePendingOrderBind: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: vi.fn(() => { throw new Error("unexpected FOK settlement"); }) }));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait: vi.fn(async () => {}) }));
vi.mock("@/stores/betting/autoBet/rejectWait", () => ({ maxLegRejectWaitSec: vi.fn(), showRejectDetectionTip: vi.fn() }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetPhase: vi.fn(), syncActiveBetFail: vi.fn(), syncActiveBetLeg: vi.fn(), syncActiveBetPlaceResults: vi.fn(), syncActiveBetLegSettleResult: vi.fn(), scheduleActiveBetRunRemoval: vi.fn() }));
vi.mock("./otherOrders", () => ({ settleGtcOtherLeg: mocks.settle }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.count }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ prepareGtcBuy: mocks.prepare, pmSubmitMaker: () => "maker" }));
vi.mock("./api", () => ({ createGtc: mocks.create }));
vi.mock("./runtime", () => ({
  startGtcRuntime: vi.fn(), beginGtcInitialDispatch: () => vi.fn(),
  refreshGtcRecords: mocks.refresh,
  markGtcLegOnce: mocks.count,
  gtcProgress: { get ready() { return mocks.ready; }, get records() { return [...mocks.existing, ...(mocks.record ? [mocks.record] : [])]; } },
  acceptGtc: (row: GtcExecution) => { mocks.record = row; return row; },
  currentGtc: () => mocks.record!,
  mutateGtc: async (_id: string, command: GtcCommand) => { mocks.commands.push(command); if (command.kind === mocks.failAuthorization) throw new Error("授权失败"); mocks.record = applyGtcCommand(mocks.record!, command, Date.now()); return mocks.record; },
  pollGtc: mocks.poll,
  pollGtcOther: mocks.otherPoll,
}));
const hash = `0x${"a".repeat(64)}`;
function checked(pmFirst = true, parallel = false) {
  const pm = { type: "Polymarket", betMoney: 5, odds: 2, betId: "condition", itemId: "token", target: "Home", data: {} };
  const other = { type: "RAY", betMoney: 33.5, odds: 2, matchId: "match", itemId: "away", target: "Away", data: {} };
  return { betBothLegs: true, singleLegByRate: false, legA: pmFirst ? pm : other, legB: pmFirst ? other : pm, accountA: { accountId: pmFirst ? 1 : 2, provider: pmFirst ? "Polymarket" : "RAY" }, accountB: { accountId: pmFirst ? 2 : 1, provider: pmFirst ? "RAY" : "Polymarket" }, waitSec: 30, linkId: 3, parallel } as never;
}
function params(parallel = false) {
  return { match: { id: 1, title: "match" }, bet: { id: 2, getBetName: () => "market" }, config: { profit: mocks.ratio, betSorting: parallel ? "Parallel" : "Auto" }, setMessage: vi.fn(), trace: { finish: vi.fn(), event: vi.fn() } } as never;
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); mocks.record = null; mocks.existing = []; mocks.commands = []; mocks.initial = "0"; mocks.ready = true; mocks.ratio = 0.99;
  mocks.failAuthorization = "";
  mocks.prepareSubmit.mockResolvedValue(undefined);
  notices.notify.mockReturnValue({ close: notices.close });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.otherPoll.mockResolvedValue([]);
  mocks.prepare.mockResolvedValue({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", feeProof: { rate: "0", exponent: 1, takerOnly: true, observedAt: 1 }, protocol: 2, negRisk: false, orderHash: hash, route: "direct", submit: mocks.submit, prepareSubmit: mocks.prepareSubmit, validate: () => {} });
  mocks.submit.mockResolvedValue({ success: true, orderID: hash, status: "live" });
  mocks.betting.mockResolvedValue({ provider: "RAY", success: true, pending: false, orderId: "ray-order" });
  mocks.create.mockImplementation(async (id: string, maker: string, plan: GtcPlan) => createGtcExecution(id, "owner", "wallet", maker, plan, Date.now()));
  mocks.poll.mockImplementation(async () => {
    const quantity = mocks.initial;
    mocks.record = mergeGtcFacts(mocks.record!, { order: { id: hash, original: "10", matched: quantity, status: quantity === "10" ? "MATCHED" : "LIVE", tradeIds: quantity === "0" ? [] : ["trade"] }, fills: quantity === "0" ? [] : [{ key: "trade:taker", tradeId: "trade", bucket: "taker", role: "TAKER", shares: quantity, price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: Date.now() }], complete: true, observedAt: Date.now() });
    return mocks.record;
  });
  mocks.settle.mockResolvedValue({ rejected: false, pendingConfirm: false, orders: [{ provider: "RAY", orderId: "ray-order", status: "none" }] });
});
describe("gTC original pair orchestration", () => {
  it("stores PM's native full-match label while retaining the decider row for orchestration", async () => {
    const label = vi.spyOn(pmOrders, "lookupPolymarketOrderBetLabel").mockReturnValueOnce("全场");
    const input = params() as unknown as Parameters<typeof prepareGtcLegExecution>[0];
    input.bet.getBetName = () => "[地图3] 获胜";
    await prepareGtcLegExecution(input, checked());
    expect(label).toHaveBeenCalledWith("condition", "token");
    expect(mocks.record!.plan).toMatchObject({ bet: "全场", betRowId: 2, conditionId: "condition", tokenId: "token" });
    expect(input.bet.getBetName()).toBe("[地图3] 获胜");
    label.mockRestore();
  });
  it("does not save the composer map label when native PM metadata is unavailable", async () => {
    const label = vi.spyOn(pmOrders, "lookupPolymarketOrderBetLabel").mockReturnValueOnce("");
    const input = params() as unknown as Parameters<typeof prepareGtcLegExecution>[0];
    input.bet.getBetName = () => "[地图3] 获胜";
    await prepareGtcLegExecution(input, checked());
    expect(mocks.record!.plan.bet).toBe("盘口待核实");
    expect(mocks.submit).not.toHaveBeenCalled();
    label.mockRestore();
  });
  it.each([true, false])("gTC keeps rejection remedies disabled while retaining original-order polling when pmFirst=%s", async (pmFirst) => {
    const lifecycle = await prepareGtcLegExecution(params(), checked(pmFirst));
    expect(lifecycle.actions).toEqual({ retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false });
    expect(mocks.betting).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
  });
  it.each(["0", "5", "10"])("PM-first acceptance sends the other leg once before querying its %s-share result", async (quantity) => {
    mocks.initial = quantity;
    mocks.betting.mockImplementationOnce(async () => {
      expect(mocks.poll).not.toHaveBeenCalled();
      return { provider: "RAY", success: true, orderId: "ray-order" };
    });
    await executeGtc(params(), checked());
    expect(mocks.betting).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.poll).toHaveBeenCalledOnce();
    expect(mocks.commands.filter(command => command.kind === "authorize_other")).toHaveLength(1);
  });
  it("renews PM submission readiness after RAY accepts and before authorizing the original PM order", async () => {
    const calls: string[] = [];
    mocks.betting.mockImplementationOnce(async () => {
      calls.push("RAY accepted");
      return { provider: "RAY", success: true, orderId: "ray-order" };
    });
    mocks.prepareSubmit.mockImplementation(async () => {
      expect(mocks.record?.pmAuthorized).not.toBe(true);
      calls.push("PM clock ready");
    });
    mocks.submit.mockImplementationOnce(async () => {
      expect(mocks.record?.pmAuthorized).toBe(true);
      calls.push("PM submit");
      return { success: true, orderID: hash };
    });
    await executeGtc(params(), checked(false));
    expect(calls).toEqual(["PM clock ready", "RAY accepted", "PM clock ready", "PM submit"]);
    expect(mocks.prepareSubmit).toHaveBeenCalledTimes(2); expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.record?.submit).toBe("accepted");
    expect(mocks.create.mock.calls[0]?.[2]).not.toHaveProperty("prepareSubmit");
  });
  it("a post-submission query failure cannot prevent the second leg or trigger a duplicate POST", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("Network Error"));
    const result = await executeGtc(params(), checked());
    expect(mocks.betting).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
    expect(result.pm.submission).toBe("accepted"); expect(result.groupComplete).toBe(false);
  });

  it.each(["prepare", "authorize", "consume"])("RAY 首腿成功，PM 第二腿 %s 异常仍核对首腿并正常收尾", async (stage) => {
    if (stage === "prepare") mocks.prepareSubmit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("冻结签单失效"));
    if (stage === "authorize") mocks.failAuthorization = "authorize_pm";
    if (stage === "consume") mocks.submit.mockResolvedValueOnce({ success: false, pmSubmitNotSent: true, errorMsg: "签单已消费，未发送" });
    const result = await executeGtc(params(), checked(false));
    expect(result).toMatchObject({ pm: { submission: "not_attempted", orderId: null }, other: { submission: "accepted", orderId: "ray-order", fill: "full" }, responsibility: "manual" });
    expect(mocks.settle).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
    if (stage !== "consume") expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.record).toMatchObject({ decision: "closed", submitNotSent: true });
    expect(syncActiveBetPlaceResults).toHaveBeenCalledWith(2, expect.objectContaining({ success: true }), expect.objectContaining({ success: false, pmSubmitUnknown: false }), true, true, "filled_pending_settle", "api_failed", undefined);
  });

  it.each(["validate", "authorize"])("PM 首腿已受理，第二腿 %s 异常仍核对 PM 并正常收尾", async (stage) => {
    const pair = checked() as ArbBetChecked;
    if (stage === "validate") mocks.submit.mockImplementationOnce(async () => { pair.legB.data = null; return { success: true, orderID: hash }; });
    else mocks.failAuthorization = "authorize_other";
    const result = await executeGtc(params(), pair);
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).not.toHaveBeenCalled();
    expect(mocks.poll).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ pm: { submission: "accepted", orderId: hash }, other: { submission: "not_attempted" }, responsibility: "manual" });
    expect(mocks.record).toMatchObject({ decision: "closed", other: { notSent: true, orderId: null } });
  });

  it("时钟准备失败发生在首腿发送之前，不创建占位执行", async () => {
    mocks.prepareSubmit.mockRejectedValueOnce(new Error("时钟未就绪"));
    await expect(executeGtc(params(), checked(false))).rejects.toThrow("时钟未就绪");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("首腿日志抛错保留已受理回执并发送第二腿", async () => {
    mocks.log.mockImplementationOnce(() => { throw new Error("日志不可用"); });
    const result = await executeGtc(params(), checked());
    expect(result.pm.submission).toBe("accepted"); expect(mocks.betting).toHaveBeenCalledOnce();
  });
  it("矛盾的未发送标记不能覆盖真实 PM 受理回执", async () => {
    mocks.submit.mockResolvedValueOnce({ success: true, orderID: hash, pmSubmitNotSent: true });
    const result = await executeGtc(params(), checked());
    expect(result.pm).toMatchObject({ submission: "accepted", orderId: hash });
    expect(mocks.betting).toHaveBeenCalledOnce(); expect(mocks.record?.submitNotSent).not.toBe(true);
  });
  it("shared settle restores one countdown and one wait before fresh original rejection confirmation", async () => {
    mocks.initial = "5";
    let release!: () => void;
    vi.mocked(wait).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    mocks.settle.mockResolvedValueOnce({ rejected: true, pendingConfirm: false, orders: [{ provider: "RAY", orderId: "ray-order", status: "reject" }] });
    const task = executeGtc(params(), checked());
    await vi.waitFor(() => expect(wait).toHaveBeenCalledExactlyOnceWith(30_000));
    expect(showRejectDetectionTip).toHaveBeenCalledExactlyOnceWith(30);
    expect(syncActiveBetPhase).toHaveBeenCalledWith(2, "settling", "拒单检测", 30);
    expect(mocks.settle).not.toHaveBeenCalled();
    release(); const result = await task;
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), expect.any(Function), 0);
    expect(result.pm.fill).toBe("partial"); expect(result.other?.submission).toBe("rejected");
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
  });
  it("other-first RAY does not query orders between its acceptance and a slow PM submission", async () => {
    let release!: (value: { success: boolean; orderID: string }) => void;
    mocks.submit.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const task = executeGtc(params(), checked(false));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.otherPoll).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    release({ success: true, orderID: hash }); await task;
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Function), 0);
  });
  it("unavailable global recovery does not gate a new independently persisted pair", async () => {
    mocks.ready = false; mocks.refresh.mockRejectedValue(new Error("old recovery unavailable"));
    await executeGtc(params(), checked(false));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
  });
  it.each(["prepared", "accepted", "unknown", "manual"])("an existing %s order on the same maker does not block a new independent pair", async (state) => {
    const old = createGtcExecution("old", "owner", "wallet", "maker", { orderHash: "old-hash", shares: "10" } as GtcPlan, 1);
    old.submit = state === "manual" ? "accepted" : state as GtcExecution["submit"];
    old.manual = state === "manual"; old.released = false;
    mocks.existing = [old]; const snapshot = structuredClone(old); mocks.initial = "10";
    await executeGtc(params(), checked(false));
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.record?.id).not.toBe(old.id); expect(old).toEqual(snapshot);
  });
  it("a failed frozen preparation rejects preflight before creating any execution or POST", async () => {
    mocks.prepare.mockResolvedValueOnce({ ...await mocks.prepare(), validate: () => { throw new Error("frozen quote changed"); } });
    const error = await executeGtc(params(), checked()).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(error.message).toBe("frozen quote changed");
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("blocks a GTC pair at its own count limit before either venue POST", async () => {
    const pair = checked() as ArbBetChecked;
    pair.accountA!.maxBetCount = 1;
    markGtcSuccess("owner", pair.accountA!.accountId, 2, "Home", 2);
    await expect(executeGtc(params(), pair)).rejects.toThrow("GTC 已达");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("checks the other leg's independent GTC odds history before sending PM", async () => {
    const pair = checked() as ArbBetChecked;
    pair.accountB!.lastOdds = true;
    markGtcSuccess("owner", pair.accountB!.accountId, 2, "Away", 2.1);
    await expect(executeGtc(params(), pair)).rejects.toThrow("GTC 赔率");
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it.each([true, false])("lightweight recheck blocks both legs when history changes after preparation (PM first: %s)", async (pmFirst) => {
    const pair = checked(pmFirst) as ArbBetChecked;
    pair.accountA!.maxBetCount = 1;
    const execution = await prepareGtcLegExecution(params(), pair);
    markGtcSuccess("owner", pair.accountA!.accountId, 2, pair.legA.target, 2);
    await execution.legs.get(pair.legA)!.submit();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
    await execution.close();
  });
  it.each([true, false])("does not interrupt the second original leg after the first dispatch (PM first: %s)", async (pmFirst) => {
    const pair = checked(pmFirst) as ArbBetChecked;
    pair.accountB!.maxBetCount = 1;
    const execution = await prepareGtcLegExecution(params(), pair);
    await execution.legs.get(pair.legA)!.submit();
    markGtcSuccess("owner", pair.accountB!.accountId, 2, pair.legB.target, 2);
    await execution.legs.get(pair.legB)!.submit();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
    await execution.close();
  });
  it("serial PM-first accepted zero sends the other leg once and preserves its hanging-order facts", async () => {
    await executeGtc(params(), checked()); expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.record).toMatchObject({ submit: "accepted", matched: "0", manual: true, decision: "closed", counted: false });
    expect(notices.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading Polymarket" }));
    expect(notices.close).toHaveBeenCalledOnce();
    expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", duration: 30_000, message: expect.stringContaining("成交待核实") }));
  });
  it("serial positive partial sends original other quantity once and closes manual", async () => {
    mocks.initial = "5"; await executeGtc(params(), checked()); expect(mocks.betting).toHaveBeenCalledTimes(1);
    expect(mocks.betting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ betMoney: 33.5, deferPostAcceptSettlement: true }), 3, 30);
    expect(mocks.record).toMatchObject({ manual: true, matched: "5", groupComplete: false });
  });
  it("unknown PM POST is never retried or followed by another leg", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout")); await executeGtc(params(), checked());
    expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).not.toHaveBeenCalled(); expect(mocks.record?.submit).toBe("unknown");
  });
  it("explicit rejection does not become accepted zero", async () => {
    mocks.submit.mockResolvedValue({ success: false, errorMsg: "market closed" }); await executeGtc(params(), checked());
    expect(mocks.record?.submit).toBe("rejected"); expect(mocks.betting).not.toHaveBeenCalled();
    expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error", message: expect.stringContaining("market closed") }));
  });
  it("parallel submits original pair once even if initial PM fill is zero", async () => {
    await executeGtc(params(true), checked(true, true)); expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).toHaveBeenCalledTimes(1); expect(mocks.record?.manual).toBe(true);
  });
  it("parallel other rejection preserves PM on its persisted original B side", async () => {
    mocks.betting.mockResolvedValueOnce({ provider: "RAY", success: false, message: "rejected", response: { code: 501 } });
    const result = await executeGtc(params(true), checked(false, true));
    expect(mocks.record?.plan.originalPmLeg).toBe("B");
    expect(syncActiveBetPlaceResults).toHaveBeenCalledWith(2, expect.objectContaining({ provider: "RAY", success: false }), expect.objectContaining({ provider: "Polymarket", success: true }), true, true, "api_failed", "accepted_pending_confirm", undefined);
    expect(result.pm.submission).toBe("accepted");
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.betting).toHaveBeenCalledOnce();
  });
  it("other-first rejection never sends PM", async () => {
    mocks.betting.mockResolvedValue({ success: false, message: "赔率下降至1.84", response: { code: 501 } }); const args = params(); const result = await executeGtc(args, checked(false));
    expect(result).toMatchObject({ pm: { submission: "not_attempted", orderType: "GTC" }, responsibility: "none", failed: true });
    expect((args as { setMessage: ReturnType<typeof vi.fn> }).setMessage).not.toHaveBeenCalled();
    presentArbExecution(args, result);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.record?.other.state).toBe("rejected");
    expect(mocks.record).toMatchObject({ submit: "not_attempted", pmAuthorized: false, released: true, manual: false, orderId: null });
    expect(syncActiveBetLeg).toHaveBeenCalledWith(2, "B", "skipped", "PM 未提交");
    expect(syncActiveBetFail).toHaveBeenCalledWith(2, expect.stringContaining("赔率下降至1.84；PM 未提交"));
    expect((args as { setMessage: ReturnType<typeof vi.fn> }).setMessage).toHaveBeenCalledWith(expect.stringContaining("本次执行已结束，无订单或挂单"));
  });
  it("other-first unknown result keeps manual hold without sending PM", async () => {
    mocks.betting.mockResolvedValue({ success: false, pmSubmitUnknown: true, message: "timeout" }); await executeGtc(params(), checked(false));
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.record).toMatchObject({ submit: "not_attempted", other: { state: "unknown" }, manual: true, released: false });
  });
  it("gateway failure without a venue response is unknown even if success=false has no unknown flag", async () => {
    mocks.betting.mockResolvedValue({ success: false, message: "Network Error" }); await executeGtc(params(), checked(false));
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.record).toMatchObject({ other: { state: "unknown" }, released: false, manual: true });
    expect(mocks.record?.other.message).toBe("Network Error");
  });
  it("both full verified completes without entering a retry queue", async () => {
    mocks.initial = "10"; await executeGtc(params(), checked()); expect(mocks.record?.groupComplete).toBe(true); expect(mocks.record?.released).toBe(true);
  });
  it("profit or persistence gate failure occurs before either POST", async () => {
    mocks.ratio = 1.03; await expect(executeGtc(params(), checked())).rejects.toThrow("利润不足"); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
    mocks.ratio = 0.99; mocks.create.mockRejectedValueOnce(new Error("本次持久化失败"));
    await expect(executeGtc(params(), checked())).rejects.toThrow("持久化");
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("profit uses signed principal, independent of fee proof and legacy all-in budget", async () => {
    const prepared = await mocks.prepare();
    mocks.prepare.mockResolvedValueOnce({ ...prepared, maxPrincipal: "4.9", allInBudget: "6", feeProof: undefined });
    mocks.ratio = 1.005;
    await executeGtc(params(), checked());
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("unbound other outcome remains pending rather than claiming filled", async () => {
    mocks.initial = "5"; mocks.settle.mockResolvedValue({ rejected: false, pendingConfirm: false, orders: [] });
    await executeGtc(params(), checked()); expect(mocks.record?.other.state).toBe("pending"); expect(mocks.count).not.toHaveBeenCalled();
  });
});
