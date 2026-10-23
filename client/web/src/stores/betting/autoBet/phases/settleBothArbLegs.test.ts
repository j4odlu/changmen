import type { ArbBetAttemptParams, ArbBetPlaced } from "./types";
import type { OriginalLegExecution } from "@/domain/betting/originalLegExecution";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { createDefaultUserConfig } from "@/types/userConfig";
import { pmBalanceRevision } from "@/domain/polymarket/pmBalanceRejection";

const wait = vi.hoisted(() => vi.fn(async () => {}));
const settleArbLegUntilTerminal = vi.hoisted(() => vi.fn());
const maxLegRejectWaitSec = vi.hoisted(() => vi.fn(() => 30));
const showRejectDetectionTip = vi.hoisted(() => vi.fn());
const bindArbLegOrder = vi.hoisted(() => vi.fn(async () => true));
const refreshBalance = vi.hoisted(() => vi.fn());

vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));
vi.mock("@/stores/betting/autoBet/rejectWait", () => ({
  maxLegRejectWaitSec,
  showRejectDetectionTip,
  legRejectWaitSec: vi.fn(() => 0),
}));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({
  settleArbLegUntilTerminal,
}));
vi.mock("@/stores/betting/arbOrderBind", () => ({
  bindArbLegOrder,
  resolveArbBindOrderId: () => "",
  refreshOrderListAfterBind: vi.fn(),
}));
vi.mock("@/stores/betting/pendingOrderBind", () => ({
  enqueuePendingOrderBind: vi.fn(),
}));
vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetLegSettleResult: vi.fn(),
  syncActiveBetPhase: vi.fn(),
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ refreshBalance }),
}));

import { settleBothArbLegs } from "./settleBothArbLegs";
import { arbMakeUpSides } from "../arbMakeUpPair";

function params(): ArbBetAttemptParams {
  return {
    match: { id: 1 } as never,
    bet: { id: 9 } as never,
    config: createDefaultUserConfig(),
    setMessage: vi.fn(),
  };
}

function placed(a: string, b: string): ArbBetPlaced {
  return {
    legA: new BetOption(a as never, "m", "b", "i1", 100, "Home", 1.8),
    legB: new BetOption(b as never, "m", "b", "i2", 100, "Away", 2.1),
    accountA: { accountId: 1, provider: a } as never,
    accountB: { accountId: 2, provider: b } as never,
    betBothLegs: true,
    linkId: 1,
    implied: 1.05,
    singleLegByRate: false,
    stakeScale: 1,
    waitSec: 10,
    scanOddsA: 1.8,
    scanOddsB: 2.1,
    resultA: new BetResult(a as never, true),
    resultB: new BetResult(b as never, true),
    placeOutcomeA: "filled_pending_settle",
    placeOutcomeB: "filled_pending_settle",
  };
}

