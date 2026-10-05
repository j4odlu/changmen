import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { ArbBetAttemptParams, ArbBetPlaced } from "./types";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { PlatformAccount } from "@/models/platformAccount";

import { createDefaultUserConfig } from "@/types/userConfig";
import { createArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import { finalizeArbBet } from "./finalizeArbBet";

const shouldSendArbProgress = vi.hoisted(() => vi.fn(() => false));

const loseOrderStore = vi.hoisted(() => ({
  orders: new Map<number, {
    accountId: number;
    isCreateOrder: boolean;
    linkId: number;
    target: string;
  }>(),
  removeOrder: vi.fn((betId: number) => {
    loseOrderStore.orders.delete(betId);
  }),
}));

vi.mock("@/stores/betting/autoBet/arbProgressTrace", () => ({
  shouldSendArbProgress,
}));

const {
  showRejectDetectionTip,
  maxLegRejectWaitSec,
  settleArbLeg,
  applyArbMakeUpFromRejects,
  markSuccessfulBet,
  saveOrderBind,
  refreshBalance,
  bettingMessage,
  recordSingleLeg9999MapFill,
  recordSingleLeg9999MapFillKeys,
  releaseSingleLeg9999MapFill,
  releaseSingleLeg9999MapFillKeys,
  saveMakeUpCancelLog,
} = vi.hoisted(() => ({
  showRejectDetectionTip: vi.fn(),
  maxLegRejectWaitSec: vi.fn(() => 3),
  settleArbLeg: vi.fn(),
  applyArbMakeUpFromRejects: vi.fn(),
  markSuccessfulBet: vi.fn(),
  saveOrderBind: vi.fn(),
  refreshBalance: vi.fn(),
  bettingMessage: vi.fn(),
  recordSingleLeg9999MapFill: vi.fn(),
  recordSingleLeg9999MapFillKeys: vi.fn(),
  releaseSingleLeg9999MapFill: vi.fn(),
  releaseSingleLeg9999MapFillKeys: vi.fn(),
  saveMakeUpCancelLog: vi.fn(),
}));

vi.mock("@/services/bettingLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/bettingLog")>();
  return {
    ...actual,
    saveMakeUpCancelLog,
  };
});

vi.mock("@/stores/betting/autoBet/rejectWait", () => ({
  legRejectWaitSec: vi.fn(() => 3),
  maxLegRejectWaitSec,
  showRejectDetectionTip,
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn(async () => {}),
}));

vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({
  settleArbLeg,
  settleArbLegUntilTerminal: settleArbLeg,
}));

vi.mock("@/stores/betting/autoBet/arbMakeUpFromRejects", () => ({
  applyArbMakeUpFromRejects,
  resolveArbMakeUpSuccessRef: (leg: BetOption) => ({
    betMoney: Math.round(Number(leg.betMoney) || 0),
    betOdds: Number(leg.odds) || 0,
  }),
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({
    extensionPrefs: {
      arbFailAutoSell: { enabled: false },
      arbEarlyLockSell: { enabled: false },
    },
  }),
}));

vi.mock("@/extensions/arbBet/arbFailAutoSell", () => ({
  maybeArbFailAutoSellAfterFinalize: vi.fn(async () => false),
}));

vi.mock("@/extensions/arbBet/singleLeg9999MapCount", () => ({
  recordSingleLeg9999MapFill,
  recordSingleLeg9999MapFillKeys,
  releaseSingleLeg9999MapFill,
  releaseSingleLeg9999MapFillKeys,
}));

vi.mock("@/stores/betting/successMarkers", () => ({
  markSuccessfulBet,
  readUsedAccounts: vi.fn(() => []),
}));

vi.mock("@/api/esport", () => ({
  saveOrderBind,
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ refreshBalance }),
}));

vi.mock("@/stores/loseOrderStore", () => ({
  useLoseOrderStore: () => loseOrderStore,
}));

