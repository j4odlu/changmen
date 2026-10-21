import type { PmPrematchTokenSnapshot } from "@changmen/api-contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { AccountStoreContext } from "@/stores/account/context";
import type { ArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import type { ArbBetAttemptParams } from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSingleLeg9999MapCount, resetSingleLeg9999MapCountForTests } from "@/extensions/arbBet/singleLeg9999MapCount";
import { PlatformAccount } from "@/models/platformAccount";
import { getProviders, pickAccount } from "@/stores/account/accountPicker";
import { syncActiveBetBegin } from "@/stores/betting/activeBetRunSync";
import { createDefaultExtensionPrefs } from "@/types/extensionPrefs";
import { createDefaultUserConfig } from "@/types/userConfig";
import { prepareArbAttempt } from "./prepareArbAttempt";

const state = vi.hoisted(() => ({
  store: null as unknown as AccountStoreContext,
  prefs: null as unknown as ReturnType<typeof createDefaultExtensionPrefs>,
}));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({
  ...state.store,
  getProviders: (amount: number) => getProviders(state.store, amount),
  getAccount: (provider: PlatformAccount["provider"], amount: number, excluded: number[], filter: (account: PlatformAccount) => boolean, options: BetOption[]) => pickAccount(state.store, provider, amount, excluded, filter, options),
}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({
  config: createDefaultUserConfig(), extensionPrefs: state.prefs,
}) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({ getBetTarget: () => undefined }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/betting/successMarkers", () => ({ readUsedAccounts: () => [] }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetBegin: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbProgressTrace", () => ({ ensureArbExecutionTrace: vi.fn(), setArbExecutionTraceMeta: vi.fn() }));

function point(tokenId: string, price: number, marketId = "map-1"): PmPrematchTokenSnapshot {
  return { tokenId, price, marketId, status: "ready", registeredStart: 101000, cutoff: 100,
    observationTime: 99000, resolution: 0, checkedAt: 105000, nextCheckAt: 705000 };
}

function fixture(liveSide: "A" | "B" = "A", reversed = false): ArbBetAttemptParams {
  const accounts = (["RAY", "PB"] as const).map((provider, i) => {
    const live = (i === 0 ? "A" : "B") === liveSide;
    const account = new PlatformAccount({ provider, accountId: i + 1, playerName: provider, currency: "CNY",
      rateConfig: [{ minOdds: 0, maxOdds: 0, rate: live ? 1 : 9999 }] });
    account.balance = 1000;
    return account;
  });
  state.store = { loaded: true, accounts, providerPickIndex: new Map() } as AccountStoreContext;
  const legs = accounts.map((account, i) => ({ type: account.provider, target: i === 0 ? "Home" : "Away",
    matchId: "source-match", betId: "source-bet", itemId: `item-${i}`, odds: 2.1, betMoney: 100 })) as BetOption[];
  // PM 只提供 C 行参考，两条候选腿来自其它场馆。
  const bet = { id: 80001, round: 1, homeName: "A", awayName: "B", getOrderOptions: () => legs,
    items: [{ type: "Polymarket", homeId: reversed ? "b" : "a", awayId: reversed ? "a" : "b", updateOdds: () => {} }],
  } as unknown as ViewBet;
  const match = { id: 80000, gameId: 1, game: "英雄联盟", title: "A vs B", reverse: reversed ? ["Polymarket"] : [],
    pmPrematch: { a: point("a", .65), b: point("b", .35) },
  } as unknown as ViewMatch;
  const trace: ArbExecutionTrace = { id: "c-test", event: vi.fn(), finish: vi.fn(), setMeta: vi.fn(), getMeta: () => undefined };
  return { match, bet, trace, config: { ...createDefaultUserConfig(), minMoney: 0, maxMoney: 0, betMoney: 100 }, setMessage: vi.fn() };
}

beforeEach(() => {
  state.prefs = createDefaultExtensionPrefs();
  state.prefs.singleLeg9999HigherCProbabilityOnly = true;
  resetSingleLeg9999MapCountForTests();
  vi.mocked(syncActiveBetBegin).mockClear();
});
afterEach(() => resetSingleLeg9999MapCountForTests());

describe("9999 C 行筛选", () => {
  it.each([
    { liveSide: "A", reversed: false, allowed: true },
    { liveSide: "B", reversed: false, allowed: false },
    { liveSide: "A", reversed: true, allowed: false },
    { liveSide: "B", reversed: true, allowed: true },
  ] as const)("filters the actual $liveSide leg by aligned tokens (reversed=$reversed)", async ({ liveSide, reversed, allowed }) => {
    const params = fixture(liveSide, reversed);
    const ready = await prepareArbAttempt(params);
    if (allowed) {
      expect(ready?.singleLegByRate).toBe(true);
      expect(ready?.[liveSide === "A" ? "accountA" : "accountB"]).toBeDefined();
      expect(ready?.[liveSide === "A" ? "accountB" : "accountA"]).toBeUndefined();
      expect(ready?.[liveSide === "A" ? "checkAccountB" : "checkAccountA"]).toBeDefined();
      expect(getSingleLeg9999MapCount(params.match.id, params.bet.round)).toBe(1);
    }
    else {
      expect(ready).toBeNull();
      expect(params.trace!.finish).toHaveBeenCalledWith("skip", expect.stringContaining("低于对侧"));
      expect(getSingleLeg9999MapCount(params.match.id, params.bet.round)).toBe(0);
      expect(syncActiveBetBegin).not.toHaveBeenCalled();
    }
  });

  it.each(["no-pm", "waiting", "pending", "missing", "error", "tie", "wrong-map", "wrong-cutoff", "post-cutoff", "invalid-price", "sport", "unsupported-round"])("skips %s without reserving map count", async (condition) => {
    const params = fixture();
    const snapshots = params.match.pmPrematch!;
    if (condition === "no-pm") params.bet.items = [];
    if (condition === "waiting") delete snapshots.b;
    if (condition === "pending" || condition === "missing" || condition === "error") snapshots.a!.status = condition;
    if (condition === "tie") snapshots.b!.price = snapshots.a!.price;
    if (condition === "wrong-map") snapshots.b!.marketId = "map-2";
    if (condition === "wrong-cutoff") snapshots.b!.cutoff = 200;
    if (condition === "post-cutoff") snapshots.a!.observationTime = 101000;
    if (condition === "invalid-price") snapshots.a!.price = Number.NaN;
    if (condition === "sport") params.bet.marketCode = "moneyline";
    if (condition === "unsupported-round") params.bet.round = -1;
    expect(await prepareArbAttempt(params)).toBeNull();
    expect(params.trace!.finish).toHaveBeenCalledWith("skip", expect.stringContaining("9999 C 行过滤"));
    expect(getSingleLeg9999MapCount(params.match.id, params.bet.round)).toBe(0);
    expect(syncActiveBetBegin).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("uses only the current market's tokens (round=%s)", async (round) => {
    const params = fixture();
    params.bet.round = round;
    params.bet.items[0]!.homeId = "other-home";
    params.bet.items[0]!.awayId = "other-away";
    // 其它盘口的高主队概率不能替代当前盘口，等待当前 token 数据。
    expect(await prepareArbAttempt(params)).toBeNull();
    Object.assign(params.match.pmPrematch!, { "other-home": point("other-home", .4, `round-${round}`), "other-away": point("other-away", .6, `round-${round}`) });
    expect(await prepareArbAttempt(params)).toBeNull();
    params.match.pmPrematch!["other-home"]!.price = .7;
    expect((await prepareArbAttempt(params))?.singleLegByRate).toBe(true);
  });

  it.each(["lower", "missing"])("preserves existing 9999 behavior when disabled (%s)", async condition => {
    const params = fixture("B");
    state.prefs.singleLeg9999HigherCProbabilityOnly = false;
    if (condition === "missing") params.match.pmPrematch = undefined;
    expect((await prepareArbAttempt(params))?.accountB).toBeDefined();
  });

  it("does not filter ordinary two-leg arbitrage", async () => {
    const params = fixture();
    state.store.accounts[1]!.rateConfig = [{ minOdds: 0, maxOdds: 0, rate: 1 }];
    params.match.pmPrematch = undefined;
    const ready = await prepareArbAttempt(params);
    expect(ready?.betBothLegs).toBe(true);
    expect(ready?.singleLegByRate).toBe(false);
    expect(getSingleLeg9999MapCount(params.match.id, params.bet.round)).toBe(0);
  });

  it("still filters the live leg when 9999-side precheck is disabled", async () => {
    state.prefs.singleLeg9999Precheck = false;
    const rejected = fixture("B");
    expect(await prepareArbAttempt(rejected)).toBeNull();
    const ready = await prepareArbAttempt(fixture("A"));
    expect(ready?.accountA).toBeDefined();
    expect(ready?.checkAccountB).toBeUndefined();
  });
});
