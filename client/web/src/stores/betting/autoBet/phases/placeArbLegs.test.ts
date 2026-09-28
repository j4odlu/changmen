import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import {
  placeArbLegs,
  shouldPlaceLegsInParallel,
} from "@/stores/betting/autoBet/phases/placeArbLegs";
import { createDefaultUserConfig } from "@/types/userConfig";

const betting = vi.hoisted(() => vi.fn());
const checkBetting = vi.hoisted(() => vi.fn());
const retryFailedLeg = vi.hoisted(() => vi.fn());
const enqueueMakeUpOrder = vi.hoisted(() => vi.fn());
const syncActiveBetPlaceResults = vi.hoisted(() => vi.fn());
const syncActiveBetPhase = vi.hoisted(() => vi.fn());
const syncActiveBetLeg = vi.hoisted(() => vi.fn());
const getOddsEntry = vi.hoisted(() => vi.fn());
const loseStore = vi.hoisted(() => ({ orders: new Map() }));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({ betting, checkBetting }),
}));

vi.mock("@/stores/oddsStore", () => ({
  useOddsStore: () => ({ getEntry: getOddsEntry }),
}));

vi.mock("@/stores/betting/autoBet/retryFailedLeg", () => ({
  retryFailedLeg,
}));

vi.mock("@/stores/betting/autoBet/makeUp", () => ({
  enqueueMakeUpOrder,
}));

vi.mock("@/stores/loseOrderStore", () => ({
  useLoseOrderStore: () => loseStore,
}));

vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetPlaceResults,
  syncActiveBetPhase,
  syncActiveBetLeg,
  syncActiveBetFail: vi.fn(),
  syncActiveBetPrecheckResults: vi.fn(),
}));

function leg(type: string, target: "Home" | "Away" = "Home"): BetOption {
  const option = new BetOptionClass(type as never, "m1", "b1", "i1", 100, target, 1.9);
  option.data = { ok: true };
  return option;
}

function account(provider: string): PlatformAccount {
  return { provider, accountId: provider === "OB" ? 1 : 2, playerName: provider } as PlatformAccount;
}

function checked(overrides: Partial<ArbBetChecked> = {}): ArbBetChecked {
  const legA = overrides.legA ?? leg("OB", "Home");
  const legB = overrides.legB ?? leg("RAY", "Away");
  return {
    implied: 1.05,
    betBothLegs: true,
    singleLegByRate: false,
    linkId: 1_700_000_000_000,
    stakeScale: 1,
    waitSec: 10,
    scanOddsA: Number(legA.odds) || 0,
    scanOddsB: Number(legB.odds) || 0,
    accountA: account("OB"),
    accountB: account("RAY"),
    ...overrides,
    legA,
    legB,
  };
}

const params: ArbBetAttemptParams = {
  match: { id: 1, title: "A vs B", bets: [] } as never,
  bet: { id: 10, getBetName: () => "全场" } as never,
  config: { ...createDefaultUserConfig(), betSorting: "Serial" } as never,
  setMessage: vi.fn(),
};

describe("shouldPlaceLegsInParallel", () => {
  it("A8↔A8 Parallel 仍并发", () => {
    expect(shouldPlaceLegsInParallel("Parallel")).toBe(true);
  });

  it("混合对 Parallel 配置仍按 A8 Parallel 并发", () => {
    expect(shouldPlaceLegsInParallel("Parallel")).toBe(true);
    expect(shouldPlaceLegsInParallel("Parallel")).toBe(true);
  });

  it("非 Parallel 一律顺序", () => {
    expect(shouldPlaceLegsInParallel("Serial")).toBe(false);
  });
});

