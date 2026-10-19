import type { ViewMatch } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import type { VenueOrder } from "@changmen/client-core/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { LoseOrder } from "@/models/loseOrder";
import { PlatformAccount } from "@/models/platformAccount";
import { processLoseOrders } from "@/stores/betting/loseOrder";
import { clearPendingOrderBinds, peekPendingOrderBinds } from "@/stores/betting/pendingOrderBind";
import { advanceAuthSessionVersion } from "@/api/client";

import { createDefaultUserConfig } from "@/types/userConfig";
import { runA8MakeupConsumer } from "./makeupConsumer.fixture";

const loseOrders = vi.hoisted(() => new Map<number, LoseOrder>());
const matchs = vi.hoisted(() => [] as ViewMatch[]);

const removeOrder = vi.hoisted(() => vi.fn());
const persistOrders = vi.hoisted(() => vi.fn());
const setPendingVenueOrder = vi.hoisted(() => vi.fn());
const clearPendingVenueOrder = vi.hoisted(() => vi.fn());
const deferPendingVenueOrder = vi.hoisted(() => vi.fn());
const getAccount = vi.hoisted(() => vi.fn());
const findAccount = vi.hoisted(() => vi.fn());
const checkBetting = vi.hoisted(() => vi.fn());
const betting = vi.hoisted(() => vi.fn());
const loseOrderMessage = vi.hoisted(() => vi.fn());
const markSuccessfulBet = vi.hoisted(() => vi.fn());
const saveOrderBind = vi.hoisted(() => vi.fn());
const a8Tip = vi.hoisted(() => vi.fn());
const wait = vi.hoisted(() => vi.fn(async () => {}));
const updateVenueOrders = vi.hoisted(() => vi.fn(async (_acc?: PlatformAccount, _opts?: unknown) => [] as VenueOrder[]));
const refreshBalance = vi.hoisted(() => vi.fn(async () => undefined));
const settlePolymarketDelayedOrder = vi.hoisted(() => vi.fn());
const makeUpEnabled = vi.hoisted(() => ({ value: true }));
const activeBetRuns = vi.hoisted(() => new Map<number, { legs: { side: "A" | "B"; target: string; status: string }[] }>());
const extensionPrefs = vi.hoisted((): {
  arbFailAutoSell: { enabled: boolean };
  arbEarlyLockSell: { enabled: boolean };
  makeupOddsBand: MakeupOddsBandPrefs;
} => ({
  arbFailAutoSell: { enabled: false },
  arbEarlyLockSell: { enabled: false },
  makeupOddsBand: { enabled: false, upper: 1.02, lower: 0.96 },
}));

vi.mock("@/stores/activeBetRunStore", () => ({
  useActiveBetRunStore: () => ({ runs: activeBetRuns }),
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({
    config: {
      ...createDefaultUserConfig(),
      makeUp: makeUpEnabled.value,
      makeProfit: 1.01,
      noSameProvider: false,
      waitTime: { OB: 10, RAY: 10 },
    },
    extensionPrefs,
  }),
}));

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({
    matchs,
    getDefaultOdds: () => undefined,
    getBetTarget: () => undefined,
  }),
}));

vi.mock("@/stores/loseOrderStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/stores/loseOrderStore")>(),
  useLoseOrderStore: () => ({
    orders: loseOrders,
    persist: persistOrders,
    removeOrder,
    setPendingVenueOrder,
    clearPendingVenueOrder,
    consumeOrder: (order: LoseOrder) => {
      if (loseOrders.get(order.betId) !== order)
        return;
      clearPendingVenueOrder(order.betId, false);
      removeOrder(order.betId);
    },
    deferPendingVenueOrder,
    setMakeupRuntimePhase: vi.fn(),
    has: (id: number) => loseOrders.has(id),
  }),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({
    getAccount,
    findAccount,
    checkBetting,
    betting,
    updateVenueOrders,
    refreshBalance,
  }),
}));

vi.mock("@/stores/messageStore", () => ({
  useMessageStore: () => ({ loseOrderMessage }),
}));

vi.mock("@/stores/betting/successMarkers", () => ({
  markSuccessfulBet,
  readUsedAccounts: vi.fn(() => []),
}));

vi.mock("@/api/esport", () => ({ saveOrderBind }));

vi.mock("@/stores/account/pmRejectOrder", () => ({
  persistPolymarketExecutionReject: vi.fn(async () => {}),
}));

vi.mock("@/shared/a8Notify", () => ({ a8Tip }));

vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));

vi.mock("@/shared/betTiming", () => ({
  makeUpBetToastSeconds: vi.fn(() => 10),
}));

vi.mock("@changmen/venue-browser/adapter/shared/rejectWait", () => ({
  venueRejectWaitBeforePoll: vi.fn(async () => {}),
}));

vi.mock("@changmen/venue-browser/polymarket/fok/orderSettlement", () => ({
  settlePolymarketDelayedOrder: (...args: unknown[]) => settlePolymarketDelayedOrder(...args),
}));

vi.mock("@changmen/venue-browser/polymarket/fok/settlementJob", () => ({
  awaitPolymarketSettlementJob: vi.fn(async () => null),
  getPolymarketSettlementDelayCtx: vi.fn(() => null),
  clearPolymarketSettlementJob: vi.fn(),
  startPolymarketSettlementJob: vi.fn(),
  clearPolymarketSettlementJobs: vi.fn(),
}));

vi.mock("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay", () => ({
  resolvePolymarketDelayedPollOpts: vi.fn(async () => ({
    initialDelayMs: 1,
    intervalMs: 1,
    maxAttempts: 1,
  })),
}));

vi.mock("@/extensions/arbBet/arbFailAutoSell", () => ({
  maybeArbFailAutoSellByLink: vi.fn(async () => false),
}));

import { makeUpBetToastSeconds } from "@/shared/betTiming";

function makeItem(type: PlatformId, homeOdds: number) {
  return {
    type,
    matchId: "m1",
    betId: "b1",
    updateOdds: vi.fn(),
    getOdds: (side: string) => (side === "Home" ? homeOdds : 2),
    getItemId: (side: string) => `${type}:${side}`,
  };
}

function makeBet(items: ReturnType<typeof makeItem>[]) {
  return {
    id: 100,
    getBetName: () => "地图1",
    items,
  };
}

function makeMatch(bet: ReturnType<typeof makeBet>): ViewMatch {
  return {
    id: 1,
    title: "A vs B",
    game: "英雄联盟",
    gameId: 1,
    bets: [bet],
  } as unknown as ViewMatch;
}

function queueOrder(patch: Partial<ConstructorParameters<typeof LoseOrder>[0]> = {}) {
  const order = new LoseOrder({
    accountId: 1,
    matchId: 1,
    betId: 100,
    target: "Home",
    betMoney: 100,
    betOdds: 1.85,
    match: "A vs B",
    bet: "地图1",
    linkId: 1_000_000_000_001,
    isCreateOrder: false,
    ...patch,
  });
  loseOrders.set(100, order);
  return order;
}

