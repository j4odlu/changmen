vi.mock("@changmen/venue-adapter/polymarket", async importOriginal => ({ ...await importOriginal<typeof import("@changmen/venue-adapter/polymarket")>(), validatePolymarketPreparedBuy: () => null }));
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { PlatformAccount as PlatformAccountCore } from "@changmen/client-core/models/platformAccount";
import { obProvider } from "@changmen/venue-adapter/ob";
import { checkArbLegs } from "@/stores/betting/autoBet/phases/checkArbLegs";
import { placeArbLegs } from "@/stores/betting/autoBet/phases/placeArbLegs";
import { createDefaultUserConfig } from "@/types/userConfig";

/**
 * 混合对 OB + PM 走真实 OB 适配器：OB 的 checkBet 是往 `/game/bet` 打的探测单，
 * 同一注单连打两次会被场馆判「请勿重复提交」。本文件用假 OB 场馆（带重复提交闸）
 * 驱动 checkArbLegs → placeArbLegs，钉住「OB 腿一轮只提交一次探测单」。
 */

const OB_DEDUPE_MS = 5000;

interface ObSubmission {
  betLine: string;
  amount: number;
  at: number;
}

const submissions: ObSubmission[] = [];
let now = 1_700_000_000_000;

const accountHttpRequest = vi.hoisted(() => vi.fn());
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));

vi.mock("@changmen/client-core/shared/platformHttp", () => ({
  accountHttpRequest: (...args: unknown[]) => accountHttpRequest(...args),
  registerPlatformHttpContext: vi.fn(),
}));

vi.mock("@changmen/client-core/shared/wait", () => ({ wait: vi.fn(async () => {}) }));

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

const getEntry = vi.hoisted(() => vi.fn());

vi.mock("@/stores/oddsStore", () => ({
  useOddsStore: () => ({ getEntry }),
}));

vi.mock("@/stores/betting/activeBetRunSync", () => ({
  syncActiveBetPhase: vi.fn(),
  syncActiveBetLeg: vi.fn(),
  syncActiveBetFail: vi.fn(),
  syncActiveBetPlaceResults: vi.fn(),
  syncActiveBetPrecheckResults: vi.fn(),
  scheduleActiveBetRunRemoval: vi.fn(),
}));

vi.mock("@/stores/betting/autoBet/retryFailedLeg", () => ({
  retryFailedLeg: vi.fn(async () => null),
}));

let pmPosts = 0;

/** 只保留 betGateway 对套利下单的两条规则：预检不改 OB 的 CNY 额、POST 必须有冻价 */
const accountStoreStub = {
  async checkBetting(account: PlatformAccount, option: BetOption) {
    if (account.provider === "OB")
      return obProvider.checkBet!(account, option);
    option.data = { detectionOdds: option.odds, ok: true };
    return option;
  },
  async betting(account: PlatformAccount, option: BetOption) {
    if (!option.data)
      return new BetResult(option.type, false, option.checkError || "预检未通过");
    if (account.provider === "OB")
      return obProvider.betting(account, option);
    pmPosts++;
    return new BetResult(option.type, true, "matched");
  },
};

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => accountStoreStub,
}));

/** 假 OB 场馆：a=1 探测单回 Minimum；同一注单重复提交回「请勿重复提交」；真实额受理 */
function obVenueReply(bodyText: string): { status: string; data: string } {
  const form = new URLSearchParams(bodyText);
  const betLine = form.get("b[0]") ?? "";
  const amount = Number(new URLSearchParams(betLine).get("a")) || 0;
  const duplicated = submissions.some(
    row => row.betLine === betLine && now - row.at < OB_DEDUPE_MS,
  );
  submissions.push({ betLine, amount, at: now });
  if (duplicated)
    return { status: "false", data: "请勿重复提交" };
  if (amount <= 1)
    return { status: "false", data: "Minimum stake 10" };
  return { status: "true", data: "下单成功" };
}

function obAccount(): PlatformAccount {
  return new PlatformAccountCore({
    accountId: 1,
    playerName: "ob1",
    provider: "OB",
    gateway: "https://ob.example",
    token: "tok",
  }) as PlatformAccount;
}

function pmAccount(): PlatformAccount {
  return new PlatformAccountCore({
    accountId: 2,
    playerName: "pm1",
    provider: "Polymarket",
    gateway: "https://clob.example",
    token: "{}",
  }) as PlatformAccount;
}