describe("placeArbLegs two-leg report contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retryFailedLeg.mockResolvedValue(null);
    enqueueMakeUpOrder.mockResolvedValue(true);
    getOddsEntry.mockReturnValue(undefined);
    betting.mockImplementation(async (_acc: unknown, option: BetOption) =>
      new BetResult(option.type, true));
    checkBetting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      option.data = option.data ?? { ok: true };
      return option;
    });
  });

  it("顺序 A API 失败：B 为 not_attempted，仍返回 placed（不 abort）", async () => {
    betting.mockResolvedValueOnce(new BetResult("OB", false));

    const out = await placeArbLegs(params, checked());

    expect(betting).toHaveBeenCalledTimes(1);
    expect(out.placeOutcomeA).toBe("api_failed");
    expect(out.placeOutcomeB).toBe("not_attempted");
    expect(out.resultA?.success).toBe(false);
    expect(out.resultB).toBeUndefined();
    expect(syncActiveBetPlaceResults).toHaveBeenCalledWith(
      10,
      expect.anything(),
      undefined,
      true,
      true,
      "api_failed",
      "not_attempted",
      undefined,
    );
  });

  it("并行双腿 API 失败：双 api_failed，仍返回 placed", async () => {
    const parallelParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Parallel" } as never,
    };
    betting
      .mockResolvedValueOnce(new BetResult("OB", false))
      .mockResolvedValueOnce(new BetResult("RAY", false));

    const out = await placeArbLegs(parallelParams, checked());

    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("api_failed");
    expect(out.placeOutcomeB).toBe("api_failed");
    expect(syncActiveBetPlaceResults).toHaveBeenCalled();
  });

  it("顺序双成功：双 filled_pending_settle", async () => {
    betting
      .mockResolvedValueOnce(new BetResult("OB", true))
      .mockResolvedValueOnce(new BetResult("RAY", true));

    const out = await placeArbLegs(params, checked());

    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("混合对 Parallel 预检齐后两边同时 POST：不做 PM 复检/RAY 重检", async () => {
    const parallelParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Parallel" } as never,
    };
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    rayLeg.odds = 2.23;
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      return new BetResult(option.type, false);
    });

    const out = await placeArbLegs(parallelParams, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
      scanOddsA: 1.9,
      scanOddsB: 2.23,
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    const posted = betting.mock.calls.map(call => (call[1] as BetOption).type).sort();
    expect(posted).toEqual(["Polymarket", "RAY"]);
    expect(betting.mock.calls[0]![3]).toEqual(expect.objectContaining({ requirePreparedQuote: true }));
    expect(out.placeOutcomeA).toBe("api_failed");
    expect(out.placeOutcomeB).toBe("api_failed");
  });

  it("混合对 OB 腿：预检齐后直接双边 POST", async () => {
    const obLeg = leg("OB", "Home");
    obLeg.data = { "b[0]": "mch=m1&mkt=b1&oid=i1&odd=1.900&a=100&bt=1" };
    const pmLeg = leg("Polymarket", "Away");
    pmLeg.data = { ok: true };
    betting.mockImplementation(async (_acc: unknown, option: BetOption) =>
      new BetResult(option.type, true));

    const out = await placeArbLegs(params, checked({
      legA: obLeg,
      legB: pmLeg,
      accountA: account("OB"),
      accountB: account("Polymarket"),
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    const posted = betting.mock.calls.map(call => (call[1] as BetOption).type).sort();
    expect(posted).toEqual(["OB", "Polymarket"]);
    expect((betting.mock.calls.find(c => (c[1] as BetOption).type === "OB")![1] as BetOption).data)
      .toEqual({ "b[0]": "mch=m1&mkt=b1&oid=i1&odd=1.900&a=100&bt=1" });
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("混合对 OB 腿：不做 PM 复检，预检 data 可用就直接 POST", async () => {
    const obLeg = leg("OB", "Home");
    const pmLeg = leg("Polymarket", "Away");
    checkBetting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      option.data = null;
      option.checkError = "盘口价高于检测价";
      return option;
    });

    const out = await placeArbLegs(params, checked({
      legA: obLeg,
      legB: pmLeg,
      accountA: account("OB"),
      accountB: account("Polymarket"),
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("混合对 OB 腿：冻价缺失时不 POST，也不补一次探测单", async () => {
    const obLeg = leg("OB", "Home");
    obLeg.data = null;
    const pmLeg = leg("Polymarket", "Away");
    pmLeg.data = { ok: true };

    const out = await placeArbLegs(params, checked({
      legA: obLeg,
      legB: pmLeg,
      accountA: account("OB"),
      accountB: account("Polymarket"),
    }));

    const obChecks = checkBetting.mock.calls.filter(c => (c[1] as BetOption).type === "OB");
    expect(obChecks).toHaveLength(0);
    expect(betting).not.toHaveBeenCalled();
    expect(out.placeOutcomeA).toBe("not_attempted");
    expect(out.placeOutcomeB).toBe("not_attempted");
    expect(syncActiveBetPlaceResults).toHaveBeenCalledWith(
      10,
      undefined,
      undefined,
      true,
      true,
      "not_attempted",
      "not_attempted",
      expect.stringContaining("双侧预检未齐"),
    );
  });

  it("混合对：place 阶段不再读取 fo 临门闸门，直接双边 POST", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.itemId = "token-1";
    pmLeg.odds = 5;
    pmLeg.data = { detectionOdds: 5, detectionMaxPrice: 0.2, detectionClobPrice: 0.2 };
    const rayLeg = leg("RAY", "Away");
    rayLeg.odds = 2.23;
    getOddsEntry.mockReturnValue({ clobPrice: 0.32, isLock: false });

    const out = await placeArbLegs(params, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
      scanOddsA: 5,
      scanOddsB: 2.23,
    }));

    expect(getOddsEntry).not.toHaveBeenCalled();
    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("混合对 Parallel：没有 fo 时仍两边 POST", async () => {
    const parallelParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Parallel" } as never,
    };
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { detectionOdds: 5, detectionMaxPrice: 0.2, detectionClobPrice: 0.2 };
    const rayLeg = leg("RAY", "Away");
    getOddsEntry.mockReturnValue(undefined);
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      return new BetResult(option.type, false);
    });

    const out = await placeArbLegs(parallelParams, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(betting).toHaveBeenCalledTimes(2);
    const posted = betting.mock.calls.map(call => (call[1] as BetOption).type).sort();
    expect(posted).toEqual(["Polymarket", "RAY"]);
    expect(out.placeOutcomeA).toBe("api_failed");
    expect(out.placeOutcomeB).toBe("api_failed");
  });

  it("混合对 Parallel：fo 在上限内仍两边 POST", async () => {
    const parallelParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Parallel" } as never,
    };
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.odds = 5;
    pmLeg.data = { detectionOdds: 5, detectionMaxPrice: 0.2, detectionClobPrice: 0.2 };
    const rayLeg = leg("RAY", "Away");
    getOddsEntry.mockReturnValue({ clobPrice: 0.2, isLock: false });
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      return new BetResult(option.type, false);
    });

    await placeArbLegs(parallelParams, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(betting).toHaveBeenCalledTimes(2);
    const posted = betting.mock.calls.map(call => (call[1] as BetOption).type).sort();
    expect(posted).toEqual(["Polymarket", "RAY"]);
  });

  it("混合对：fo 已锁盘也不在 place 阶段二次阻断", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { detectionOdds: 5, detectionMaxPrice: 0.2, detectionClobPrice: 0.2 };
    const rayLeg = leg("RAY", "Away");
    getOddsEntry.mockReturnValue({ clobPrice: 0.2, isLock: true });

    const out = await placeArbLegs(params, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(getOddsEntry).not.toHaveBeenCalled();
    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("混合对：不做临 POST PM 复检，直接双边 POST", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    checkBetting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      if (option.type === "Polymarket") {
        option.data = null;
        option.checkError = "盘口价高于检测价";
        return option;
      }
      option.data = option.data ?? { ok: true };
      return option;
    });

    const out = await placeArbLegs(params, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("A8 双腿缺预检 data 时两侧都不 POST", async () => {
    const home = leg("OB", "Home");
    home.data = null;
    const away = leg("RAY", "Away");

    const out = await placeArbLegs(params, checked({
      legA: home,
      legB: away,
    }));

    expect(betting).not.toHaveBeenCalled();
    expect(out.placeOutcomeA).toBe("not_attempted");
    expect(out.placeOutcomeB).toBe("not_attempted");
  });

  it("混合对：不做检测价再预检，直接使用首次预检 data POST", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    rayLeg.odds = 2.12;
    checkBetting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      option.data = null;
      option.checkError = "赔率下降";
      return option;
    });

    const out = await placeArbLegs(params, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
      scanOddsA: 1.9,
      scanOddsB: 2.23,
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(2);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("9999 只下即时馆时不再按检测价重检，直接 POST 首次预检腿", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    rayLeg.odds = 2.12;
    rayLeg.betMoney = 55;
    betting.mockResolvedValue(new BetResult("RAY", true));

    const out = await placeArbLegs(params, checked({
      betBothLegs: false,
      singleLegByRate: true,
      accountA: undefined,
      accountB: account("RAY"),
      legA: pmLeg,
      legB: rayLeg,
      scanOddsA: 1.9,
      scanOddsB: 2.23,
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
    expect((betting.mock.calls[0]![1] as BetOption).type).toBe("RAY");
    expect(out.legA.type).toBe("RAY");
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("not_attempted");
  });

  it("9999 即时馆不做检测价再预检，直接下首次预检腿", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    checkBetting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      option.data = null;
      option.checkError = "赔率下降";
      return option;
    });

    const out = await placeArbLegs(params, checked({
      betBothLegs: false,
      singleLegByRate: true,
      accountA: undefined,
      accountB: account("RAY"),
      legA: pmLeg,
      legB: rayLeg,
      scanOddsB: 2.23,
    }));

    expect(checkBetting).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
    expect(out.placeOutcomeA).toBe("filled_pending_settle");
    expect(out.placeOutcomeB).toBe("not_attempted");
  });

  it("混合对 Serial 按 A8 顺序 POST：第一腿失败则不打第二腿", async () => {
    const serialParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Serial" } as never,
    };
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    rayLeg.data = { ok: 1 };
    let maxConcurrent = 0;
    let concurrent = 0;
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 15));
      concurrent--;
      return new BetResult(option.type, option.type === "RAY");
    });

    await placeArbLegs(serialParams, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(maxConcurrent).toBe(1);
    const posted = betting.mock.calls.map(call => (call[1] as BetOption).type).sort();
    expect(posted).toEqual(["Polymarket"]);
    expect(retryFailedLeg).not.toHaveBeenCalled();
  });

  it("pm delayed 已受理但 RAY 失败且即时补腿未成：等待 PM 确认，不入普通补单队列", async () => {
    const pmLeg = leg("Polymarket", "Home");
    pmLeg.betMoney = 39.54;
    pmLeg.odds = 2.3256;
    pmLeg.data = { ok: true };
    const rayLeg = leg("RAY", "Away");
    rayLeg.betMoney = 395;
    rayLeg.odds = 1.55;
    rayLeg.data = { ok: true };
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      if (option.type === "Polymarket") {
        return Object.assign(new BetResult("Polymarket", true), {
          pending: true,
          orderId: "0xpm",
        });
      }
      return new BetResult(option.type, false, "赔率下降");
    });
    retryFailedLeg.mockResolvedValueOnce(null);

    const out = await placeArbLegs(params, checked({
      legA: pmLeg,
      legB: rayLeg,
      accountA: account("Polymarket"),
      accountB: account("RAY"),
    }));

    expect(out.placeOutcomeA).toBe("accepted_pending_confirm");
    expect(out.placeOutcomeB).toBe("api_failed");
    expect(retryFailedLeg).toHaveBeenCalledTimes(1);
    expect(enqueueMakeUpOrder).not.toHaveBeenCalled();
  });

  it("Custom + OB/RAY：仍顺序下单", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    betting.mockImplementation(async (_acc: unknown, option: BetOption) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return new BetResult(option.type, true);
    });
    const customParams = {
      ...params,
      config: { ...createDefaultUserConfig(), betSorting: "Custom" } as never,
    };

    await placeArbLegs(customParams, checked());

    expect(betting).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
  });

  it("非混合对不读这条 fo 闸", async () => {
    getOddsEntry.mockReturnValue({ clobPrice: 0.99 });
    betting.mockResolvedValueOnce(new BetResult("OB", false));

    await placeArbLegs(params, checked());

    expect(getOddsEntry).not.toHaveBeenCalled();
    expect(betting).toHaveBeenCalledTimes(1);
  });
});
