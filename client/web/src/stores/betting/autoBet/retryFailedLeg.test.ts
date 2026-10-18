import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { PlatformAccount } from "@/models/platformAccount";
import { hedgeStakeCnyFromLeg } from "@/domain/polymarket/pmArbStake";
import { retryFailedLeg } from "@/stores/betting/autoBet/retryFailedLeg";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";

const getAccount = vi.fn();
const checkBetting = vi.fn();
const betting = vi.fn();
const extensionPrefs = vi.hoisted((): { makeupOddsBand: MakeupOddsBandPrefs } => ({
  makeupOddsBand: { enabled: false, upper: 1.02, lower: 0.96 },
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({
    getAccount,
    checkBetting,
    betting,
  }),
}));

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({
    getBetTarget: () => undefined,
  }),
}));

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({
    extensionPrefs,
  }),
}));

vi.mock("@/stores/betting/successMarkers", () => ({
  readUsedAccounts: () => [],
}));

function makeItem(type: string, odds: number) {
  return {
    type,
    matchId: "m1",
    betId: "b1",
    updateOdds: vi.fn(),
    getOdds: (_side?: string) => odds,
    getItemId: (side: string) => `${type}:${side}`,
  };
}

describe("retryFailedLeg stake (A8 anyOdds + PM CNY)", () => {
  it("uses CNY when success leg is PM after checkBet", () => {
    const pmAccount = new PlatformAccount({
      accountId: 1,
      provider: "Polymarket",
      playerName: "pm",
      currency: "USDT",
    });
    const successLeg = new BetOption(
      "Polymarket" as never,
      "m1",
      "b1",
      "i1",
      14,
      "Away",
      1.695,
    );
    const stake = hedgeStakeCnyFromLeg(
      successLeg.odds,
      successLeg.betMoney,
      successLeg.type,
      2.63,
      pmAccount,
    );
    expect(stake).toBe(60);
  });

  it("matches raw betMoney for CNY success leg", () => {
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 98, "Home", 1.695);
    const stake = hedgeStakeCnyFromLeg(
      successLeg.odds,
      successLeg.betMoney,
      successLeg.type,
      2.63,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
    );
    expect(stake).toBe(63);
  });
});

describe("retryFailedLeg PM settlement defer", () => {
  beforeEach(() => {
    getAccount.mockReset();
    checkBetting.mockReset();
    betting.mockReset();
    extensionPrefs.makeupOddsBand = { enabled: false, upper: 1.02, lower: 0.96 };
  });

  it("sets deferPostAcceptSettlement on Polymarket retry leg", async () => {
    const pmAccount = new PlatformAccount({
      accountId: 1,
      provider: "Polymarket",
      playerName: "pm",
      currency: "USDT",
    });
    const match = { id: 1, title: "A vs B" } as never;
    const bet = {
      id: 100,
      items: [makeItem("Polymarket", 2.63)],
    } as never;
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 98, "Home", 1.695);
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 70, "Away", 4.0);

    getAccount.mockReturnValue(pmAccount);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.betMoney = 9.4;
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(
      Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "0xretry" }),
    );

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(out?.leg.deferPostAcceptSettlement).toBe(true);
    expect(betting).toHaveBeenCalledWith(
      pmAccount,
      expect.objectContaining({ deferPostAcceptSettlement: true }),
      10,
      undefined,
    );
  });

  it("submits prepared retry data without an extra post-precheck profit gate (A8)", async () => {
    const rayAccount = new PlatformAccount({
      accountId: 3,
      provider: "RAY",
      playerName: "ray",
    });
    const match = { id: 1, title: "A vs B" } as never;
    const bet = {
      id: 101,
      items: [makeItem("RAY", 1.7)],
    } as never;
    const successLeg = new BetOption(
      "Polymarket" as never,
      "m1",
      "b1",
      "pm1",
      264.91,
      "Home",
      2.3256,
    );
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 395, "Away", 1.94);

    getAccount.mockReturnValue(rayAccount);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.odds = 1.55;
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(new BetResult("RAY", true));

    const trace = { event: vi.fn() };
    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "Polymarket", playerName: "pm" }),
      { anyOdds: true, anyOddsProfit: 0.97, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
      trace as never,
    );

    expect(out?.result.success).toBe(true);
    expect(checkBetting).toHaveBeenCalledOnce();
    expect(betting).toHaveBeenCalledOnce();
    expect(trace.event).not.toHaveBeenCalledWith(
      "重试",
      expect.stringContaining("组合收益"),
    );
  });

  it("honors anyOddsProfit below 1 for controlled loss-cover retry", async () => {
    const rayAccount = new PlatformAccount({
      accountId: 3,
      provider: "RAY",
      playerName: "ray",
    });
    const match = { id: 1, title: "A vs B" } as never;
    const bet = {
      id: 102,
      items: [makeItem("RAY", 1.55)],
    } as never;
    const successLeg = new BetOption(
      "Polymarket" as never,
      "m1",
      "b1",
      "pm1",
      264.91,
      "Home",
      2.3256,
    );
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 395, "Away", 1.94);

    getAccount.mockReturnValue(rayAccount);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(new BetResult("RAY", true));

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "Polymarket", playerName: "pm" }),
      { anyOdds: true, anyOddsProfit: 0.9, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(out?.result.success).toBe(true);
    expect(betting).toHaveBeenCalledOnce();
  });

  it("does not reject the A8 integer stake near the candidate odds threshold", async () => {
    const account = new PlatformAccount({ accountId: 1, provider: "OB", playerName: "ob" });
    getAccount.mockReturnValue(account);
    checkBetting.mockImplementation(async (_account, option: BetOption) => {
      option.data = { ok: true };
      return option;
    });
    betting.mockResolvedValue(new BetResult("OB", true));
    const result = await retryFailedLeg(
      { id: 1, title: "A vs B" } as never,
      { id: 100, items: [makeItem("OB", 3.81)] } as never,
      new BetOption("RAY", "m", "b", "h", 80, "Home", 1.45),
      new BetOption("OB", "m", "b", "a", 30, "Away", 3.81),
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.05, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(result?.result.success).toBe(true);
    expect(betting).toHaveBeenCalledWith(account, expect.objectContaining({ betMoney: 30, odds: 3.81 }), 10, undefined);
  });
});

