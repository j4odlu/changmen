import type { ViewMatch } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { LoseOrder } from "@/models/loseOrder";
import { PlatformAccount } from "@/models/platformAccount";
import { processLoseOrders } from "@/stores/betting/loseOrder";

import { createDefaultUserConfig } from "@/types/userConfig";

const loseOrders = vi.hoisted(() => new Map<number, LoseOrder>());
const matchs = vi.hoisted(() => [] as ViewMatch[]);

const removeOrder = vi.hoisted(() => vi.fn());
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
const updateVenueOrders = vi.hoisted(() => vi.fn(async (_acc?: PlatformAccount) => [] as VenueOrder[]));
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

vi.mock("@/stores/loseOrderStore", () => ({
  useLoseOrderStore: () => ({
    orders: loseOrders,
    removeOrder,
    setPendingVenueOrder,
    clearPendingVenueOrder,
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

vi.mock("@/shared/a8Notify", () => ({ a8Tip }));

vi.mock("@changmen/client-core/shared/wait", () => ({ wait }));

vi.mock("@/shared/betTiming", () => ({
  makeUpBetToastSeconds: vi.fn(() => 10),
}));

vi.mock("@changmen/venue-adapter/shared/rejectWait", () => ({
  venueRejectWaitBeforePoll: vi.fn(async () => {}),
}));

vi.mock("@changmen/venue-adapter/polymarket/orderSettlement", () => ({
  settlePolymarketDelayedOrder: (...args: unknown[]) => settlePolymarketDelayedOrder(...args),
}));

vi.mock("@changmen/venue-adapter/polymarket/settlementJob", () => ({
  awaitPolymarketSettlementJob: vi.fn(async () => null),
  getPolymarketSettlementDelayCtx: vi.fn(() => null),
  clearPolymarketSettlementJob: vi.fn(),
  startPolymarketSettlementJob: vi.fn(),
  clearPolymarketSettlementJobs: vi.fn(),
}));

vi.mock("@changmen/venue-adapter/polymarket/marketDelay", () => ({
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
    loseOrders.clear();
    activeBetRuns.clear();
    matchs.length = 0;
    extensionPrefs.makeupOddsBand = { enabled: false, upper: 1.02, lower: 0.96 };
    makeUpEnabled.value = true;
    vi.clearAllMocks();
    saveOrderBind.mockResolvedValue(true);
    getAccount.mockReset();
    findAccount.mockReset();
    checkBetting.mockReset();
    betting.mockReset();
    setPendingVenueOrder.mockImplementation((betId: number, orderId: string, accountId: number, opts?: {
      role?: "target" | "anchor";
      pendingTarget?: "Home" | "Away";
      conditionId?: string;
      makeUpEligible?: boolean;
    }) => {
      const order = loseOrders.get(betId);
      if (order) {
        order.pendingVenueOrderId = orderId;
        order.pendingVenueAccountId = accountId;
        order.pendingVenueRole = opts?.role ?? "target";
        order.pendingVenueTarget = opts?.pendingTarget;
        order.pendingVenueConditionId = opts?.conditionId;
        order.pendingVenueMakeUpEligible = opts?.makeUpEligible ?? true;
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

    expect(removeOrder).toHaveBeenCalledWith(100, true);
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

    expect(removeOrder).toHaveBeenCalledWith(100, true);
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

  it("PM 核验耗尽按策略判拒，下一轮恢复补单而非永久续查", async () => {
    const bet = makeBet([makeItem("Polymarket", 4.167)]);
    matchs.push(makeMatch(bet));
    queueOrder();

    vi.mocked(makeUpBetToastSeconds).mockReturnValueOnce(0);

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
    expect(setPendingVenueOrder).not.toHaveBeenCalled();
    expect(loseOrders.get(100)?.pendingVenueOrderId).toBeUndefined();
    expect(removeOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
  });

  it("PM waitTime=-1 + pending unfilled：拒单检测后不出队", async () => {
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

    expect(removeOrder).not.toHaveBeenCalled();
    expect(loseOrderMessage).toHaveBeenCalledWith(
      acc,
      expect.any(LoseOrder),
      expect.any(BetOption),
      true,
    );
  });

  it("PM delayed 且 waitTime=-1 时仍用 result.orderId 绑单", async () => {
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

    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([
        {
          LinkID: 1_000_000_000_001,
          Provider: "Polymarket",
          PlayerID: 47,
          OrderID: "0xdelayed-skip-wait",
        },
      ]),
    });
    expect(removeOrder).toHaveBeenCalledWith(100, true);
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
    expect(removeOrder).toHaveBeenCalledWith(100, true);
  });

  it("dequeues manual isCreateOrder when bet not on match list (A8)", async () => {
    queueOrder({ linkId: 0, isCreateOrder: true });
    await processLoseOrders({ setMessage: vi.fn() });
    expect(removeOrder).toHaveBeenCalledWith(100, true);
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

    expect(removeOrder).toHaveBeenCalledWith(100, true);
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

    await vi.waitFor(() => expect(removeOrder).toHaveBeenCalledWith(order.betId, true));
    expect(betting).not.toHaveBeenCalled();
    expect(markSuccessfulBet).not.toHaveBeenCalled();
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