vi.mock("@/stores/messageStore", () => ({
  useMessageStore: () => ({ bettingMessage }),
}));

vi.mock("@/stores/betting/arbOrderBind", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/betting/arbOrderBind")>();
  return {
    ...actual,
    refreshOrderListAfterBind: vi.fn(),
  };
});

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({ getBetTarget: () => undefined }),
}));

vi.mock("@/domain/betting/singleLegRate", () => ({
  findSingleLegRateAccount: vi.fn(() => null),
}));

function makeMatch(): ViewMatch {
  return {
    id: 1,
    title: "VG vs Team Refuser",
    bets: [],
  } as unknown as ViewMatch;
}

function makeBet(): ViewBet {
  const row = {
    id: 10,
    round: 1,
    name: "[地图1] 获胜",
    items: [],
    getBetName: () => "[地图1] 获胜",
  };
  return row as unknown as ViewBet;
}

function makeLeg(type: PlatformId, target: "T1" | "T2"): BetOption {
  return {
    type,
    target,
    betMoney: 100,
    odds: 1.9,
    matchId: "m1",
    betId: "b1",
    itemId: "i1",
  } as unknown as BetOption;
}

function makeAccount(provider: PlatformId): PlatformAccount {
  return new PlatformAccount({
    accountId: provider === "OB" ? 1 : 2,
    playerName: provider.toLowerCase(),
    provider,
  });
}

function makePlaced(overrides: Partial<ArbBetPlaced> = {}): ArbBetPlaced {
  const legA = makeLeg("OB", "T1");
  const legB = makeLeg("RAY", "T2");
  const accountA = makeAccount("OB");
  const accountB = makeAccount("RAY");
  return {
    legA,
    legB,
    accountA,
    accountB,
    implied: 1.04,
    betBothLegs: true,
    singleLegByRate: false,
    linkId: 1_700_000_000_000,
    stakeScale: 1,
    waitSec: 10,
    scanOddsA: Number(legA.odds) || 0,
    scanOddsB: Number(legB.odds) || 0,
    resultA: new BetResult("OB", true),
    resultB: new BetResult("RAY", true),
    placeOutcomeA: "filled_pending_settle",
    placeOutcomeB: "filled_pending_settle",
    ...overrides,
  };
}

function venueOrder(orderId: string, status: VenueOrder["status"], createAt: number): VenueOrder {
  return {
    provider: "RAY",
    orderId,
    odds: 1.9,
    createAt,
    betMoney: 100,
    reward: 0,
    money: 0,
    status,
    game: "",
    match: "",
    bet: "",
    item: "",
  };
}

function packLegSync(
  leg: { orders: VenueOrder[]; rejected: boolean; pendingConfirm?: boolean },
) {
  return { pendingConfirm: false, ...leg };
}

function mockDualLegVenueSync(
  legA: { orders: VenueOrder[]; rejected: boolean; pendingConfirm?: boolean },
  legB: { orders: VenueOrder[]; rejected: boolean; pendingConfirm?: boolean },
) {
  settleArbLeg.mockImplementation(async (account: { accountId?: number }) => {
    if (Number(account.accountId) === 1)
      return packLegSync(legA);
    return packLegSync(legB);
  });
}

function expectMakeUpVenue(ordersA: VenueOrder[], ordersB: VenueOrder[]) {
  return { ordersA, ordersB };
}