describe("retryFailedLeg makeupOddsBand", () => {
  beforeEach(() => {
    extensionPrefs.makeupOddsBand = { enabled: true, upper: 1.02, lower: 0.96 };
    getAccount.mockReset();
    checkBetting.mockReset();
    betting.mockReset();
  });

  afterEach(() => {
    extensionPrefs.makeupOddsBand = { enabled: false, upper: 1.02, lower: 0.96 };
  });

  it("keeps retrying later rounds when best live odds sit in the band", async () => {
    const item = makeItem("OB", 2.00);
    const match = { id: 1, title: "A vs B" } as never;
    const bet = { id: 100, items: [item] } as never;
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 100, "Home", 2);
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 100, "Away", 2);

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(out).toBeNull();
    expect(item.updateOdds).toHaveBeenCalledTimes(3);
    expect(getAccount).not.toHaveBeenCalled();
    expect(betting).not.toHaveBeenCalled();
  });

  it("falls back to the A8 candidate gate when the odds band has no solution", async () => {
    const acc = new PlatformAccount({ accountId: 1, provider: "OB", playerName: "ob1" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(new BetResult("OB", true));

    const match = { id: 1, title: "A vs B" } as never;
    const bet = { id: 100, items: [makeItem("OB", 250)] } as never;
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 100, "Home", 1);
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 100, "Away", 4);

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(out?.result.success).toBe(true);
    expect(betting).toHaveBeenCalledOnce();
  });

  it("does not use the band on immediate retry when makeUp is off", async () => {
    const item = makeItem("OB", 2.00);
    const match = { id: 1, title: "A vs B" } as never;
    const bet = { id: 100, items: [item] } as never;
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 100, "Home", 2);
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 100, "Away", 2);

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.01, noSameBet: false, makeUp: false } as never,
      10,
    );

    expect(out).toBeNull();
    expect(item.updateOdds).toHaveBeenCalledTimes(1);
    expect(betting).not.toHaveBeenCalled();
  });

  it("allows controlled-loss retry in profit-rate mode below the loss bound", async () => {
    extensionPrefs.makeupOddsBand = {
      enabled: true,
      mode: "profitRate",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    };
    const acc = new PlatformAccount({ accountId: 1, provider: "OB", playerName: "ob1" });
    getAccount.mockReturnValue(acc);
    checkBetting.mockImplementation(async (_acc, opt: BetOption) => {
      opt.data = { ok: true };
      return opt;
    });
    betting.mockResolvedValue(new BetResult("OB", true));

    const match = { id: 1, title: "A vs B" } as never;
    const bet = { id: 100, items: [makeItem("OB", 1.8)] } as never;
    const successLeg = new BetOption("RAY" as never, "m1", "b1", "i1", 100, "Home", 2);
    const failedLeg = new BetOption("OB" as never, "m2", "b2", "a1", 100, "Away", 2);

    const out = await retryFailedLeg(
      match,
      bet,
      successLeg,
      failedLeg,
      new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "ray" }),
      { anyOdds: false, makeProfit: 1.01, noSameBet: false, makeUp: true } as never,
      10,
    );

    expect(out?.result.success).toBe(true);
    expect(betting).toHaveBeenCalledOnce();
  });
});