function leg(type: string, betMoney: number, odds: number, target: "Home" | "Away"): BetOption {
  return new BetOptionClass(type as never, "m1", "b1", `i-${target}`, betMoney, target, odds);
}

const params: ArbBetAttemptParams = {
  match: { id: 1, title: "A vs B", bets: [] } as never,
  bet: { id: 10, getBetName: () => "全场" } as never,
  config: { ...createDefaultUserConfig(), betSorting: "Serial" } as never,
  setMessage: vi.fn(),
};

function ready(obLeg: BetOption, pmLeg: BetOption, ob: PlatformAccount, pm: PlatformAccount): ArbBetReady {
  return {
    legA: obLeg,
    legB: pmLeg,
    accountA: ob,
    accountB: pm,
    implied: 1.05,
    betBothLegs: true,
    singleLegByRate: false,
    linkId: 1_700_000_000_000,
    stakeScale: 1,
  };
}

function probeCount(): number {
  return submissions.filter(row => row.amount <= 1).length;
}

function realBets(): ObSubmission[] {
  return submissions.filter(row => row.amount > 1);
}

describe("混合对 OB + PM 一轮下单（真实 OB 适配器）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submissions.length = 0;
    pmPosts = 0;
    now = 1_700_000_000_000;
    getEntry.mockReturnValue(undefined);
    accountHttpRequest.mockImplementation(async (
      _account: unknown,
      url: string,
      init: { body?: string },
    ) => {
      if (!String(url).includes("/game/bet"))
        throw new Error(`未预期的 OB 请求：${url}`);
      // PM 复检（约一次 /book 往返）之后 OB 才 POST
      now += 400;
      return { status: 200, text: JSON.stringify(obVenueReply(String(init.body ?? ""))) };
    });
  });

  it("OB 腿一轮只提交一次探测单，真实注单照样发出", async () => {
    const obLeg = leg("OB", 100, 1.9, "Home");
    const pmLeg = leg("Polymarket", 22, 3.1, "Away");
    const ob = obAccount();
    const pm = pmAccount();

    const checked = await checkArbLegs(params, ready(obLeg, pmLeg, ob, pm));
    expect(checked).not.toBeNull();

    const placed = await placeArbLegs(params, checked!);

    expect(submissions.map(row => row.amount)).toEqual([1, 100]);
    expect(probeCount()).toBe(1);
    expect(realBets()).toHaveLength(1);
    expect(placed.resultA?.success).toBe(true);
    expect(placed.placeOutcomeA).toBe("filled_pending_settle");
    expect(placed.placeOutcomeB).toBe("filled_pending_settle");
    expect(pmPosts).toBe(1);
  });

  it("A8 模式：首次预检齐后直接 POST，不做 PM 临下单复检", async () => {
    const obLeg = leg("OB", 100, 1.9, "Home");
    const pmLeg = leg("Polymarket", 22, 3.1, "Away");
    const ob = obAccount();
    const pm = pmAccount();
    const checked = await checkArbLegs(params, ready(obLeg, pmLeg, ob, pm));
    expect(checked).not.toBeNull();

    const spy = vi.spyOn(accountStoreStub, "checkBetting");
    const placed = await placeArbLegs(params, checked!);
    spy.mockRestore();

    expect(spy).not.toHaveBeenCalled();
    expect(realBets()).toHaveLength(1);
    expect(placed.placeOutcomeA).toBe("filled_pending_settle");
    expect(placed.placeOutcomeB).toBe("filled_pending_settle");
  });

  it("PM 腿预检未过时 OB 连探测单都不该白打第二次", async () => {
    const obLeg = leg("OB", 100, 1.9, "Home");
    const pmLeg = leg("Polymarket", 22, 3.1, "Away");
    const spy = vi.spyOn(accountStoreStub, "checkBetting").mockImplementation(
      async (account: PlatformAccount, option: BetOption) => {
        if (account.provider === "OB")
          return obProvider.checkBet!(account, option);
        option.data = null;
        option.checkError = "无盘口数据";
        return option;
      },
    );

    const checked = await checkArbLegs(params, ready(obLeg, pmLeg, obAccount(), pmAccount()));
    spy.mockRestore();

    expect(checked).toBeNull();
    expect(probeCount()).toBe(1);
  });
});