describe("settleBothArbLegs A8 wait", () => {
  beforeEach(() => {
    wait.mockClear();
    refreshBalance.mockReset();
    showRejectDetectionTip.mockClear();
    settleArbLegUntilTerminal.mockReset();
    settleArbLegUntilTerminal.mockResolvedValue({
      orders: [],
      rejected: false,
      pendingConfirm: false,
    });
    bindArbLegOrder.mockResolvedValue(true);
    maxLegRejectWaitSec.mockReturnValue(30);
  });

  it.each([
    { pmReject: false, otherReject: false, expected: null },
    { pmReject: false, otherReject: true, expected: "enqueueB" },
    { pmReject: true, otherReject: false, expected: "enqueueA" },
    { pmReject: true, otherReject: true, expected: null },
  ] as const)("PM=$pmReject 另一腿=$otherReject：先保存 PM 结果、等另一腿后才决定 $expected", async ({ pmReject, otherReject, expected }) => {
    const input = placed("Polymarket", "OB");
    input.resultA!.pending = true;
    let release!: () => void;
    const traditionalWait = new Promise<void>(resolve => { release = resolve; });
    wait.mockImplementationOnce(() => traditionalWait);
    settleArbLegUntilTerminal.mockImplementation(async (account: { provider: string }) => ({
      orders: [], rejected: account.provider === "Polymarket" ? pmReject : otherReject, pendingConfirm: false,
    }));
    let complete = false;
    const task = settleBothArbLegs(params(), input).then(value => { complete = true; return value; });
    await vi.waitFor(() => expect(bindArbLegOrder).toHaveBeenCalled());
    expect(complete).toBe(false);
    expect(settleArbLegUntilTerminal).toHaveBeenCalledOnce();
    expect(settleArbLegUntilTerminal.mock.calls[0][0].provider).toBe("Polymarket");
    release();
    const settled = await task;
    expect(settleArbLegUntilTerminal).toHaveBeenCalledTimes(2);
    expect(arbMakeUpSides(input.resultA, settled.rejectA, input.resultB, settled.rejectB,
      settled.pendingConfirmA, settled.pendingConfirmB)).toBe(expected);
  });

  it("普通场馆检测等待为 0 时仍弹原有倒计时，并立即拉单", async () => {
    maxLegRejectWaitSec.mockReturnValue(0);

    await settleBothArbLegs(params(), placed("OB", "PB"));

    expect(showRejectDetectionTip).toHaveBeenCalledWith(10);
    expect(wait).not.toHaveBeenCalled();
    expect(settleArbLegUntilTerminal).toHaveBeenCalledTimes(2);
  });

  it("空等 max 后再依次拉 A8 腿，场馆层 rejectWaitSec=0", async () => {
    const order: string[] = [];
    wait.mockImplementation(async () => {
      order.push("wait");
    });
    settleArbLegUntilTerminal.mockImplementation(async (account: { provider: string }) => {
      order.push(account.provider);
      return { orders: [], rejected: false, pendingConfirm: false };
    });

    await settleBothArbLegs(params(), placed("OB", "PB"));

    expect(order).toEqual(["wait", "OB", "PB"]);
    expect(settleArbLegUntilTerminal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: "OB" }),
      expect.anything(),
      expect.objectContaining({ rejectWaitSec: 0 }),
    );
  });

  it("PM 不等 A8 空等，立刻 settle", async () => {
    const order: string[] = [];
    wait.mockImplementation(async () => {
      order.push("wait");
    });
    settleArbLegUntilTerminal.mockImplementation(async (account: { provider: string }) => {
      order.push(account.provider);
      return { orders: [], rejected: false, pendingConfirm: false };
    });

    await settleBothArbLegs(params(), placed("OB", "Polymarket"));

    expect(order[0]).toBe("Polymarket");
    expect(order).toContain("wait");
    expect(order).toEqual(["Polymarket", "wait", "OB"]);
  });

  it("a sole unknown PM leg is confirmed without a fake API success or binding its local hash", async () => {
    const input = placed("Polymarket", "OB");
    input.resultA = Object.assign(new BetResult("Polymarket", false),
      { pending: true, pmSubmitUnknown: true, orderId: "localhash" });
    input.resultB = new BetResult("OB", false);
    input.placeOutcomeA = "submit_unknown"; input.placeOutcomeB = "api_failed";
    bindArbLegOrder.mockClear();
    refreshBalance.mockClear();
    settleArbLegUntilTerminal.mockResolvedValue({ orders: [], rejected: false, pendingConfirm: true });
    const out = await settleBothArbLegs(params(), input);
    expect(settleArbLegUntilTerminal).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ pendingConfirmA: true, rejectA: false });
    expect(bindArbLegOrder).not.toHaveBeenCalled();
    expect(refreshBalance).not.toHaveBeenCalled();
  });
  it.each(["A", "B"] as const)("PM %s delayed 确认清除 pending 后仍补刷余额", async side => {
    const input = placed(side === "A" ? "Polymarket" : "OB", side === "B" ? "Polymarket" : "OB");
    const result = side === "A" ? input.resultA! : input.resultB!;
    const account = side === "A" ? input.accountA! : input.accountB!;
    result.pending = true;
    settleArbLegUntilTerminal.mockImplementation(async (_account, receipt) => {
      receipt.pending = false;
      return { orders: [], rejected: false, pendingConfirm: false };
    });
    await settleBothArbLegs(params(), input);
    expect(result.pending).toBe(false);
    expect(refreshBalance.mock.calls.filter(([value]) => value === account)).toHaveLength(1);
  });

  it("PM delayed 仍未确认时不触发终态补刷", async () => {
    const input = placed("Polymarket", "OB"); input.resultA!.pending = true;
    settleArbLegUntilTerminal.mockResolvedValue({ orders: [], rejected: false, pendingConfirm: true });
    await settleBothArbLegs(params(), input);
    expect(refreshBalance.mock.calls.filter(([value]) => value === input.accountA)).toHaveLength(0);
  });
  it("PM 直接成交照常刷新一次，并使成交前的余额查询失效", async () => {
    const input = placed("Polymarket", "OB");
    await settleBothArbLegs(params(), input);
    expect(refreshBalance.mock.calls.filter(([value]) => value === input.accountA)).toHaveLength(1);
    expect(pmBalanceRevision(input.accountA!)).toBe(1);
    expect(pmBalanceRevision(input.accountB!)).toBe(0);
  });
  it("PF 仍按原逻辑读取确认后的 pending，不套用 PM 刷新快照", async () => {
    const input = placed("PredictFun", "OB"); input.resultA!.pending = true;
    settleArbLegUntilTerminal.mockImplementation(async (_account, receipt) => {
      receipt.pending = false;
      return { orders: [], rejected: false, pendingConfirm: false };
    });
    await settleBothArbLegs(params(), input);
    expect(refreshBalance.mock.calls.filter(([value]) => value === input.accountA)).toHaveLength(0);
    expect(pmBalanceRevision(input.accountA!)).toBe(0);
  });
  it.each(["throw", "reject"])("PM 终态补刷 %s 不影响原成交与绑单结果", async failure => {
    const input = placed("Polymarket", "OB"); input.resultA!.pending = true; input.resultB!.success = false;
    settleArbLegUntilTerminal.mockImplementation(async (_account, receipt) => {
      receipt.pending = false;
      return { orders: [], rejected: false, pendingConfirm: false };
    });
    refreshBalance.mockImplementationOnce(() => {
      if (failure === "throw") throw new Error("balance unavailable");
      return Promise.reject(new Error("balance unavailable"));
    });
    bindArbLegOrder.mockClear();
    const out = await settleBothArbLegs(params(), input);
    expect(out).toMatchObject({ rejectA: false, pendingConfirmA: false });
    expect(input.resultA!.success).toBe(true);
    expect(bindArbLegOrder).toHaveBeenCalledOnce();
  });
  it("PM 延迟订单确认未成交也补刷，但保留原拒单事实", async () => {
    const input = placed("Polymarket", "OB"); input.resultA!.pending = true;
    settleArbLegUntilTerminal.mockImplementation(async (account, receipt) => {
      receipt.pending = false;
      return { orders: [], rejected: account.provider === "Polymarket", pendingConfirm: false };
    });
    const out = await settleBothArbLegs(params(), input);
    expect(out).toMatchObject({ rejectA: true, pendingConfirmA: false });
    expect(refreshBalance.mock.calls.filter(([value]) => value === input.accountA)).toHaveLength(1);
  });
  it("original PF counterpart waits once in common settle while PM facts confirm immediately", async () => {
    const input = placed("Polymarket", "PredictFun");
    const order: string[] = [];
    const execution = (provider: string, seconds: number): OriginalLegExecution => ({
      validate: () => {}, submit: vi.fn(),
      confirm: async () => { order.push(provider); return { orders: [], rejected: false, pendingConfirm: true }; },
      facts: () => ({ submission: "accepted", fill: "partial" }), markConfirmed: () => {}, rejectWaitSec: seconds,
    });
    input.originalExecution = {
      legs: new Map([[input.legA, execution("PM", 0)], [input.legB, execution("PF", 30)]]),
      finishSubmission: vi.fn(), actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false },
      close: async () => {}, summary: () => ({ message: "pending", traceStatus: "partial", failed: false }),
    };
    wait.mockImplementation(async () => { order.push("wait"); });
    await settleBothArbLegs(params(), input);
    expect(order).toEqual(["PM", "wait", "PF"]);
    expect(wait).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(settleArbLegUntilTerminal).not.toHaveBeenCalled();
  });
});
