import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { checkArbLegs } from "@/stores/betting/autoBet/phases/checkArbLegs";
import { createDefaultUserConfig } from "@/types/userConfig";
import { syncActiveBetPrecheckResults } from "@/stores/betting/activeBetRunSync";
import { setPmFokPreflightMode } from "@changmen/venue-browser/adapter/polymarket";
const prepareFast = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-browser/adapter/polymarket", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/venue-browser/adapter/polymarket")>(), prepareOptimizedFokExecution: prepareFast,
}));

vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetPrecheckResults: vi.fn(), syncActiveBetPhase: vi.fn(), syncActiveBetFail: vi.fn(), scheduleActiveBetRunRemoval: vi.fn(),
}));

const checkBetting = vi.hoisted(() => vi.fn());
const getEntry = vi.hoisted(() => vi.fn());
const pendingOrders = vi.hoisted(() => new Map<number, { pendingVenueOrderId: string; pendingVenueError: string; pendingVenueAccountId: number }>());
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: pendingOrders }) }));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ checkBetting }),
}));

const extensionPrefs = vi.hoisted(() => ({
  lowOddsSingleHigherCProbabilityOnly: false,
  stakeScaleByProfit: {
    enabled: false,
    minImplied: 1.05,
    multiplier: 2,
    skipAccountRateOnScale: false,
  },
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ extensionPrefs }),
}));

vi.mock("@/stores/oddsStore", () => ({
  useOddsStore: () => ({ getEntry }),
}));

vi.mock("@changmen/client-core/shared/wait", () => ({ wait: vi.fn(async () => {}) }));

function leg(type: string, betMoney: number, odds: number, extra: Partial<BetOption> = {}): BetOption {
  const o = new BetOptionClass(type as never, "m1", "b1", "i1", betMoney, "Home", odds);
  return Object.assign(o, extra);
}

function account(provider: string): PlatformAccount {
  return { provider } as PlatformAccount;
}

function ready(legA: BetOption, legB: BetOption, stakeScale = 1): ArbBetReady {
  return {
    legA,
    legB,
    accountA: account(legA.type),
    accountB: account(legB.type),
    implied: 1.05,
    betBothLegs: true,
    singleLegByRate: false,
    linkId: 1_700_000_000_000,
    stakeScale,
  };
}

const params: ArbBetAttemptParams = {
  match: { id: 1, title: "A vs B", bets: [] } as never,
  bet: { id: 10, getBetName: () => "全场" } as never,
  config: createDefaultUserConfig(),
  setMessage: vi.fn(),
};