describe("processLoseOrders (A8 jb parity)", () => {
  beforeEach(() => {
    advanceAuthSessionVersion();
    loseOrders.clear();
    clearPendingOrderBinds();
    activeBetRuns.clear();
    matchs.length = 0;
    extensionPrefs.makeupOddsBand = { enabled: false, upper: 1.02, lower: 0.96 };
    makeUpEnabled.value = true;
    vi.clearAllMocks();
    markSuccessfulBet.mockReset();
    persistOrders.mockImplementation(() => sessionStorage.setItem("LOSEORDER", JSON.stringify([...loseOrders.values()].map(o => o.toJSON()))));
    saveOrderBind.mockResolvedValue(true);
    removeOrder.mockImplementation((betId: number, force = false) => {
      const order = loseOrders.get(betId);
      if (!order)
        return;
      if (!force && order.betCount > 1)
        order.betCount -= 1;
      else
        loseOrders.delete(betId);
      sessionStorage.setItem("LOSEORDER", JSON.stringify([...loseOrders.values()].map(o => o.toJSON())));
    });
    getAccount.mockReset();
    findAccount.mockReset();
    checkBetting.mockReset();
    betting.mockReset();
    setPendingVenueOrder.mockImplementation((betId: number, orderId: string, accountId: number, opts?: {
      role?: "target" | "anchor";
      pendingTarget?: "Home" | "Away";
      conditionId?: string;
      makeUpEligible?: boolean;
      pmSubmission?: LoseOrder["pendingPmSubmission"];
      submittedAt?: number;
      odds?: number;
      betMoney?: number;
      regularReceipt?: LoseOrder["pendingRegularReceipt"];
    }) => {
      const order = loseOrders.get(betId);
      if (order) {
        order.pendingVenueOrderId = orderId;
        order.pendingRegularReceipt = opts?.regularReceipt;
        order.pendingVenueAccountId = accountId;
        order.pendingVenueRole = opts?.role ?? "target";
        order.pendingVenueTarget = opts?.pendingTarget;
        order.pendingVenueConditionId = opts?.conditionId;
        order.pendingVenueMakeUpEligible = opts?.makeUpEligible ?? true;
        order.pendingPmSubmission ??= opts?.pmSubmission;
        order.pendingVenueSubmittedAt ??= opts?.submittedAt;
        order.pendingVenueOdds ??= opts?.odds;
        order.pendingVenueBetMoney ??= opts?.betMoney;
        sessionStorage.setItem("LOSEORDER", JSON.stringify([...loseOrders.values()].map(o => o.toJSON())));
      }
    });
    deferPendingVenueOrder.mockReset();
    deferPendingVenueOrder.mockImplementation((betId: number) => {
      const order = loseOrders.get(betId);
      if (order)
        order.pendingVenueNextPollAt = Date.now() + 1_000;
    });
    clearPendingVenueOrder.mockImplementation((betId: number) => {
      const order = loseOrders.get(betId);
      if (order) {
        order.pendingVenueOrderId = undefined;
        order.pendingVenueReceipt = undefined;
        order.pendingRegularReceipt = undefined;
        order.pendingVenueAccountId = undefined;
        order.pendingVenueRole = undefined;
        order.pendingVenueTarget = undefined;
        order.pendingVenueConditionId = undefined;
        order.pendingVenueMakeUpEligible = undefined;
      }
    });
    vi.mocked(makeUpBetToastSeconds).mockReset();
    vi.mocked(makeUpBetToastSeconds).mockReturnValue(10);
  });


  it.each([false, true])("confirmed PM fill survives refresh during binding, later query timeout=%s", async (resumeTimeout) => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 4)])));
    const pm = new PlatformAccount({ accountId: 47, provider: "Polymarket", playerName: "pm" });
    const ob = new PlatformAccount({ accountId: 1, provider: "OB", playerName: "ob" });
    findAccount.mockImplementation(id => id === 47 ? pm : ob);
    getAccount.mockReturnValue(ob);
    checkBetting.mockImplementation(async (_acc, option: BetOption) => { option.data = {}; return option; });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "duplicate-after-fill" });
    queueOrder({ pendingVenueOrderId: "pm-already-filled",
      pendingPmSubmission: { orderId: "pm-already-filled", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: Date.now() },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home",
      pendingVenueOdds: 4, pendingVenueBetMoney: 14.93 });
    persistOrders();
    settlePolymarketDelayedOrder.mockResolvedValueOnce({ outcome: "matched", row: { status: "MATCHED", size_matched: "59.72", original_size: "59.72" } })
      .mockResolvedValue(resumeTimeout ? { outcome: "timeout", row: null } : { outcome: "matched", row: { status: "MATCHED", size_matched: "59.72", original_size: "59.72" } });
    updateVenueOrders.mockResolvedValue([]);
    let releaseBind!: (ok: boolean) => void;
    saveOrderBind.mockImplementationOnce(() => new Promise(resolve => { releaseBind = resolve; }));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce());
    const saved = JSON.parse(sessionStorage.getItem("LOSEORDER")!)[0];
    expect(saved.pendingVenueOrderId).toBe("pm-already-filled");
    expect(saved.pendingVenueReceipt).toMatchObject({ orderId: "pm-already-filled", accountId: 47, rejected: false });
    const restored = new LoseOrder(saved);
    loseOrders.set(100, restored);
    try {
      await processLoseOrders({ setMessage: vi.fn() });
      await vi.waitFor(() => expect(restored.pendingVenueOrderId).toBeUndefined());
      await processLoseOrders({ setMessage: vi.fn() });
      expect(betting).not.toHaveBeenCalled();
    } finally {
      releaseBind(true);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });

  it("仍待确认的原单不保存终态，继续查询原单直到成交", async () => {
    const pm = new PlatformAccount({ accountId: 47, provider: "Polymarket", playerName: "pm" });
    findAccount.mockReturnValue(pm);
    const order = queueOrder({ pendingVenueOrderId: "still-pending",
      pendingPmSubmission: { orderId: "still-pending", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: Date.now() },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home",
      pendingVenueOdds: 4, pendingVenueBetMoney: 14.93 });
    persistOrders();
    settlePolymarketDelayedOrder.mockResolvedValueOnce({ outcome: "timeout", row: { size_matched: "1", original_size: "59.72" } })
      .mockResolvedValueOnce({ outcome: "matched", row: { size_matched: "59.72", original_size: "59.72" } });
    updateVenueOrders.mockResolvedValue([]);
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(deferPendingVenueOrder).toHaveBeenCalledOnce());
    expect(order.pendingVenueReceipt).toBeUndefined();
    expect(new LoseOrder(JSON.parse(sessionStorage.getItem("LOSEORDER")!)[0]).pendingVenueReceipt).toBeUndefined();
    order.pendingVenueNextPollAt = 0;
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(order.pendingVenueOrderId).toBeUndefined());
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledTimes(2);
    expect(markSuccessfulBet).toHaveBeenCalledOnce();
    expect(betting).not.toHaveBeenCalled();
  });

  it.each((["target", "anchor"] as const).flatMap(role =>
    (["matched", "unfilled", "timeout"] as const).map(outcome => ({ role, outcome }))))(
    "$role/$outcome 刷新只恢复原单终态、绑定和计数，不重新检测",
    async ({ role, outcome }) => {
      const pm = new PlatformAccount({ accountId: 47, provider: "Polymarket", playerName: "pm" });
      findAccount.mockReturnValue(pm);
      queueOrder({ pendingVenueOrderId: "terminal-before-bind",
        pendingPmSubmission: { orderId: "terminal-before-bind", accountId: 47,
          makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: Date.now() },
        pendingVenueAccountId: 47, pendingVenueRole: role, pendingVenueTarget: "Away",
        pendingVenueOdds: 4, pendingVenueBetMoney: 14.93 });
      persistOrders();
      settlePolymarketDelayedOrder.mockResolvedValueOnce({ outcome, row: outcome === "matched"
        ? { status: "MATCHED", size_matched: "59.72", original_size: "59.72" } : null })
        .mockRejectedValue(new Error("terminal must not query again"));
      updateVenueOrders.mockResolvedValue([]);
      let release!: (ok: boolean) => void;
      saveOrderBind.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      await processLoseOrders({ setMessage: vi.fn() });
      await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce());
      const saved = JSON.parse(sessionStorage.getItem("LOSEORDER")!)[0];
      expect(saved.pendingVenueReceipt).toMatchObject({ orderId: "terminal-before-bind", accountId: 47,
        rejected: outcome !== "matched", bindOrderId: "terminal-before-bind" });
      if (outcome === "timeout") expect(saved.pendingVenueReceipt.message).toContain("超时策略判拒");
      const restored = new LoseOrder(saved);
      loseOrders.set(100, restored);
      try {
        await processLoseOrders({ setMessage: vi.fn() });
        await vi.waitFor(() => expect(restored.pendingVenueOrderId).toBeUndefined());
        expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce();
        expect(updateVenueOrders).toHaveBeenCalledTimes(outcome === "matched" ? 1 : 0);
        expect(saveOrderBind).toHaveBeenCalledTimes(2);
        expect(markSuccessfulBet).toHaveBeenCalledTimes(role === "anchor" && outcome !== "matched" ? 0 : 1);
        const remains = role === "anchor" ? outcome === "matched" : outcome !== "matched";
        expect(loseOrders.has(100)).toBe(remains);
        expect(restored.pendingVenueReceipt).toBeUndefined();
        expect(betting).not.toHaveBeenCalled();
      }
      finally { release(true); await new Promise(resolve => setTimeout(resolve, 25)); }
    },
  );

  it.each(
    (["OB", "Polymarket", "RAY"] as const).flatMap(provider =>
      (["initial", "resume"] as const).flatMap(stage =>
        (["keep", "cancel", "replace"] as const).flatMap(queueAction =>
          (["before-error", "after-error"] as const).map(cancelAt => ({ provider, stage, queueAction, cancelAt }))))),
  )("$provider/$stage/$queueAction/$cancelAt 连续查询异常只续查原单且只计一次", async ({ provider, stage, queueAction, cancelAt }) => {
    vi.useFakeTimers();
    try {
      const account = new PlatformAccount({ accountId: 1, playerName: "original", provider });
      getAccount.mockReturnValue(account);
      findAccount.mockReturnValue(account);
      matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
      const id = provider === "RAY" ? "" : "accepted-query-retry";
      const original = queueOrder(stage === "initial" ? {} : {
        pendingVenueOrderId: id, pendingVenueAccountId: 1, pendingVenueRole: "target", pendingVenueTarget: "Home",
        pendingVenueOdds: 4, pendingVenueBetMoney: 14.93,
        ...(provider === "Polymarket" ? { pendingPmSubmission: {
          orderId: id, accountId: 1, makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: Date.now(),
        } } : { pendingRegularReceipt: { checkAt: Date.now() - 1000 } }),
      });
      checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
      betting.mockResolvedValue({ success: true, provider, pending: provider === "Polymarket", orderId: id,
        beginTime: Date.now(), request: { order: { side: "BUY", makerAmount: "14930000" } } });
      const row = { provider, orderId: "detected-original", status: "none", createAt: Date.now(),
        odds: 4, betMoney: 14.93, reward: 0, money: 0, game: "", match: "", bet: "", item: "" } as VenueOrder;
      updateVenueOrders.mockResolvedValue([row]);
      settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
      const query = provider === "Polymarket" ? settlePolymarketDelayedOrder : updateVenueOrders;
      let rejectQuery!: (error: Error) => void;
      query.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectQuery = reject; }))
        .mockRejectedValueOnce(new Error("another transient query error"));
      const tick = processLoseOrders({ setMessage: vi.fn() });
      await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
      let replacement: LoseOrder | undefined;
      const changeQueue = () => {
        if (queueAction === "cancel") loseOrders.delete(100);
        if (queueAction === "replace") replacement = queueOrder({ isCreateOrder: true, linkId: 9000, betCount: 3 });
      };
      if (cancelAt === "before-error") changeQueue();
      rejectQuery(new Error("first transient query error"));
      await tick;
      await vi.advanceTimersByTimeAsync(0);
      if (cancelAt === "after-error") changeQueue();
      if (queueAction === "keep") {
        await processLoseOrders({ setMessage: vi.fn() });
        await processLoseOrders({ setMessage: vi.fn() });
        expect(query).toHaveBeenCalledOnce();
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(query).toHaveBeenCalledTimes(2);
      expect(markSuccessfulBet).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(query).toHaveBeenCalledTimes(3);
      expect(markSuccessfulBet).toHaveBeenCalledExactlyOnceWith(account, 100, "Home");
      expect(saveOrderBind).toHaveBeenCalledExactlyOnceWith({ orders: JSON.stringify([
        { LinkID: original.linkId, Provider: provider, PlayerID: 1, OrderID: id || "detected-original" },
      ]) });
      expect(betting).toHaveBeenCalledTimes(stage === "initial" ? 1 : 0);
      if (replacement) {
        expect(loseOrders.get(100)).toBe(replacement);
        expect(replacement.betCount).toBe(3);
        expect(replacement.pendingVenueOrderId).toBeUndefined();
        expect(replacement.pendingRegularReceipt).toBeUndefined();
      }
      else expect(loseOrders.has(100)).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(query).toHaveBeenCalledTimes(3);
      expect(markSuccessfulBet).toHaveBeenCalledOnce();
    }
    finally { advanceAuthSessionVersion(); vi.useRealTimers(); }
  });

  it.each(
    (["OB", "Polymarket"] as const).flatMap(provider =>
      (["account", "token", "gateway", "session"] as const).flatMap(revoke =>
        (["before-retry", "during-retry"] as const).map(phase => ({ provider, revoke, phase })))),
  )("$provider/$revoke/$phase 撤销后停止异常原单续查", async ({ provider, revoke, phase }) => {
    vi.useFakeTimers();
    try {
      const account = new PlatformAccount({ accountId: 1, playerName: "original", provider });
      getAccount.mockReturnValue(account);
      findAccount.mockReturnValue(account);
      matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
      queueOrder();
      checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
      betting.mockResolvedValue({ success: true, provider, pending: provider === "Polymarket", orderId: "revoked-query-retry" });
      updateVenueOrders.mockResolvedValue([]);
      settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
      const query = provider === "Polymarket" ? settlePolymarketDelayedOrder : updateVenueOrders;
      query.mockRejectedValueOnce(new Error("query failed"));
      await processLoseOrders({ setMessage: vi.fn() });
      const replacement = queueOrder({ isCreateOrder: true, betCount: 3, linkId: 9000 });
      let finishQuery!: (value: unknown) => void;
      if (phase === "during-retry") {
        query.mockImplementationOnce(() => new Promise(resolve => { finishQuery = resolve; }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(query).toHaveBeenCalledTimes(2);
      }
      if (revoke === "account") findAccount.mockReturnValue(undefined);
      else if (revoke === "token") account.token = "changed";
      else if (revoke === "gateway") account.gateway = "changed";
      else advanceAuthSessionVersion();
      if (phase === "during-retry") finishQuery(provider === "Polymarket" ? { outcome: "matched", row: null } : []);
      await vi.advanceTimersByTimeAsync(5000);
      expect(query).toHaveBeenCalledTimes(phase === "during-retry" ? 2 : 1);
      expect(saveOrderBind).not.toHaveBeenCalled();
      expect(markSuccessfulBet).not.toHaveBeenCalled();
      expect(betting).toHaveBeenCalledOnce();
      expect(loseOrders.get(100)).toBe(replacement);
      expect(replacement.betCount).toBe(3);
    }
    finally { advanceAuthSessionVersion(); vi.useRealTimers(); }
  });

  it.each(["OB", "Polymarket", "RAY"] as const)("%s 受理回执前已取消，随后查询失败也继续收尾", async (provider) => {
    vi.useFakeTimers();
    try {
      const account = new PlatformAccount({ accountId: 1, playerName: "original", provider });
      getAccount.mockReturnValue(account);
      findAccount.mockReturnValue(account);
      matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
      const original = queueOrder();
      checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
      let deliver!: (value: unknown) => void;
      betting.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
      const id = provider === "RAY" ? "" : "accepted-after-cancel";
      updateVenueOrders.mockResolvedValue([{ provider, orderId: "detected-original", status: "none" } as VenueOrder]);
      settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
      const query = provider === "Polymarket" ? settlePolymarketDelayedOrder : updateVenueOrders;
      query.mockRejectedValueOnce(new Error("temporary query error"));
      const tick = processLoseOrders({ setMessage: vi.fn() });
      await vi.waitFor(() => expect(betting).toHaveBeenCalledOnce());
      const replacement = queueOrder({ isCreateOrder: true, linkId: 9000, betCount: 3 });
      deliver({ success: true, provider, orderId: id, pending: provider === "Polymarket", beginTime: Date.now() });
      await tick;
      await vi.advanceTimersByTimeAsync(1000);
      expect(query).toHaveBeenCalledTimes(2);
      expect(saveOrderBind).toHaveBeenCalledExactlyOnceWith({ orders: JSON.stringify([
        { LinkID: original.linkId, Provider: provider, PlayerID: 1, OrderID: id || "detected-original" },
      ]) });
      expect(markSuccessfulBet).toHaveBeenCalledExactlyOnceWith(account, 100, "Home");
      expect(loseOrders.get(100)).toBe(replacement);
      expect(replacement.betCount).toBe(3);
      expect(betting).toHaveBeenCalledOnce();
    }
    finally { advanceAuthSessionVersion(); vi.useRealTimers(); }
  });

  it.each((["OB", "Polymarket"] as const).flatMap(provider =>
    (["count", "notification"] as const).map(fault => ({ provider, fault }))),
  )("$provider 续查成交后的 $fault 异常不能重新核验或重复计数", async ({ provider, fault }) => {
    vi.useFakeTimers();
    try {
      const account = new PlatformAccount({ accountId: 1, playerName: "original", provider });
      getAccount.mockReturnValue(account);
      findAccount.mockReturnValue(account);
      matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
      queueOrder();
      checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
      betting.mockResolvedValue({ success: true, provider, orderId: "finalized-retry", pending: provider === "Polymarket" });
      updateVenueOrders.mockResolvedValue([]);
      settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
      const query = provider === "Polymarket" ? settlePolymarketDelayedOrder : updateVenueOrders;
      query.mockRejectedValueOnce(new Error("query error"));
      (fault === "count" ? markSuccessfulBet : loseOrderMessage).mockImplementationOnce(() => { throw new Error("finalize error"); });
      await processLoseOrders({ setMessage: vi.fn() });
      await vi.advanceTimersByTimeAsync(1000);
      expect(loseOrders.has(100)).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(query).toHaveBeenCalledTimes(2);
      expect(saveOrderBind).toHaveBeenCalledOnce();
      expect(markSuccessfulBet).toHaveBeenCalledOnce();
      expect(betting).toHaveBeenCalledOnce();
    }
    finally { advanceAuthSessionVersion(); vi.useRealTimers(); }
  });

  it("OB 已受理原单在回执前取消重建后仍应绑定和计数", async () => {
    const timing = await vi.importActual<typeof import("@/shared/betTiming")>("@/shared/betTiming");
    sessionStorage.removeItem("BETCOUNT:1:100:Home");
    markSuccessfulBet.mockImplementation((account: PlatformAccount, id: number, side: "Home" | "Away") =>
      timing.incrementBetCount(account.accountId, id, side));
    matchs.push(makeMatch(makeBet([makeItem("OB", 4)])));
    queueOrder();
    const account = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB", maxBetCount: 1 });
    getAccount.mockReturnValue(account);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
    let deliver!: (value: unknown) => void;
    betting.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    updateVenueOrders.mockResolvedValue([]);
    const tick = processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(betting).toHaveBeenCalledOnce());
    const replacement = queueOrder({ isCreateOrder: true, linkId: 0, betCount: 3 });
    deliver({ success: true, provider: "OB", orderId: "old-ob-accepted" });
    await tick;
    const actual = { binds: saveOrderBind.mock.calls.length, count: timing.readBetCount(1, 100, "Home"),
      canBetAgain: timing.passesMaxBetCount(account, 100, "Home"), replacementCount: replacement.betCount };
    expect(loseOrders.get(100)).toBe(replacement);
    expect(actual).toEqual({ binds: 1, count: 1, canBetAgain: false, replacementCount: 3 });
  });

  it("OB 成交后的持久化出队不能先于绑定和计数而丢失刷新恢复依据", async () => {
    const timing = await vi.importActual<typeof import("@/shared/betTiming")>("@/shared/betTiming");
    sessionStorage.removeItem("BETCOUNT:1:100:Home");
    markSuccessfulBet.mockImplementation((account: PlatformAccount, id: number, side: "Home" | "Away") =>
      timing.incrementBetCount(account.accountId, id, side));
    matchs.push(makeMatch(makeBet([makeItem("OB", 4)])));
    queueOrder();
    const account = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB", maxBetCount: 1 });
    getAccount.mockReturnValue(account);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "filled-ob" });
    updateVenueOrders.mockResolvedValue([]);
    let release!: (ok: boolean) => void;
    saveOrderBind.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const tick = processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce());
    const restored = JSON.parse(sessionStorage.getItem("LOSEORDER") || "[]");
    const snapshot = { savedQueues: restored.length, deferredBinds: peekPendingOrderBinds().length,
      count: timing.readBetCount(1, 100, "Home"), canBetAgain: timing.passesMaxBetCount(account, 100, "Home") };
    // 完成本页任务，断言只使用刷新发生时的持久化快照。
    release(true);
    await tick;
    // 若已删除队列，应已有可恢复的收尾记录；此版本两者都没有，计数也尚未写。
    expect(snapshot.savedQueues > 0 || (snapshot.deferredBinds > 0 && snapshot.count === 1)).toBe(true);
  });

  it("PM 已完成的队列在其它盘口等待期间刷新不再提交", async () => {
    const pmBet=makeBet([makeItem("Polymarket",4)]);
    const obBet={...makeBet([makeItem("OB",3.8)]),id:101};
    const match=makeMatch(pmBet);
    match.bets.push(obBet as never);
    matchs.push(match);
    const original=queueOrder();
    loseOrders.set(101,new LoseOrder({...original.toJSON(),betId:101}));
    // 与真实 createOrder.persist 一致：发送前队列已保存，尚无原单 orderId。
    sessionStorage.setItem("LOSEORDER", JSON.stringify([...loseOrders.values()].map(order=>order.toJSON())));
    const pm=new PlatformAccount({accountId:47,playerName:"pm",provider:"Polymarket"});
    const ob=new PlatformAccount({accountId:1,playerName:"ob",provider:"OB"});
    getAccount.mockImplementation((provider:PlatformId)=>provider==="Polymarket"?pm:ob);
    let release!:()=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    checkBetting.mockImplementation(async(acc:PlatformAccount,opt:BetOption)=>{
      if(acc.provider==="OB") await hold;
      opt.data={};return opt;
    });
    betting.mockImplementation(async(acc:PlatformAccount)=>({success:true,provider:acc.provider,
      pending:acc.provider==="Polymarket",orderId:"original-filled"}));
    settlePolymarketDelayedOrder.mockResolvedValue({outcome:"matched",row:null});
    updateVenueOrders.mockResolvedValue([]);
    const oldTick=processLoseOrders({setMessage:vi.fn()});
    await vi.waitFor(()=>expect(checkBetting).toHaveBeenCalledTimes(2));
    expect(markSuccessfulBet).toHaveBeenCalledWith(pm,100,"Home");
    expect(loseOrders.has(100)).toBe(false);
    // 模拟刷新：旧循环消失，按真实 LoseOrder 构造器恢复已保存的同一笔队列。
    loseOrders.clear();
    for(const raw of JSON.parse(sessionStorage.getItem("LOSEORDER") || "[]"))
      if(raw.betId===100) loseOrders.set(100,new LoseOrder(raw));
    await processLoseOrders({setMessage:vi.fn()});
    release();await oldTick;
    expect(betting.mock.calls.filter(call=>call[0].provider==="Polymarket")).toHaveLength(1);
  });

  it.each([
    { provider: "OB", rejected: false, id: "official" },
    { provider: "OB", rejected: true, id: "official" },
    { provider: "RAY", rejected: false, id: "" },
    { provider: "RAY", rejected: true, id: "" },
  ] as const)("$provider 已确定 rejected=$rejected 刷新后只绑定原单，不重下或改判", async ({ provider, rejected, id }) => {
    const account = new PlatformAccount({ accountId: 1, playerName: "regular", provider });
    findAccount.mockReturnValue(account);
    const order = queueOrder({ pendingVenueOrderId: id, pendingVenueAccountId: 1,
      pendingVenueOdds: 4, pendingVenueBetMoney: 50,
      pendingRegularReceipt: { checkAt: Date.now() + 10000, rejected, bindOrderId: "detected-original" } });
    loseOrders.set(100, new LoseOrder(order.toJSON()));
    // 恢复时最新列表即使已变化，也不能拿它重新判断这个已确定的原单。
    updateVenueOrders.mockResolvedValue([{ orderId: "another-order", status: rejected ? "none" : "reject" } as VenueOrder]);
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(markSuccessfulBet).toHaveBeenCalledOnce());
    expect(betting).not.toHaveBeenCalled();
    expect(updateVenueOrders).not.toHaveBeenCalled();
    expect(saveOrderBind).toHaveBeenCalledExactlyOnceWith({ orders: JSON.stringify([
      { LinkID: order.linkId, Provider: provider, PlayerID: 1, OrderID: "detected-original" },
    ]) });
    expect(loseOrders.has(100)).toBe(rejected);
    expect(loseOrders.get(100)?.pendingRegularReceipt).toBeUndefined();
  });

  it.each([0, 5])("普通馆恢复只等剩余 %s 秒，到时仍检测原单", async (remainingSeconds) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const account = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
      findAccount.mockReturnValue(account);
      const original = queueOrder({ pendingVenueOrderId: "accepted-before-refresh", pendingVenueAccountId: 1,
        pendingVenueOdds: 4, pendingVenueBetMoney: 50,
        pendingRegularReceipt: { checkAt: now + remainingSeconds * 1000 } });
      loseOrders.set(100, new LoseOrder(original.toJSON()));
      updateVenueOrders.mockResolvedValue([]);
      await processLoseOrders({ setMessage: vi.fn() });
      await vi.waitFor(() => expect(markSuccessfulBet).toHaveBeenCalledOnce());
      const { venueRejectWaitBeforePoll } = await import("@changmen/venue-browser/adapter/shared/rejectWait");
      expect(venueRejectWaitBeforePoll).toHaveBeenCalledWith(remainingSeconds);
      expect(updateVenueOrders).toHaveBeenCalledOnce();
      expect(updateVenueOrders.mock.calls[0][1]).toMatchObject({ pendingBindOrderId: "accepted-before-refresh" });
      expect(betting).not.toHaveBeenCalled();
    }
    finally {
      clock.mockRestore();
    }
  });

  it("普通馆续查失败保留原回执，下轮继续核验而不重新下注", async () => {
    const account = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
    findAccount.mockReturnValue(account);
    queueOrder({ pendingVenueOrderId: "accepted-query-failure", pendingVenueAccountId: 1,
      pendingRegularReceipt: { checkAt: Date.now() - 1000 } });
    updateVenueOrders.mockResolvedValue([]).mockRejectedValueOnce(new Error("offline"));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(updateVenueOrders).toHaveBeenCalledOnce());
    expect(loseOrders.get(100)?.pendingVenueOrderId).toBe("accepted-query-failure");
    expect(markSuccessfulBet).not.toHaveBeenCalled();
    await processLoseOrders({ setMessage: vi.fn() });
    expect(updateVenueOrders).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(markSuccessfulBet).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(betting).not.toHaveBeenCalled();
    expect(loseOrders.has(100)).toBe(false);
  });
  it("取消队列后原单成交仍计入原账号的同场同边次数", async()=>{
    const timing=await vi.importActual<typeof import("@/shared/betTiming")>("@/shared/betTiming");
    sessionStorage.removeItem("BETCOUNT:47:100:Home");
    markSuccessfulBet.mockImplementationOnce((account:PlatformAccount,id:number,side:"Home"|"Away")=>
      timing.incrementBetCount(account.accountId,id,side));
    matchs.push(makeMatch(makeBet([makeItem("Polymarket",4)])));
    queueOrder();
    const pm=new PlatformAccount({accountId:47,playerName:"pm",provider:"Polymarket",maxBetCount:1});
    getAccount.mockReturnValue(pm);
    checkBetting.mockImplementation(async(_acc,opt:BetOption)=>{opt.data={};return opt;});
    let deliver!:(result:unknown)=>void;
    betting.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));
    settlePolymarketDelayedOrder.mockResolvedValue({outcome:"matched",row:null});
    updateVenueOrders.mockResolvedValue([]);
    const tick=processLoseOrders({setMessage:vi.fn()});
    await vi.waitFor(()=>expect(betting).toHaveBeenCalledOnce());
    queueOrder({isCreateOrder:true,linkId:0,betCount:3});
    deliver({success:true,provider:"Polymarket",pending:true,orderId:"filled-after-cancel"});
    await tick;
    expect(saveOrderBind).toHaveBeenCalledOnce();
    const actual={count:timing.readBetCount(47,100,"Home"),canBetAgain:timing.passesMaxBetCount(pm,100,"Home")};
    // 清除仅属于本复现用例的 mock，避免影响跳过或后续用例。
    markSuccessfulBet.mockReset();
    expect(actual).toEqual({count:1,canBetAgain:false});
  });
  it("PM 受理后立刻保存原单，刷新只续查原 ID 和 USDC 金额", async () => {
    matchs.push(makeMatch(makeBet([makeItem("Polymarket", 4)])));
    queueOrder();
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    getAccount.mockReturnValue(pm);
    findAccount.mockReturnValue(pm);
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = {};
      return option;
    });
    betting.mockResolvedValue({ success: true, provider: "Polymarket", pending: true,
      orderId: "original-delayed", beginTime: Date.now(),
      request: { order: { side: "BUY", makerAmount: "14930000" } } });
    let complete!: (outcome: unknown) => void;
    settlePolymarketDelayedOrder.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const tick = processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce());
    const [saved] = JSON.parse(sessionStorage.getItem("LOSEORDER") || "[]");
    expect(saved).toMatchObject({ pendingVenueOrderId: "original-delayed",
      pendingPmSubmission: { stakeUsdc: 14.93, makerAmount: "14930000" } });
    // 有矛盾成交证据时仍保留原单；策略超时判拒另有独立测试。
    complete({ outcome: "timeout", row: { size_matched: "1", original_size: "5" } });
    await tick;
    const restored = new LoseOrder(saved);
    restored.pendingVenueNextPollAt = 0;
    loseOrders.set(100, restored);
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(loseOrders.has(100)).toBe(false));
    expect(betting).toHaveBeenCalledOnce();
    expect(settlePolymarketDelayedOrder.mock.calls[1][1]).toBe("original-delayed");
    expect(markSuccessfulBet).toHaveBeenCalledExactlyOnceWith(pm, 100, "Home");
  });
  it("计数写入失败不能重新开放已经成交的补单", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 3.8)])));
    queueOrder({ pendingVenueOrderId: "0xstorage-error",
      pendingPmSubmission: { orderId: "0xstorage-error", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    const ob = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
    findAccount.mockReturnValue(pm);
    getAccount.mockReturnValue(ob);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "duplicate" });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    markSuccessfulBet.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(markSuccessfulBet).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 20));
    const afterConfirm = loseOrders.has(100);
    await processLoseOrders({ setMessage: vi.fn() });
    expect({ queuePresentAfterFill: afterConfirm, extraSubmissions: betting.mock.calls.length })
      .toEqual({ queuePresentAfterFill: false, extraSubmissions: 0 });
  });
  it("PM 已发出的 delayed 补单在队列重建后仍完成确认和原 Link 绑定", async () => {
    matchs.push(makeMatch(makeBet([makeItem("Polymarket", 4)])));
    queueOrder();
    getAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" }));
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
    let deliver!: (value: unknown) => void;
    betting.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    const tick = processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(betting).toHaveBeenCalledOnce());
    const replacement = queueOrder({ isCreateOrder: true, betCount: 3, linkId: 0 });
    deliver({ success: true, provider: "Polymarket", pending: true, orderId: "0xaccepted-original" });
    await tick;
    expect(loseOrders.get(100)).toBe(replacement);
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce();
    expect(saveOrderBind).toHaveBeenCalledOnce();
  });
  it.each(["count", "notification", "atomic-clear", "remove-persist"])("PM 成交后 %s 路径只消费一次", async (fault) => {
    queueOrder({ pendingVenueOrderId: "0xcompletion-fault",
      pendingPmSubmission: { orderId: "0xcompletion-fault", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    findAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" }));
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    const fail = () => { throw new Error("completion fault"); };
    if (fault === "count")
      markSuccessfulBet.mockImplementationOnce(fail);
    else if (fault === "notification")
      loseOrderMessage.mockImplementationOnce(fail);
    else if (fault === "remove-persist") {
      const remove = removeOrder.getMockImplementation()!;
      removeOrder.mockImplementationOnce((id) => { remove(id); fail(); });
    }

    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(loseOrders.has(100)).toBe(false));
    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).toHaveBeenCalledOnce();
    expect(clearPendingVenueOrder).toHaveBeenCalledWith(100, false);
    expect(betting).not.toHaveBeenCalled();
  });

  it.each(["Polymarket", "OB"] as const)("%s 同步补单计数异常不阻断出队", async (provider) => {
    matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
    queueOrder();
    getAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "venue", provider }));
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => { opt.data = {}; return opt; });
    betting.mockResolvedValue({ success: true, provider, pending: provider === "Polymarket", orderId: "0xsync-complete" });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    markSuccessfulBet.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });

    if (provider === "Polymarket")
      await processLoseOrders({ setMessage: vi.fn() });
    else
      await expect(processLoseOrders({ setMessage: vi.fn() })).rejects.toThrow("QuotaExceededError");
    await processLoseOrders({ setMessage: vi.fn() });

    expect(loseOrders.has(100)).toBe(false);
    expect(betting).toHaveBeenCalledOnce();
  });

  it("旧 PM 单绑定失败后仍加入原 Link 的补绑队列", async () => {
    queueOrder({ pendingVenueOrderId: "0xdetached-bind",
      pendingPmSubmission: { orderId: "0xdetached-bind", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    findAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" }));
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    let release!: (value: boolean) => void;
    saveOrderBind.mockResolvedValue(false);
    saveOrderBind.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce());
    const replacement = queueOrder({ isCreateOrder: true, linkId: 0, betCount: 3 });
    release(false);
    await vi.waitFor(() => expect(peekPendingOrderBinds()).toHaveLength(1));

    expect(peekPendingOrderBinds()[0]).toMatchObject({
      linkId: 1_000_000_000_001, accountId: 47, orderId: "0xdetached-bind",
    });
    expect(loseOrders.get(100)).toBe(replacement);
    expect(replacement.betCount).toBe(3);
    expect(removeOrder).not.toHaveBeenCalled();
  });

  it.each(["account", "token", "session"])("原队列取消后的续查在 %s 撤销后停止", async (revoked) => {
    queueOrder({ pendingVenueOrderId: `0x-revoked-${revoked}`,
      pendingPmSubmission: { orderId: `0x-revoked-${revoked}`, accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    const account = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    findAccount.mockReturnValue(account);
    let release!: (value: unknown) => void;
    settlePolymarketDelayedOrder.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    updateVenueOrders.mockResolvedValue([]);
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce());
    const replacement = queueOrder({ isCreateOrder: true, linkId: 0, betCount: 3 });
    release({ outcome: "timeout", row: { size_matched: "1", original_size: "5" } });
    await new Promise(resolve => setTimeout(resolve, 20));
    if (revoked === "account")
      findAccount.mockReturnValue(undefined);
    else if (revoked === "token")
      account.token = "changed";
    else
      advanceAuthSessionVersion();
    await new Promise(resolve => setTimeout(resolve, 1_100));

    expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce();
    expect(saveOrderBind).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
    expect(loseOrders.get(100)).toBe(replacement);
  });

  it.each(["matched", "unfilled"])("PM %s 原单在绑定完成前保持锁，不重复提交", async (outcome) => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 3.8)])));
    queueOrder({ pendingVenueOrderId: "0xreview-filled",
      pendingPmSubmission: { orderId: "0xreview-filled", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home",
      pendingVenueConditionId: "b1", pendingVenueMakeUpEligible: true });
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    const ob = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
    findAccount.mockReturnValue(pm);
    getAccount.mockReturnValue(ob);
    checkBetting.mockImplementation(async (_acc, option: BetOption) => { option.data = {}; return option; });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "duplicate" });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome, row: null });
    updateVenueOrders.mockResolvedValue([]);
    let releaseBind!: (value: boolean) => void;
    saveOrderBind.mockImplementationOnce(() => new Promise<boolean>(resolve => { releaseBind = resolve; }));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledTimes(1));
    expect(loseOrders.get(100)?.pendingVenueOrderId).toBe("0xreview-filled");
    await processLoseOrders({ setMessage: vi.fn() });
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce();
    const duplicateCount = betting.mock.calls.length;
    releaseBind(true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(duplicateCount).toBe(0);
    if (outcome === "matched") {
      expect(loseOrders.has(100)).toBe(false);
    }
    else {
      expect(loseOrders.get(100)?.pendingVenueOrderId).toBeUndefined();
      await processLoseOrders({ setMessage: vi.fn() });
      expect(betting).toHaveBeenCalledOnce();
      expect(betting.mock.calls[0][0].provider).toBe("OB");
    }
  });
  it.each(["matched", "unfilled", "pending"])("PM %s 旧查询不能清除、扣减或回写同盘口新队列", async (outcome) => {
    queueOrder({ pendingVenueOrderId: "0xreview-replaced",
      pendingPmSubmission: { orderId: "0xreview-replaced", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home",
      pendingVenueConditionId: "b1", pendingVenueMakeUpEligible: true });
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    findAccount.mockReturnValue(pm);
    let settle!: (value: unknown) => void;
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    settlePolymarketDelayedOrder.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    updateVenueOrders.mockResolvedValue([]);
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce());
    const replacement = queueOrder({ linkId: 2000000000002, target: "Away" });
    settle(outcome === "pending"
      ? { outcome: "timeout", row: { size_matched: "1", original_size: "5" } }
      : { outcome, row: null });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loseOrders.get(100)).toBe(replacement);
    expect(clearPendingVenueOrder).not.toHaveBeenCalled();
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
    expect(deferPendingVenueOrder).not.toHaveBeenCalled();
    expect(removeOrder).not.toHaveBeenCalled();
    expect(markSuccessfulBet).toHaveBeenCalledTimes(outcome === "pending" ? 0 : 1);
    if (outcome === "pending") {
      await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce(), { timeout: 2_000 });
      expect(settlePolymarketDelayedOrder).toHaveBeenCalledTimes(2);
      expect(loseOrders.get(100)).toBe(replacement);
      expect(clearPendingVenueOrder).not.toHaveBeenCalled();
      expect(markSuccessfulBet).toHaveBeenCalledOnce();
    }
  });
  it("PM 已清除 pending 到出队之间，主循环仍不能再次消费", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 3.8)])));
    queueOrder({ pendingVenueOrderId: "0xmicrotask",
      pendingPmSubmission: { orderId: "0xmicrotask", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    findAccount.mockReturnValue(pm);
    getAccount.mockReturnValue(new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" }));
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "matched", row: null });
    updateVenueOrders.mockResolvedValue([]);
    let interleavedTick: Promise<void> | undefined;
    markSuccessfulBet.mockImplementationOnce(() => {
      expect(loseOrders.get(100)?.pendingVenueOrderId).toBeUndefined();
      interleavedTick = processLoseOrders({ setMessage: vi.fn() });
    });

    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(removeOrder).toHaveBeenCalledWith(100));
    await interleavedTick;

    expect(getAccount).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
    expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce();
  });

  it.each(["matched", "unfilled"])("PM %s 绑定期间取消重建，旧收尾不影响新队列", async (outcome) => {
    queueOrder({ pendingVenueOrderId: "0xlate-bind",
      pendingPmSubmission: { orderId: "0xlate-bind", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    findAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" }));
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome, row: null });
    updateVenueOrders.mockResolvedValue([]);
    let releaseBind!: (value: boolean) => void;
    saveOrderBind.mockImplementationOnce(() => new Promise<boolean>(resolve => { releaseBind = resolve; }));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(saveOrderBind).toHaveBeenCalledOnce());
    const replacement = queueOrder({ linkId: 2000000000002, betCount: 3,
      pendingVenueOrderId: "0xnew-order", pendingVenueAccountId: 99 });
    releaseBind(true);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(loseOrders.get(100)).toBe(replacement);
    expect(replacement.betCount).toBe(3);
    expect(replacement.pendingVenueOrderId).toBe("0xnew-order");
    expect(clearPendingVenueOrder).not.toHaveBeenCalled();
    expect(removeOrder).not.toHaveBeenCalled();
    expect(markSuccessfulBet).toHaveBeenCalledOnce();
  });

  it("旧 PM 查询失败不能给同盘口新队列设置退避", async () => {
    queueOrder({ pendingVenueOrderId: "0xlate-error",
      pendingPmSubmission: { orderId: "0xlate-error", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47, pendingVenueRole: "target", pendingVenueTarget: "Home" });
    findAccount.mockReturnValue(new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" }));
    let rejectQuery!: (error: Error) => void;
    settlePolymarketDelayedOrder.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectQuery = reject; }));
    await processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(settlePolymarketDelayedOrder).toHaveBeenCalledOnce());
    const replacement = queueOrder({ pendingVenueOrderId: "0xreplacement", pendingVenueAccountId: 99 });
    rejectQuery(new Error("offline"));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(loseOrders.get(100)).toBe(replacement);
    expect(replacement.pendingVenueNextPollAt).toBeUndefined();
    expect(deferPendingVenueOrder).not.toHaveBeenCalled();
  });

  it.each(["precheck", "submission"])("补单 %s 期间重建队列，旧消费不再提交或删除新队列", async (phase) => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 3.8), makeItem("RAY", 3.7)])));
    queueOrder();
    const account = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
    getAccount.mockReturnValue(account);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    checkBetting.mockImplementation(async (_acc, option: BetOption) => {
      if (phase === "precheck")
        await gate;
      option.data = {};
      return option;
    });
    betting.mockImplementation(async () => {
      await gate;
      return { success: true, provider: "OB", orderId: "old-submission" };
    });
    const tick = processLoseOrders({ setMessage: vi.fn() });
    await vi.waitFor(() => expect(phase === "precheck" ? checkBetting : betting).toHaveBeenCalledOnce());
    const replacement = queueOrder({ isCreateOrder: true, betCount: 3 });
    release();
    await tick;

    expect(loseOrders.get(100)).toBe(replacement);
    expect(replacement.betCount).toBe(3);
    expect(betting).toHaveBeenCalledTimes(phase === "precheck" ? 0 : 1);
    expect(getAccount).toHaveBeenCalledOnce();
    expect(removeOrder).not.toHaveBeenCalled();
  });

  it("每 tick 每个 item 只 getAccount 一次；下注失败继续下一 item", async () => {
    const bet = makeBet([makeItem("OB", 2.5), makeItem("RAY", 2.4)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const obAcc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    const rayAcc = new PlatformAccount({ accountId: 2, playerName: "ray1", provider: "RAY" });
    getAccount.mockImplementation((provider: PlatformId) =>
      provider === "OB" ? obAcc : rayAcc,
    );
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockImplementation(async (acc: PlatformAccount) => {
      return { success: false, provider: acc.provider };
    });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(betting).toHaveBeenCalledTimes(2);
    expect(removeOrder).not.toHaveBeenCalled();
  });

  it.each([
    { label: "PM 拒单后同轮换馆", providers: ["Polymarket", "OB"], manual: false, count: 1, wait: 10 },
    { label: "PM 手动多次队列", providers: ["Polymarket"], manual: true, count: 3, wait: 10 },
    { label: "OB 手动多次队列", providers: ["OB"], manual: true, count: 3, wait: 10 },
    { label: "PM 跳过拒单复检", providers: ["Polymarket"], manual: false, count: 1, wait: -1 },
  ])("与 A8 原始消费段回放一致：$label", async ({ providers, manual, count, wait }) => {
    async function replay(reference: boolean) {
      loseOrders.clear();
      matchs.length = 0;
      betting.mockReset();
      checkBetting.mockReset();
      markSuccessfulBet.mockClear();
      settlePolymarketDelayedOrder.mockReset();
      const items = providers.map((p, index) => makeItem(p as PlatformId, 4 - index * 0.2));
      const bet = makeBet(items);
      matchs.push(makeMatch(bet));
      queueOrder({ betOdds: manual ? 4 : 2, isCreateOrder: manual, betCount: count });
      const accounts = new Map(providers.map((p, index) => {
        const account = new PlatformAccount({ accountId: index + 1, playerName: p, provider: p as PlatformId });
        Object.assign(account, { updateOrders: async () => [{
          orderId: p, provider: p, status: p === "Polymarket" ? "reject" : "none", createAt: 1,
        }] });
        return [p, account] as const;
      }));
      getAccount.mockImplementation((p: PlatformId) => accounts.get(p));
      checkBetting.mockImplementation(async (_account, option: BetOption) => {
        option.data = { ok: true };
        return option;
      });
      betting.mockImplementation(async (account: PlatformAccount) => ({
        provider: account.provider, success: true, orderId: account.provider, pending: account.provider === "Polymarket",
      }));
      updateVenueOrders.mockResolvedValue([]);
      settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });
      vi.mocked(makeUpBetToastSeconds).mockReturnValue(wait === -1 ? 0 : 10);

      if (reference) {
        await runA8MakeupConsumer(
          { orders: loseOrders, removeOrder },
          { config: { makeUp: true, makeProfit: 1.01, noSameProvider: false, waitTime: { Polymarket: wait, OB: wait } } },
          { value: matchs }, { getAccount, checkBetting, betting }, { value: new Map() }, () => [],
          { tip: () => {}, getOpponent: (side: string) => side === "Home" ? "Away" : "Home" },
          BetOption, { wait: async () => {} }, { saveOrderBind },
          class { constructor(public LinkID: number, public Provider: string, public OrderID: string) {} },
          { send: { LoseOrderMessage: loseOrderMessage } }, { reject: "reject" }, markSuccessfulBet,
        );
      }
      else {
        await processLoseOrders({ setMessage: vi.fn() });
      }
      return {
        attempts: betting.mock.calls.map(call => ({ provider: call[0].provider, stake: call[1].betMoney })),
        remaining: loseOrders.get(100)?.betCount ?? 0,
        marked: markSuccessfulBet.mock.calls.map(call => call[0].provider),
      };
    }
    const original = await replay(true);
    expect(await replay(false)).toEqual(original);
  });

  it("does not call updateOdds on bet items before consume (A8 jb)", async () => {
    const item = makeItem("OB", 2.5);
    const bet = makeBet([item]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "OB" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(item.updateOdds).not.toHaveBeenCalled();
  });

  it("jb still bets when list odds are high (A8: no makeUp_odds gate in consume)", async () => {
    // 入队阈值已前移；消费期即使盘口价很高也应尝试下注（对照 index0706 jb 无 B()）
    const item = makeItem("OB", 3.2);
    const bet = makeBet([item]);
    matchs.push(makeMatch(bet));
    queueOrder({ betOdds: 1.85 });

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "OB" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });

  it("keeps list-odds stake after checkBetting (A8 jb: no liveOdds recalc)", async () => {
    const item = makeItem("IA", 9.55);
    const bet = makeBet([item]);
    matchs.push(makeMatch(bet));
    queueOrder({ betMoney: 70, betOdds: 4.095 });

    const acc = new PlatformAccount({ accountId: 49, playerName: "1", provider: "IA" });
    getAccount.mockReturnValue(acc);

    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.newOdds = 1.35;
      opt.odds = 1.35;
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "IA" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(checkBetting).toHaveBeenCalledTimes(1);
    expect(checkBetting.mock.calls[0][1].betMoney).toBe(30);
    expect(betting).toHaveBeenCalledWith(
      acc,
      expect.objectContaining({ betMoney: 30, odds: 1.35 }),
      10,
      expect.objectContaining({ linkId: expect.any(Number) }),
    );
  });

  it("aPI 成功 + 场馆拒单：不移出队列，仍绑单并发 LoseOrderMessage", async () => {
    const bet = makeBet([makeItem("OB", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    updateVenueOrders.mockResolvedValueOnce([
      {
        orderId: "oid1",
        provider: "OB",
        status: "reject",
        createAt: 1,
        odds: 2,
        betMoney: 16,
        reward: 0,
        money: 0,
        match: "",
        bet: "",
        item: "",
        game: "",
      },
    ]);

    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "oid1" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).not.toHaveBeenCalled();
    expect(saveOrderBind).toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
    expect(markSuccessfulBet).toHaveBeenCalled();
  });

  it("jb keeps queue when orders[0] is reject (A8: only checks newest venue row)", async () => {
    const bet = makeBet([makeItem("OB", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    updateVenueOrders.mockResolvedValueOnce([
      {
        orderId: "old-reject",
        provider: "OB",
        status: "reject",
        createAt: 2000,
        odds: 2,
        betMoney: 16,
        reward: 0,
        money: 0,
        match: "",
        bet: "",
        item: "",
        game: "",
      },
      {
        orderId: "new-ok",
        provider: "OB",
        status: "none",
        createAt: 1000,
        odds: 2,
        betMoney: 16,
        reward: 0,
        money: 0,
        match: "",
        bet: "",
        item: "",
        game: "",
      },
    ]);

    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: true, provider: "OB", orderId: "new-ok" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
  });

  it("jb continues to next platform on reject in same tick (A8)", async () => {
    const bet = makeBet([makeItem("OB", 2.5), makeItem("RAY", 2.4)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const obAcc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    const rayAcc = new PlatformAccount({ accountId: 2, playerName: "ray1", provider: "RAY" });
    getAccount.mockImplementation((provider: PlatformId) =>
      provider === "OB" ? obAcc : rayAcc,
    );
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockImplementation(async (acc: PlatformAccount) => {
      if (acc.provider === "OB")
        return { success: true, provider: "OB", orderId: "oid1" };
      return { success: false, provider: "RAY" };
    });
    updateVenueOrders.mockResolvedValueOnce([
      {
        orderId: "oid1",
        provider: "OB",
        status: "reject",
        createAt: 1,
        odds: 2,
        betMoney: 16,
        reward: 0,
        money: 0,
        match: "",
        bet: "",
        item: "",
        game: "",
      },
    ]);

    await processLoseOrders({ setMessage: vi.fn() });

    expect(betting).toHaveBeenCalledTimes(2);
    expect(removeOrder).not.toHaveBeenCalled();
  });

  it("isCreateOrder 成功：出队、markSuccessfulBet，不发 LoseOrderMessage", async () => {
    const bet = makeBet([makeItem("OB", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder({ isCreateOrder: true });

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: true, provider: "OB" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).toHaveBeenCalledWith(100);
    expect(loseOrderMessage).not.toHaveBeenCalled();
    expect(a8Tip).not.toHaveBeenCalled();
    expect(markSuccessfulBet).toHaveBeenCalledWith(acc, 100, "Home");
  });

  it("PM delayed：场馆 sync 为空时用 result.orderId 绑单并出队", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    updateVenueOrders.mockResolvedValueOnce([]);
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({
      success: true,
      provider: "Polymarket",
      orderId: "0xdelayed-order",
    });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).toHaveBeenCalledWith(100);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([
        {
          LinkID: 1_000_000_000_001,
          Provider: "Polymarket",
          PlayerID: 47,
          OrderID: "0xdelayed-order",
        },
      ]),
    });
    expect(markSuccessfulBet).toHaveBeenCalledWith(acc, 100, "Home");
  });

  it("PM delayed pending unfilled：拒单检测判拒，不出队", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({
      success: true,
      provider: "Polymarket",
      pending: true,
      orderId: "0xdelayed-unfilled",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
  });

  it.each(["unfilled", "timeout"])("PM %s 判拒后同轮尝试下一场馆 (A8)", async (outcome) => {
    const bet = makeBet([makeItem("Polymarket", 4), makeItem("OB", 3.8)]);
    matchs.push(makeMatch(bet));
    queueOrder();
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    const ob = new PlatformAccount({ accountId: 1, playerName: "ob", provider: "OB" });
    getAccount.mockImplementation((provider: PlatformId) => provider === "Polymarket" ? pm : ob);
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
    betting.mockImplementation(async (account: PlatformAccount) => ({
      success: true, provider: account.provider,
      pending: account.provider === "Polymarket", orderId: `${account.provider}-order`,
    }));
    settlePolymarketDelayedOrder.mockResolvedValueOnce({ outcome, row: null });
    updateVenueOrders.mockResolvedValueOnce([]);

    await processLoseOrders({ setMessage: vi.fn() });

    expect(betting.mock.calls.map(call => call[0].provider)).toEqual(["Polymarket", "OB"]);
    expect(markSuccessfulBet).toHaveBeenCalledWith(pm, 100, "Home");
    expect(removeOrder).toHaveBeenCalledWith(100);
  });

  it("PM 检测未结束时保留原单，禁止向下一场馆重复提交", async () => {
    const bet = makeBet([makeItem("Polymarket", 4), makeItem("OB", 3.8)]);
    matchs.push(makeMatch(bet));
    queueOrder();
    const pm = new PlatformAccount({ accountId: 47, playerName: "pm", provider: "Polymarket" });
    getAccount.mockReturnValue(pm);
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
    betting.mockResolvedValue({ success: true, provider: "Polymarket", pending: true, orderId: "partial" });
    settlePolymarketDelayedOrder.mockResolvedValueOnce({
      outcome: "timeout", row: { size_matched: "1", original_size: "5" },
    });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(betting).toHaveBeenCalledOnce();
    expect(loseOrders.get(100)?.pendingVenueOrderId).toBe("partial");
    expect(removeOrder).not.toHaveBeenCalled();
    expect(markSuccessfulBet).not.toHaveBeenCalled();
  });

  it.each(["OB", "Polymarket"] as const)("%s 手动队列成功一次只减一次，不做拒单复检 (A8)", async (provider) => {
    matchs.push(makeMatch(makeBet([makeItem(provider, 4)])));
    queueOrder({ isCreateOrder: true, betOdds: 4, betCount: 3 });
    const account = new PlatformAccount({ accountId: 47, playerName: "manual", provider });
    getAccount.mockReturnValue(account);
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
    betting.mockResolvedValue({ success: true, provider, pending: provider === "Polymarket", orderId: "manual" });

    await processLoseOrders({ setMessage: vi.fn() });
    expect(loseOrders.get(100)?.betCount).toBe(2);
    await processLoseOrders({ setMessage: vi.fn() });
    expect(loseOrders.get(100)?.betCount).toBe(1);
    await processLoseOrders({ setMessage: vi.fn() });
    expect(loseOrders.has(100)).toBe(false);
    expect(betting).toHaveBeenCalledTimes(3);
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(updateVenueOrders).not.toHaveBeenCalled();
  });

  it("PM 核验耗尽按策略判拒，下一轮恢复补单而非永久续查", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();


    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    getAccount.mockReturnValue(acc);
    findAccount.mockImplementation(id => (Number(id) === 47 ? acc : undefined));
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValueOnce({
      success: true,
      provider: "Polymarket",
      pending: true,
      orderId: "0xtimeout-order",
    }).mockResolvedValueOnce({ success: false, provider: "Polymarket" });
    settlePolymarketDelayedOrder.mockResolvedValueOnce({ outcome: "timeout", row: null });

    await processLoseOrders({ setMessage: vi.fn() });
    await processLoseOrders({ setMessage: vi.fn() });

    expect(betting).toHaveBeenCalledTimes(2);
    // 受理时保存原单；超时策略判拒后清锁，不会把该单永久留在 pending。
    expect(setPendingVenueOrder).toHaveBeenCalledOnce();
    expect(loseOrders.get(100)?.pendingVenueOrderId).toBeUndefined();
    expect(removeOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
  });

  it("PM waitTime=-1：接口成功即出队，不做拒单检测 (A8)", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    vi.mocked(makeUpBetToastSeconds).mockReturnValueOnce(0);

    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({
      success: true,
      provider: "Polymarket",
      pending: true,
      orderId: "0xdelayed-unfilled-wait0",
    });
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).toHaveBeenCalledWith(100);
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).not.toHaveBeenCalled();
  });

  it("PM waitTime=-1：不做拒单复检或额外绑单 (A8)", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    vi.mocked(makeUpBetToastSeconds).mockReturnValueOnce(0);

    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    updateVenueOrders.mockResolvedValueOnce([]);
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({
      success: true,
      provider: "Polymarket",
      orderId: "0xdelayed-skip-wait",
    });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(saveOrderBind).not.toHaveBeenCalled();
    expect(settlePolymarketDelayedOrder).not.toHaveBeenCalled();
    expect(removeOrder).toHaveBeenCalledWith(100);
  });

  it("PM success ref in queue: jb consumes RAY with CNY stake from getBetMoney", async () => {
    const bet = makeBet([makeItem("RAY", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder({ betMoney: 98, betOdds: 1.695 });

    const acc = new PlatformAccount({ accountId: 2, playerName: "ray1", provider: "RAY" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "RAY" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(checkBetting).toHaveBeenCalledTimes(1);
    expect(checkBetting.mock.calls[0][1].betMoney).toBe(66);
    expect(betting).toHaveBeenCalledWith(
      acc,
      expect.objectContaining({ betMoney: 66 }),
      10,
      expect.objectContaining({ linkId: expect.any(Number) }),
    );
  });

  it("dequeues arb-linked makeup when bet not on match list (A8)", async () => {
    queueOrder();
    await processLoseOrders({ setMessage: vi.fn() });
    expect(removeOrder).toHaveBeenCalledWith(100);
  });

  it("dequeues manual isCreateOrder when bet not on match list (A8)", async () => {
    queueOrder({ linkId: 0, isCreateOrder: true });
    await processLoseOrders({ setMessage: vi.fn() });
    expect(removeOrder).toHaveBeenCalledWith(100);
  });

  it("dequeues when betting returns null (A8: le||Z.push)", async () => {
    const bet = makeBet([makeItem("OB", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(null);

    await processLoseOrders({ setMessage: vi.fn() });

    expect(removeOrder).toHaveBeenCalledWith(100);
  });

  it("RAY success ref in queue: jb consumes PM with list-odds CNY stake (1× precheck)", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.0)]);
    matchs.push(makeMatch(bet));
    queueOrder({ betMoney: 70, betOdds: 4.095 });

    const acc = new PlatformAccount({ accountId: 47, playerName: "pm1", provider: "Polymarket" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "Polymarket" });

    await processLoseOrders({ setMessage: vi.fn() });

    expect(checkBetting).toHaveBeenCalledTimes(1);
    expect(checkBetting.mock.calls[0][1].betMoney).toBe(72);
    expect(betting).toHaveBeenCalledTimes(1);
  });
});

describe("processLoseOrders makeupOddsBand", () => {
  beforeEach(() => {
    loseOrders.clear();
    matchs.length = 0;
    makeUpEnabled.value = true;
    extensionPrefs.makeupOddsBand = { enabled: true, upper: 1.02, lower: 0.96 };
    vi.clearAllMocks();
    getAccount.mockReset();
    checkBetting.mockReset();
    betting.mockReset();
  });

  function stubAccount() {
    const acc = new PlatformAccount({ accountId: 1, playerName: "ob1", provider: "OB" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue({ success: false, provider: "OB" });
    return acc;
  }

  it("skips consume when best odds sit in the band", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 2.00)])));
    queueOrder({ betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
  });

  it("does not fall through to a worse quote while best is in-band", async () => {
    matchs.push(makeMatch(makeBet([
      makeItem("OB", 2.00),
      makeItem("RAY", 1.80),
    ])));
    queueOrder({ betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).not.toHaveBeenCalled();
  });

  it("places when best odds are above the upper bound", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 2.10)])));
    queueOrder({ betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });

  it("places at a loss when best odds are below the lower bound", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 1.70)])));
    queueOrder({ betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });

  it("does not apply the band to manual isCreateOrder", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 2.00)])));
    queueOrder({ betOdds: 2, target: "Home", isCreateOrder: true });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
  });

  it("falls back to makeProfit when the hedge formula cannot be solved", async () => {
    matchs.push(makeMatch(makeBet([makeItem("OB", 250)])));
    queueOrder({ betOdds: 1, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });

  it("makeUp 关闭时即使调度补单队列也不 POST 普通补单", async () => {
    makeUpEnabled.value = false;
    const bet = makeBet([makeItem("OB", 2.5)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
  });

  it("makeUp 关闭时仍确认 PM delayed 原单，确认未成交后收尾且不 POST", async () => {
    makeUpEnabled.value = false;
    const order = queueOrder({
      pendingVenueOrderId: "0xobserve-only",
      pendingPmSubmission: { orderId: "0xobserve-only", accountId: 47,
        makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 },
      pendingVenueAccountId: 47,
      pendingVenueRole: "target",
      pendingVenueTarget: "Home",
      pendingVenueConditionId: "b1",
      pendingVenueMakeUpEligible: true,
    });
    const acc = new PlatformAccount({ accountId: 47, playerName: "D8F7", provider: "Polymarket" });
    findAccount.mockReturnValue(acc);
    settlePolymarketDelayedOrder.mockResolvedValue({ outcome: "unfilled", row: null });

    await processLoseOrders({ setMessage: vi.fn() });

    await vi.waitFor(() => expect(removeOrder).toHaveBeenCalledWith(order.betId));
    expect(betting).not.toHaveBeenCalled();
    expect(markSuccessfulBet).toHaveBeenCalledWith(acc, order.betId, "Home");
  });

  it("supports profit-rate mode without changing manual makeup behavior", async () => {
    extensionPrefs.makeupOddsBand = {
      enabled: true,
      mode: "profitRate",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    };
    matchs.push(makeMatch(makeBet([makeItem("OB", 2.05)])));
    queueOrder({ betMoney: 100, betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
  });

  it("places in profit-rate mode below the configured loss bound", async () => {
    extensionPrefs.makeupOddsBand = {
      enabled: true,
      mode: "profitRate",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    };
    matchs.push(makeMatch(makeBet([makeItem("OB", 1.8)])));
    queueOrder({ betMoney: 100, betOdds: 2, target: "Home" });
    stubAccount();

    await processLoseOrders({ setMessage: vi.fn() });

    expect(getAccount).toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });
});
