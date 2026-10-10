import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionError } from "@/orderModes/gtc/executionResult";
import { presentArbExecution } from "@/orderModes/gtc/presentation";
import { syncActiveBetFail, syncActiveBetLeg } from "@/stores/betting/activeBetRunSync";
import { executeGtc } from "./execute";
import { markGtcSuccess } from "./successMarkers";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), betting: vi.fn(), prepare: vi.fn(), settle: vi.fn(), create: vi.fn(), refresh: vi.fn(), poll: vi.fn(), count: vi.fn(), log: vi.fn(), ratio: 0.99, record: null as GtcExecution | null, existing: [] as GtcExecution[], initial: "0", ready: true, owner: "owner", commands: [] as GtcCommand[], error: "" }));
vi.mock("@changmen/client-core/models/betResult", () => ({ BetResult: class { orderId = null; constructor(public provider: string, public success: boolean) {} saveLog = mocks.log; } }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.owner, config: { betting: true } }) }));
vi.mock("./gateway", () => ({ placeOtherLeg: mocks.betting }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetPhase: vi.fn(), syncActiveBetFail: vi.fn(), syncActiveBetLeg: vi.fn(), scheduleActiveBetRunRemoval: vi.fn() }));
vi.mock("./otherOrders", () => ({ settleGtcOtherLeg: mocks.settle }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.count }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ prepareGtcBuy: mocks.prepare, pmSubmitMaker: () => "maker" }));
vi.mock("./api", () => ({ createGtc: mocks.create }));
vi.mock("./runtime", () => ({
  startGtcRuntime: vi.fn(),
  refreshGtcRecords: mocks.refresh,
  markGtcLegOnce: mocks.count,
  gtcProgress: { get ready() { return mocks.ready; }, get records() { return [...mocks.existing, ...(mocks.record ? [mocks.record] : [])]; } },
  acceptGtc: (row: GtcExecution) => { mocks.record = row; return row; },
  currentGtc: () => mocks.record!,
  mutateGtc: async (_id: string, command: GtcCommand) => { mocks.commands.push(command); mocks.record = applyGtcCommand(mocks.record!, command, Date.now()); return mocks.record; },
  pollGtc: mocks.poll,
}));
const hash = `0x${"a".repeat(64)}`;
function checked(pmFirst = true, parallel = false) {
  const pm = { type: "Polymarket", betMoney: 5, odds: 2, betId: "condition", itemId: "token", target: "Home" };
  const other = { type: "RAY", betMoney: 33.5, odds: 2, matchId: "match", itemId: "away", target: "Away", data: {} };
  return { betBothLegs: true, singleLegByRate: false, legA: pmFirst ? pm : other, legB: pmFirst ? other : pm, accountA: { accountId: pmFirst ? 1 : 2, provider: pmFirst ? "Polymarket" : "RAY" }, accountB: { accountId: pmFirst ? 2 : 1, provider: pmFirst ? "RAY" : "Polymarket" }, waitSec: 30, linkId: 3, parallel } as never;
}
function params(parallel = false) {
  return { match: { id: 1, title: "match" }, bet: { id: 2, getBetName: () => "market" }, config: { profit: mocks.ratio, betSorting: parallel ? "Parallel" : "Auto" }, setMessage: vi.fn(), trace: { finish: vi.fn() } } as never;
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); mocks.record = null; mocks.existing = []; mocks.commands = []; mocks.initial = "0"; mocks.ready = true; mocks.ratio = 0.99;
  mocks.refresh.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", feeProof: { rate: "0", exponent: 1, takerOnly: true, observedAt: 1 }, protocol: 2, negRisk: false, orderHash: hash, route: "direct", submit: mocks.submit, validate: () => {} });
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
  it("a failed frozen preparation returns durable cleanup facts without any POST", async () => {
    mocks.prepare.mockResolvedValueOnce({ ...await mocks.prepare(), validate: () => { throw new Error("frozen quote changed"); } });
    const error = await executeGtc(params(), checked()).catch(error => error);
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error.result).toMatchObject({ failed: true, pm: { submission: "not_attempted" }, responsibility: "none" });
    expect(error.message).toBe("frozen quote changed");
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("blocks a GTC pair at its own count limit before either venue POST", async () => {
    const pair = checked() as ArbBetChecked;
    pair.accountA!.maxBetCount = 1;
    markGtcSuccess("owner", pair.accountA!.accountId, 2, "Home", 2);
    await expect(executeGtc(params(), pair)).rejects.toThrow("GTC 已达");
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(2, [pair.accountA!.accountId]);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("checks the other leg's independent GTC odds history before sending PM", async () => {
    const pair = checked() as ArbBetChecked;
    pair.accountB!.lastOdds = true;
    markGtcSuccess("owner", pair.accountB!.accountId, 2, "Away", 2.1);
    await expect(executeGtc(params(), pair)).rejects.toThrow("GTC 赔率");
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("serial PM-first accepted zero closes to manual without second POST", async () => {
    await executeGtc(params(), checked()); expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).not.toHaveBeenCalled();
    expect(mocks.record).toMatchObject({ submit: "accepted", matched: "0", manual: true, decision: "closed", counted: false });
  });
  it("serial positive partial sends original other quantity once and closes manual", async () => {
    mocks.initial = "5"; await executeGtc(params(), checked()); expect(mocks.betting).toHaveBeenCalledTimes(1);
    expect(mocks.betting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ betMoney: 33.5, deferPostAcceptSettlement: true }), 3);
    expect(mocks.record).toMatchObject({ manual: true, matched: "5", groupComplete: false });
  });
  it("unknown PM POST is never retried or followed by another leg", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout")); await executeGtc(params(), checked());
    expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).not.toHaveBeenCalled(); expect(mocks.record?.submit).toBe("unknown");
  });
  it("explicit rejection does not become accepted zero", async () => {
    mocks.submit.mockResolvedValue({ success: false, errorMsg: "market closed" }); await executeGtc(params(), checked());
    expect(mocks.record?.submit).toBe("rejected"); expect(mocks.betting).not.toHaveBeenCalled();
  });
  it("parallel submits original pair once even if initial PM fill is zero", async () => {
    await executeGtc(params(true), checked(true, true)); expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.betting).toHaveBeenCalledTimes(1); expect(mocks.record?.manual).toBe(true);
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
    expect(syncActiveBetLeg).toHaveBeenCalledWith(2, "A", "pending_confirm", "Network Error");
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