describe("checkArbLegs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPmFokPreflightMode("legacy"); prepareFast.mockReset();
    pendingOrders.clear();
    extensionPrefs.lowOddsSingleHigherCProbabilityOnly = false;
    extensionPrefs.stakeScaleByProfit.skipAccountRateOnScale = false;
    getEntry.mockReturnValue(undefined);
    checkBetting.mockImplementation(async (_acc, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
  });

  it("dynamic cold preparation finishes before either leg starts; classic never uses it", async () => {
    setPmFokPreflightMode("optimized");
    const input = ready(leg("RAY", 80, 1.36), leg("Polymarket", 22, 3.125));
    let release!: () => void;
    prepareFast.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = checkArbLegs(params, input);
    await vi.waitFor(() => expect(prepareFast).toHaveBeenCalledOnce());
    expect(checkBetting).not.toHaveBeenCalled();
    release(); expect(await pending).not.toBeNull(); expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(checkBetting).toHaveBeenCalledWith(input.accountB, input.legB,
      expect.objectContaining({ pmDynamicPrepared: true }));
    prepareFast.mockClear(); setPmFokPreflightMode("legacy");
    await checkArbLegs(params, ready(leg("RAY", 80, 1.36), leg("Polymarket", 22, 3.125)));
    expect(prepareFast).not.toHaveBeenCalled();
  });

  it("dynamic preference does not prepare a PM precheck-only leg", async () => {
    setPmFokPreflightMode("optimized");
    const input = ready(leg("Polymarket", 22, 3.125), leg("RAY", 80, 1.36));
    input.checkAccountA = input.accountA; input.accountA = undefined;
    input.betBothLegs = false; input.singleLegByRate = true;
    expect(await checkArbLegs(params, input)).not.toBeNull();
    expect(prepareFast).not.toHaveBeenCalled();
    expect(checkBetting).toHaveBeenLastCalledWith(input.accountB, input.legB, expect.not.objectContaining({ pmDynamicPrepared: true }));
  });

  it("failed dynamic preparation never starts the traditional precheck", async () => {
    setPmFokPreflightMode("optimized"); prepareFast.mockRejectedValueOnce(new Error("clock unavailable"));
    expect(await checkArbLegs(params, ready(leg("RAY", 80, 1.36), leg("Polymarket", 22, 3.125)))).toBeNull();
    expect(checkBetting).not.toHaveBeenCalled(); expect(syncActiveBetPrecheckResults).not.toHaveBeenCalled();
  });

  it("核验异常账号阻止新增套利，原单解除后恢复预检", async () => {
    const input = ready(leg("RAY", 80, 1.36), leg("Polymarket", 22, 3.125));
    input.accountB!.accountId = 285;
    pendingOrders.set(1, { pendingVenueOrderId: "original", pendingVenueError: "查询超时", pendingVenueAccountId: 285 });
    expect(await checkArbLegs(params, input)).toBeNull();
    expect(checkBetting).not.toHaveBeenCalled();
    pendingOrders.clear();
    expect(await checkArbLegs(params, input)).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
  });

  it("非 PM 双腿并行预检，betMoney 保持 GetOrderOptions 值", async () => {
    const legA = leg("RAY", 80, 1.36);
    const legB = leg("PB", 35, 3.125);

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(out!.legA.betMoney).toBe(80);
    expect(out!.legB.betMoney).toBe(35);
    expect(out!.implied).toBe(1.05);
  });

  it("含 Polymarket 时与 A8 相同并行预检，不改计划 betMoney", async () => {
    const legA = leg("RAY", 80, 1.36);
    const legB = leg("Polymarket", 22, 3.125);

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(out!.legA.betMoney).toBe(80);
    expect(out!.legB.betMoney).toBe(22);
    expect(out!.implied).toBe(1.05);
    expect(out!.scanOddsA).toBe(1.36);
    expect(out!.scanOddsB).toBe(3.125);
    expect(out!.legA.data).toEqual({ ok: true });
    expect(out!.legB.data).toEqual({ ok: true });
  });

  it("混合对 OB 腿：探测型 checkBet 的冻价保留，按 A8 模式直接用于下单", async () => {
    const legA = leg("OB", 100, 1.9);
    const legB = leg("Polymarket", 22, 3.125);

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(out!.legA.data).toEqual({ ok: true });
    expect(out!.legB.data).toEqual({ ok: true });
  });

  it("混合对：双侧预检都完成后才返回，PM 拉簿未结束不下单", async () => {
    let pmResolved = false;
    checkBetting.mockImplementation(async (_acc, option: BetOption) => {
      if (option.type === "Polymarket") {
        await new Promise(r => setTimeout(r, 40));
        pmResolved = true;
        option.data = { ok: true };
        return option;
      }
      option.data = { ok: true };
      return option;
    });
    const legA = leg("RAY", 80, 1.36);
    const legB = leg("Polymarket", 22, 3.125);

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).not.toBeNull();
    expect(pmResolved).toBe(true);
    expect(out!.legA.data).toEqual({ ok: true });
    expect(out!.legB.data).toEqual({ ok: true });
  });

  it("混合对：PM 预检失败则整笔阻断，不进入下单", async () => {
    checkBetting.mockImplementation(async (_acc, option: BetOption) => {
      if (option.type === "Polymarket") {
        option.checkError = "无盘口数据";
        return option;
      }
      option.data = { ok: true };
      return option;
    });
    const legA = leg("RAY", 80, 1.36);
    const legB = leg("Polymarket", 22, 3.125);

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
  });

  it("pm_sport 系列赛已决出时跳过 PM 腿预检", async () => {
    const legA = leg("RAY", 80, 1.36);
    const legB = leg("Polymarket", 35, 3.125, {
      match: {
        pmSport: {
          mapScore: { home: 1, away: 2 },
          bo: 3,
        },
      } as never,
      bet: { round: 0 } as never,
    });

    const out = await checkArbLegs(params, ready(legA, legB));

    expect(out).toBeNull();
    expect(checkBetting).not.toHaveBeenCalled();
  });

  it("9999 单边：预检双腿，下单账号仍仅对侧", async () => {
    const legA = leg("PB", 100, 1.8);
    const legB = leg("RAY", 55, 3.2);
    const pb9999 = account("PB");
    const rayBet = account("RAY");

    const out = await checkArbLegs(params, {
      ...ready(legA, legB),
      accountA: undefined,
      accountB: rayBet,
      checkAccountA: pb9999,
      checkAccountB: rayBet,
      betBothLegs: false,
      singleLegByRate: true,
    });

    expect(out).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(checkBetting).toHaveBeenCalledWith(
      pb9999,
      expect.objectContaining({ type: "PB" }),
      expect.objectContaining({ skipAccountRate: true }),
    );
    expect(checkBetting).toHaveBeenCalledWith(
      rayBet,
      expect.objectContaining({ type: "RAY" }),
      expect.objectContaining({ skipAccountRate: false }),
    );
    expect(out!.accountA).toBeUndefined();
    expect(out!.accountB).toBe(rayBet);
  });

  it("加仓触发且开启忽略比例时，双腿预检 skipAccountRate", async () => {
    extensionPrefs.stakeScaleByProfit.skipAccountRateOnScale = true;
    const legA = leg("PB", 200, 1.8);
    const legB = leg("RAY", 110, 3.2);

    const out = await checkArbLegs(params, ready(legA, legB, 2));

    expect(out).not.toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
    expect(checkBetting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "PB" }),
      expect.objectContaining({ skipAccountRate: true }),
    );
    expect(checkBetting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "RAY" }),
      expect.objectContaining({ skipAccountRate: true }),
    );
  });

  it("9999 腿预检失败时整笔阻断", async () => {
    checkBetting.mockImplementation(async (acc, option: BetOption) => {
      if (acc.provider === "PB") {
        option.checkError = "盘口不可用";
        return option;
      }
      option.data = { ok: true };
      return option;
    });
    const legA = leg("PB", 100, 1.8);
    const legB = leg("RAY", 55, 3.2);

    const out = await checkArbLegs(params, {
      ...ready(legA, legB),
      accountA: undefined,
      accountB: account("RAY"),
      checkAccountA: account("PB"),
      checkAccountB: account("RAY"),
      betBothLegs: false,
      singleLegByRate: true,
    });

    expect(out).toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
  });
  it("🎯 waits for both checks, selects updated odds and preserves each stake", async () => {
    const input = { ...ready(leg("OB", 100, 1.6), leg("RAY", 60, 3.0)), executionMode: "lowOddsSingle" as const };
    let finishB!: () => void;
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      if (option === input.legB) await new Promise<void>(resolve => { finishB = resolve; });
      option.newOdds = option === input.legA ? 2.3 : 1.9;
      option.data = { ok: true };
      return option;
    });
    let completed = false;
    const pending = checkArbLegs(params, input).then(value => { completed = true; return value; });
    await vi.waitFor(() => expect(checkBetting).toHaveBeenCalledTimes(2));
    expect(completed).toBe(false);
    finishB();
    const checked = await pending;
    expect(checked?.executionSide).toBe("B");
    expect(checked?.accountA).toBeUndefined();
    expect(checked?.checkAccountA).toBe(input.accountA);
    expect(checked?.accountB).toBe(input.accountB);
    expect(checked?.betBothLegs).toBe(false);
    expect(checked?.legA.betMoney).toBe(100);
    expect(checked?.legB.betMoney).toBe(60);
    expect(checked?.legB.orderIndex).toBe(1);
  });

  it.each(["failed", "inconsistent", "equal"])("🎯 blocks %s precheck without producing an executable plan", async kind => {
    const input = { ...ready(leg("OB", 100, 1.8), leg("RAY", 60, 2.5)), executionMode: "lowOddsSingle" as const };
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = kind === "failed" && option === input.legB ? null : { ok: true };
      if (kind === "inconsistent" && option === input.legB) option.checkError = "invalid quote";
      option.newOdds = kind === "equal" ? 2 : option.odds;
      return option;
    });
    expect(await checkArbLegs(params, input)).toBeNull();
    expect(checkBetting).toHaveBeenCalledTimes(2);
  });

  it("🎯 blocks missing live account instead of weakening the two-check requirement", async () => {
    const input = { ...ready(leg("OB", 100, 1.8), leg("RAY", 60, 2.5)), executionMode: "lowOddsSingle" as const };
    expect(await checkArbLegs(params, { ...input, accountB: undefined })).toBeNull();
    expect(checkBetting).not.toHaveBeenCalled();
  });

  it.each([false, true])("LOS C filter only restricts the selected lower-odds leg (higherC=%s)", async higherC => {
    extensionPrefs.lowOddsSingleHigherCProbabilityOnly = true;
    const point = (tokenId: string, price: number) => ({ tokenId, price, marketId: "map-1", status: "ready",
      cutoff: 100, observationTime: 99000, resolution: 0 });
    const input = { ...ready(leg("OB", 100, 1.8), leg("RAY", 60, 2.5, { target: "Away" })), executionMode: "lowOddsSingle" as const };
    const args = { ...params,
      bet: { ...params.bet, round: 1, items: [{ type: "Polymarket", homeId: "home", awayId: "away" }] },
      match: { ...params.match, pmPrematch: { home: point("home", higherC ? .7 : .3), away: point("away", higherC ? .3 : .7) } },
    } as unknown as ArbBetAttemptParams;
    const checked = await checkArbLegs(args, input);
    expect(checkBetting).toHaveBeenCalledTimes(2);
    if (higherC) {
      expect(checked?.executionSide).toBe("A");
      expect(checked?.accountB).toBeUndefined();
      expect(checked?.legA.betMoney).toBe(100);
    }
    else {
      expect(checked).toBeNull();
      expect(args.setMessage).toHaveBeenCalledWith(expect.stringContaining("低于对侧"));
    }
    expect(input.accountA).toBeDefined(); expect(input.accountB).toBeDefined();
  });

  it("LOS rejects missing C data only when its own filter is enabled; ordinary mode is unaffected", async () => {
    const input = { ...ready(leg("OB", 100, 1.8), leg("RAY", 60, 2.5)), executionMode: "lowOddsSingle" as const };
    expect((await checkArbLegs(params, input))?.executionSide).toBe("A");
    extensionPrefs.lowOddsSingleHigherCProbabilityOnly = true;
    expect(await checkArbLegs({ ...params, bet: { ...params.bet, round: 1, items: [] } } as unknown as ArbBetAttemptParams, input)).toBeNull();
    expect((await checkArbLegs(params, { ...input, executionMode: "normal" }))?.betBothLegs).toBe(true);
  });

});
