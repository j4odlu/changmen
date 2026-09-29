import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { checkArbLegs } from "@/stores/betting/autoBet/phases/checkArbLegs";
import { createDefaultUserConfig } from "@/types/userConfig";

const checkBetting = vi.hoisted(() => vi.fn());
const getEntry = vi.hoisted(() => vi.fn());
const pendingOrders = vi.hoisted(() => new Map<number, { pendingVenueOrderId: string; pendingVenueError: string; pendingVenueAccountId: number }>());
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: pendingOrders }) }));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ checkBetting }),
}));

const extensionPrefs = vi.hoisted(() => ({
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
    pendingOrders.clear();
    extensionPrefs.stakeScaleByProfit.skipAccountRateOnScale = false;
    getEntry.mockReturnValue(undefined);
    checkBetting.mockImplementation(async (_acc, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
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
      { skipAccountRate: true },
    );
    expect(checkBetting).toHaveBeenCalledWith(
      rayBet,
      expect.objectContaining({ type: "RAY" }),
      { skipAccountRate: false },
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
      { skipAccountRate: true },
    );
    expect(checkBetting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "RAY" }),
      { skipAccountRate: true },
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
});
