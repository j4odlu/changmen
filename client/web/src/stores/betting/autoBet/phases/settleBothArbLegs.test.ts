import type { ArbBetAttemptParams, ArbBetPlaced } from "./types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { createDefaultUserConfig } from "@/types/userConfig";

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
    refreshBalance.mockClear();
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

  it.each((["A", "B"] as const).flatMap(side => [
    { state: "delayed 成交", pending: true, terminal: true, rejected: false },
    { state: "delayed 未成交", pending: true, terminal: true, rejected: true },
    { state: "仍待确认", pending: true, terminal: false, rejected: false },
    { state: "立即成交", pending: false, terminal: true, rejected: false },
  ].map(scenario => ({ side, ...scenario }))))(
    "PM 在 $side 腿，$state：终态后补刷且不重复刷新",
    async ({ side, pending, terminal, rejected }) => {
      const input = side === "A" ? placed("Polymarket", "OB") : placed("OB", "Polymarket");
      const account = side === "A" ? input.accountA! : input.accountB!;
      const result = side === "A" ? input.resultA! : input.resultB!;
      result.pending = pending;
      if (side === "A") {
        input.resultB!.success = false;
        input.placeOutcomeA = pending ? "accepted_pending_confirm" : "filled_pending_settle";
        input.placeOutcomeB = "api_failed";
      }
      else {
        input.resultA!.success = false;
        input.placeOutcomeA = "api_failed";
        input.placeOutcomeB = pending ? "accepted_pending_confirm" : "filled_pending_settle";
      }
      let release!: () => void;
      const confirmation = new Promise<void>(resolve => { release = resolve; });
      const confirm = vi.fn(async (confirmedResult: BetResult) => {
        await confirmation;
        // 真实 PM settle 会改写原 result.pending，不能用改写后的值判断是否漏刷。
        confirmedResult.pending = !terminal;
        return { orders: [], rejected, pendingConfirm: !terminal };
      });
      settleArbLegUntilTerminal.mockImplementation(() => confirm(result));

      const task = settleBothArbLegs(params(), input);
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      expect(refreshBalance).toHaveBeenCalledTimes(pending ? 0 : 1);
      release();
      const settled = await task;

      expect(side === "A" ? settled.pendingConfirmA : settled.pendingConfirmB).toBe(!terminal);
      expect(refreshBalance).toHaveBeenCalledTimes(terminal ? 1 : 0);
      if (terminal)
        expect(refreshBalance).toHaveBeenCalledExactlyOnceWith(account);
    },
  );

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
});
