import type { BetOption } from "@changmen/client-core/models/betOption";
import { describe, expect, it, vi } from "vitest";
import { accountPassesMainBetFilter } from "@/domain/betting/betFilters";
import { PlatformAccount } from "@/models/platformAccount";

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({
    getDefaultOdds: () => undefined,
    getBetTarget: () => undefined,
  }),
}));

function makeLeg(odds = 1.8): BetOption {
  return { type: "PB", target: "Home", odds, betMoney: 100 } as unknown as BetOption;
}

function makeAccount(patch: Record<string, unknown> = {}) {
  const acc = new PlatformAccount({
    accountId: 1,
    playerName: "test",
    provider: "PB",
    balance: 1000,
    ...patch,
  });
  acc.balance = 1000;
  return acc;
}

const matchStore = {
  getBetTarget: () => undefined,
} as never;

const bet = { id: 1 } as never;
const match = { game: "英雄联盟", gameId: 1 } as never;

describe("accountPassesMainBetFilter", () => {
  it.each([{ minOdds: 2 }, { maxOdds: 1.5 }])("automatic filtering retains account odds bounds: %j", (bounds) => {
    const acc = makeAccount(bounds);
    expect(accountPassesMainBetFilter(acc, bet, match, makeLeg(), matchStore)).toBe(false);
  });

  it("比例 9999 仍通过主过滤（单边模式逻辑在 extensions/arbBet）", () => {
    const acc = makeAccount({
      rateConfig: [{ minOdds: 0, maxOdds: 0, rate: 9999 }],
    });
    expect(
      accountPassesMainBetFilter(acc, bet, match, makeLeg(), matchStore),
    ).toBe(true);
  });

  it("正常比例时通过", () => {
    const acc = makeAccount({
      rateConfig: [{ minOdds: 0, maxOdds: 0, rate: 1 }],
    });
    expect(
      accountPassesMainBetFilter(acc, bet, match, makeLeg(), matchStore),
    ).toBe(true);
  });
});