describe("finalizeArbBet makeup enqueue", () => {
  const params: ArbBetAttemptParams = {
    match: makeMatch(),
    bet: makeBet(),
    config: createDefaultUserConfig(),
    setMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    maxLegRejectWaitSec.mockReturnValue(3);
    saveOrderBind.mockResolvedValue(true);
    applyArbMakeUpFromRejects.mockResolvedValue({
      enqueuedForLegA: false,
      enqueuedForLegB: false,
    });
    showRejectDetectionTip.mockResolvedValue(undefined);
    refreshBalance.mockResolvedValue(undefined);
    settleArbLeg.mockReset();
    recordSingleLeg9999MapFill.mockReset();
    recordSingleLeg9999MapFillKeys.mockReset();
    releaseSingleLeg9999MapFill.mockReset();
    releaseSingleLeg9999MapFillKeys.mockReset();
    saveMakeUpCancelLog.mockReset();
    loseOrderStore.orders.clear();
    loseOrderStore.removeOrder.mockClear();
  });

  it("API 成功锚腿确认拒单后撤销同 Link 的提前补单队列", async () => {
    const linkId = 1_790_352_533_196;
    const accountA = makeAccount("RAY");
    const accountB = makeAccount("Polymarket");
    const legA = makeLeg("RAY", "T1");
    const legB = makeLeg("Polymarket", "T2");
    loseOrderStore.orders.set(params.bet.id, {
      accountId: accountA.accountId,
      isCreateOrder: false,
      linkId,
      target: legB.target,
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ray-reject", "reject", 3)],
      rejected: true,
    }));

    await finalizeArbBet(params, makePlaced({
      linkId,
      legA,
      legB,
      accountA,
      accountB,
      resultA: new BetResult("RAY", true),
      resultB: new BetResult("Polymarket", false, "缺少有效私钥"),
      placeOutcomeA: "filled_pending_settle",
      placeOutcomeB: "api_failed",
    }));

    expect(loseOrderStore.removeOrder).toHaveBeenCalledWith(params.bet.id, true);
    expect(loseOrderStore.orders.has(params.bet.id)).toBe(false);
    expect(saveMakeUpCancelLog).toHaveBeenCalledWith(expect.objectContaining({
      linkId,
      betId: params.bet.id,
      target: legB.target,
      failedPlatformLabel: "Polymarket",
      anchorProvider: "RAY",
      anchorAccountId: accountA.accountId,
      anchorTarget: legA.target,
    }));
    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      true,
      false,
      expectMakeUpVenue([venueOrder("ray-reject", "reject", 3)], []),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
  });

  it("锚腿拒单不会误删其他 Link 的补单", async () => {
    const linkId = 1_790_352_533_196;
    const accountA = makeAccount("RAY");
    const legA = makeLeg("RAY", "T1");
    const legB = makeLeg("Polymarket", "T2");
    loseOrderStore.orders.set(params.bet.id, {
      accountId: accountA.accountId,
      isCreateOrder: false,
      linkId: linkId + 1,
      target: legB.target,
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ray-reject", "reject", 3)],
      rejected: true,
    }));

    await finalizeArbBet(params, makePlaced({
      linkId,
      legA,
      legB,
      accountA,
      accountB: makeAccount("Polymarket"),
      resultA: new BetResult("RAY", true),
      resultB: new BetResult("Polymarket", false),
      placeOutcomeA: "filled_pending_settle",
      placeOutcomeB: "api_failed",
    }));

    expect(loseOrderStore.removeOrder).not.toHaveBeenCalled();
    expect(saveMakeUpCancelLog).not.toHaveBeenCalled();
    expect(loseOrderStore.orders.has(params.bet.id)).toBe(true);
  });

  it("锚腿确认成交时保留同 Link 的补单队列", async () => {
    const linkId = 1_790_352_533_196;
    const accountA = makeAccount("RAY");
    const legA = makeLeg("RAY", "T1");
    const legB = makeLeg("Polymarket", "T2");
    loseOrderStore.orders.set(params.bet.id, {
      accountId: accountA.accountId,
      isCreateOrder: false,
      linkId,
      target: legB.target,
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ray-filled", "none", 3)],
      rejected: false,
    }));

    await finalizeArbBet(params, makePlaced({
      linkId,
      legA,
      legB,
      accountA,
      accountB: makeAccount("Polymarket"),
      resultA: new BetResult("RAY", true),
      resultB: new BetResult("Polymarket", false),
      placeOutcomeA: "filled_pending_settle",
      placeOutcomeB: "api_failed",
    }));

    expect(loseOrderStore.removeOrder).not.toHaveBeenCalled();
    expect(saveMakeUpCancelLog).not.toHaveBeenCalled();
    expect(loseOrderStore.orders.has(params.bet.id)).toBe(true);
  });

  it("双腿 API 成功且 B 腿拒单时入队补单", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-reject", "reject", 3)], rejected: true },
    );
    await finalizeArbBet(params, makePlaced());

    expect(refreshBalance).toHaveBeenCalledTimes(2);
    expect(showRejectDetectionTip).toHaveBeenCalledWith(10);
    expect(settleArbLeg).toHaveBeenCalledTimes(2);
    expect(settleArbLeg).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "OB" }),
      expect.anything(),
      expect.objectContaining({ rejectWaitSec: 0, pendingBindLinkId: expect.any(Number) }),
    );
    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      false,
      true,
      expectMakeUpVenue(
        [venueOrder("ob-1", "none", 2)],
        [venueOrder("ray-reject", "reject", 3)],
      ),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
  });

  it("初检无拒单时不入队", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );

    await finalizeArbBet(params, makePlaced());

    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      false,
      false,
      expectMakeUpVenue(
        [venueOrder("ob-1", "none", 2)],
        [venueOrder("ray-1", "none", 3)],
      ),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
  });

  it("双腿均被拒单时不入队补单", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-reject", "reject", 3)], rejected: true },
      { orders: [venueOrder("ray-reject", "reject", 2)], rejected: true },
    );

    await finalizeArbBet(params, makePlaced());

    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      true,
      true,
      expectMakeUpVenue(
        [venueOrder("ob-reject", "reject", 3)],
        [venueOrder("ray-reject", "reject", 2)],
      ),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
  });

  it("9999 单边仍走拒单等待与拉单", async () => {
    const placed = makePlaced({
      betBothLegs: false,
      singleLegByRate: true,
      accountB: undefined,
      resultB: undefined,
      placeOutcomeB: "not_attempted",
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ob-1", "none", 2)],
      rejected: false,
    }));

    await finalizeArbBet(params, placed);

    expect(showRejectDetectionTip).toHaveBeenCalled();
    expect(settleArbLeg).toHaveBeenCalledTimes(1);
  });

  it("9999 单边成功后记录同图次数", async () => {
    const placed = makePlaced({
      betBothLegs: false,
      singleLegByRate: true,
      accountB: undefined,
      resultB: undefined,
      placeOutcomeB: "not_attempted",
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ob-1", "none", 2)],
      rejected: false,
    }));

    await finalizeArbBet(params, placed);

    expect(recordSingleLeg9999MapFill).toHaveBeenCalledWith(1, 1);
  });

  it("9999 单边已占位时成功不重复记录", async () => {
    const placed = makePlaced({
      betBothLegs: false,
      singleLegByRate: true,
      singleLeg9999MapReserved: true,
      accountB: undefined,
      resultB: undefined,
      placeOutcomeB: "not_attempted",
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ob-1", "none", 2)],
      rejected: false,
    }));

    await finalizeArbBet(params, placed);

    expect(recordSingleLeg9999MapFill).not.toHaveBeenCalled();
    expect(releaseSingleLeg9999MapFill).not.toHaveBeenCalled();
  });

  it("does not record 9999 count for normal two-leg arbitrage or rejected single leg", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );
    await finalizeArbBet(params, makePlaced());
    expect(recordSingleLeg9999MapFill).not.toHaveBeenCalled();

    recordSingleLeg9999MapFill.mockReset();
    const placed = makePlaced({
      betBothLegs: false,
      singleLegByRate: true,
      accountB: undefined,
      resultB: undefined,
      placeOutcomeB: "not_attempted",
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ob-reject", "reject", 2)],
      rejected: true,
    }));
    await finalizeArbBet(params, placed);
    expect(recordSingleLeg9999MapFill).not.toHaveBeenCalled();
  });

  it("9999 单边已占位但最终拒单时释放同图次数", async () => {
    const placed = makePlaced({
      betBothLegs: false,
      singleLegByRate: true,
      singleLeg9999MapReserved: true,
      accountB: undefined,
      resultB: undefined,
      placeOutcomeB: "not_attempted",
    });
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [venueOrder("ob-reject", "reject", 2)],
      rejected: true,
    }));

    await finalizeArbBet(params, placed);

    expect(releaseSingleLeg9999MapFill).toHaveBeenCalledWith(1, 1);
    expect(recordSingleLeg9999MapFill).not.toHaveBeenCalled();
  });

  it("maxWait=0 时不弹拒单检测 tip（纯 PM / 无 A8 等待）", async () => {
    maxLegRejectWaitSec.mockReturnValue(0);
    const placed = makePlaced({
      accountA: makeAccount("Polymarket" as PlatformId),
      accountB: makeAccount("Polymarket" as PlatformId),
      legA: makeLeg("Polymarket" as PlatformId, "T1"),
      legB: makeLeg("Polymarket" as PlatformId, "T2"),
      resultA: new BetResult("Polymarket", true),
      resultB: new BetResult("Polymarket", true),
    });
    mockDualLegVenueSync(
      { orders: [venueOrder("pm-a", "none", 2)], rejected: false },
      { orders: [venueOrder("pm-b", "none", 3)], rejected: false },
    );

    await finalizeArbBet(params, placed);

    expect(showRejectDetectionTip).not.toHaveBeenCalled();
    expect(settleArbLeg).toHaveBeenCalledTimes(2);
  });

  it("双腿成功且拉单有首条时按 linkId 绑单", async () => {
    const linkId = 1_700_000_000_000;
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );

    await finalizeArbBet(params, makePlaced({ linkId }));

    expect(saveOrderBind).toHaveBeenCalledTimes(2);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([{ LinkID: linkId, Provider: "OB", PlayerID: 1, OrderID: "ob-1" }]),
    });
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([{ LinkID: linkId, Provider: "RAY", PlayerID: 2, OrderID: "ray-1" }]),
    });
  });

  it("套利收尾不刷新侧栏（A8 套利块不调用 E）", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-reject", "reject", 3)], rejected: true },
    );
    await finalizeArbBet(params, makePlaced());
    // 侧栏仅 Io.f / 手动刷新 / loadAccounts(true) 时 E()
  });

  it("仅一腿拉单有首条时只绑该腿（对齐 A8 R.length>0 / X.length>0）", async () => {
    const linkId = 1_700_000_000_000;
    mockDualLegVenueSync(
      { orders: [], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );

    await finalizeArbBet(params, makePlaced({ linkId }));

    expect(saveOrderBind).toHaveBeenCalledTimes(1);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([{ LinkID: linkId, Provider: "RAY", PlayerID: 2, OrderID: "ray-1" }]),
    });
  });

  it("双腿拉单均为空时不绑单", async () => {
    mockDualLegVenueSync(
      { orders: [], rejected: false },
      { orders: [], rejected: false },
    );

    await finalizeArbBet(params, makePlaced());

    expect(saveOrderBind).not.toHaveBeenCalled();
  });

  it("PM delayed 且场馆 sync 为空时用 result.orderId 绑单", async () => {
    const linkId = 1_700_000_000_000;
    settleArbLeg.mockResolvedValueOnce(packLegSync({
      orders: [],
      rejected: false,
    }));

    const placed = makePlaced({
      linkId,
      accountA: undefined,
      accountB: makeAccount("Polymarket" as PlatformId),
      legA: makeLeg("OB", "T1"),
      legB: makeLeg("Polymarket" as PlatformId, "T2"),
      resultA: undefined,
      resultB: Object.assign(new BetResult("Polymarket", true), { orderId: "0xdelayed-order" }),
      betBothLegs: false,
      placeOutcomeA: "not_attempted",
      placeOutcomeB: "filled_pending_settle",
    });

    await finalizeArbBet(params, placed);

    expect(saveOrderBind).toHaveBeenCalledTimes(1);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([
        { LinkID: linkId, Provider: "Polymarket", PlayerID: 2, OrderID: "0xdelayed-order" },
      ]),
    });
  });

  it("PM delayed 且 sync 仍返回历史首条时用 result.orderId 绑单", async () => {
    const linkId = 1_783_199_338_220;
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2.4)], rejected: false },
      {
        orders: [venueOrder("0xfe933cac68e49da172f4ab8e59e6c1", "none", 2.6)],
        rejected: false,
      },
    );

    const placed = makePlaced({
      linkId,
      accountA: makeAccount("OB" as PlatformId),
      accountB: makeAccount("Polymarket" as PlatformId),
      legA: makeLeg("OB", "T1"),
      legB: makeLeg("Polymarket" as PlatformId, "T2"),
      resultA: new BetResult("OB", true),
      resultB: Object.assign(new BetResult("Polymarket", true), {
        orderId: "0xd695a0c4cdd10b558fc829ecda52f20eeca76407",
      }),
    });

    await finalizeArbBet(params, placed);

    expect(saveOrderBind).toHaveBeenCalledTimes(2);
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([{ LinkID: linkId, Provider: "OB", PlayerID: 1, OrderID: "ob-1" }]),
    });
    expect(saveOrderBind).toHaveBeenCalledWith({
      orders: JSON.stringify([
        { LinkID: linkId, Provider: "Polymarket", PlayerID: 2, OrderID: "0xd695a0c4cdd10b558fc829ecda52f20eeca76407" },
      ]),
    });
  });

  it("refreshBalance 不阻塞并行拒单检测", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );
    refreshBalance.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        }),
    );

    await finalizeArbBet(params, makePlaced());

    expect(refreshBalance).toHaveBeenCalled();
    expect(settleArbLeg).toHaveBeenCalledTimes(2);
  });

  it("PM delayed 腿跳过早刷，仅在 settle 确认后补刷", async () => {
    const accountA = makeAccount("OB");
    const accountB = makeAccount("Polymarket");
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [{ ...venueOrder("pm-1", "none", 3), provider: "Polymarket" }], rejected: false },
    );

    await finalizeArbBet(
      params,
      makePlaced({
        legB: makeLeg("Polymarket", "T2"),
        accountA,
        accountB,
        resultB: Object.assign(new BetResult("Polymarket", true), {
          orderId: "pm-1",
          pending: true,
        }),
      }),
    );

    // OB 早刷 1 次；PM delayed 不早刷，settle 后补刷 1 次
    expect(refreshBalance).toHaveBeenCalledTimes(2);
    expect(refreshBalance).toHaveBeenNthCalledWith(1, accountA);
    expect(refreshBalance).toHaveBeenNthCalledWith(2, accountB);
  });

  it("PF 仍 pendingConfirm 时不补刷（避免旧余额）", async () => {
    const accountA = makeAccount("OB");
    const accountB = makeAccount("PredictFun");
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      {
        orders: [{ ...venueOrder("pf-1", "none", 3), provider: "PredictFun" }],
        rejected: false,
        pendingConfirm: true,
      },
    );

    await finalizeArbBet(
      params,
      makePlaced({
        legB: makeLeg("PredictFun", "T2"),
        accountA,
        accountB,
        resultB: Object.assign(new BetResult("PredictFun", true), {
          orderId: "pf-1",
          pending: true,
        }),
        placeOutcomeB: "accepted_pending_confirm",
      }),
    );

    expect(refreshBalance).toHaveBeenCalledTimes(1);
    expect(refreshBalance).toHaveBeenCalledWith(accountA);
  });

  it("非 PM/PF 双腿仍只在 place 成功时各刷一次", async () => {
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );
    await finalizeArbBet(params, makePlaced());
    expect(refreshBalance).toHaveBeenCalledTimes(2);
  });

  it("开启套利进度报告时仍发送原有下单提醒及拒单状态", async () => {
    shouldSendArbProgress.mockReturnValue(true);
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "reject", 3)], rejected: true },
    );
    const trace = createArbExecutionTrace(params.match, params.bet);
    const tracedParams = { ...params, trace };

    await finalizeArbBet(tracedParams, makePlaced());

    expect(bettingMessage).toHaveBeenCalledOnce();
    expect(bettingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reject: false }),
      expect.objectContaining({ reject: true }),
      expect.any(Number),
    );
  });

  it("进度报告发送异常不阻断原有下单提醒", async () => {
    shouldSendArbProgress.mockReturnValue(true);
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "reject", 3)], rejected: true },
    );
    const deliver = vi.fn(() => { throw new Error("进度报告失败"); });
    const trace = createArbExecutionTrace(params.match, params.bet, undefined, deliver);

    await expect(finalizeArbBet({ ...params, trace }, makePlaced())).resolves.toBeUndefined();

    expect(deliver).toHaveBeenCalledOnce();
    expect(bettingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reject: false }),
      expect.objectContaining({ reject: true }),
      expect.any(Number),
    );
  });

  it("进度报告不入队时，同盘口连续拒单仍逐次发送原有提醒", async () => {
    shouldSendArbProgress.mockReturnValue(true);
    const deliver = vi.fn();
    for (let attempt = 0; attempt < 2; attempt++) {
      mockDualLegVenueSync(
        { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
        { orders: [venueOrder("ray-1", "reject", 3)], rejected: true },
      );
      const trace = createArbExecutionTrace(params.match, params.bet, undefined, deliver);
      await finalizeArbBet({ ...params, trace }, makePlaced());
    }

    expect(bettingMessage).toHaveBeenCalledTimes(2);
    for (const call of bettingMessage.mock.calls)
      expect(call[1]).toEqual(expect.objectContaining({ reject: true }));
  });

  it("未开套利进度报告时仍发 bettingMessage", async () => {
    shouldSendArbProgress.mockReturnValue(false);
    mockDualLegVenueSync(
      { orders: [venueOrder("ob-1", "none", 2)], rejected: false },
      { orders: [venueOrder("ray-1", "none", 3)], rejected: false },
    );

    await finalizeArbBet(params, makePlaced());

    expect(bettingMessage).toHaveBeenCalledOnce();
  });

  it("双腿 API 失败仍进编排层且不入队补单、不拉场馆", async () => {
    const placed = makePlaced({
      resultA: new BetResult("OB", false),
      resultB: new BetResult("RAY", false),
      placeOutcomeA: "api_failed",
      placeOutcomeB: "api_failed",
    });

    await finalizeArbBet(params, placed);

    expect(settleArbLeg).not.toHaveBeenCalled();
    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      false,
      false,
      expectMakeUpVenue([], []),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
    expect(saveOrderBind).not.toHaveBeenCalled();
  });

  it("顺序 A 失败 B 未下单：编排收尾且不补单", async () => {
    const placed = makePlaced({
      resultA: new BetResult("OB", false),
      resultB: undefined,
      placeOutcomeA: "api_failed",
      placeOutcomeB: "not_attempted",
    });

    await finalizeArbBet(params, placed);

    expect(settleArbLeg).not.toHaveBeenCalled();
    expect(applyArbMakeUpFromRejects).toHaveBeenCalledWith(
      params,
      expect.anything(),
      false,
      false,
      expectMakeUpVenue([], []),
      { pendingConfirmA: false, pendingConfirmB: false },
    );
  });
});
