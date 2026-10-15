import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { AccountStoreContext } from "@/stores/account/context";
import type { PlatformId } from "@/types/esport";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { assertGtcHistoryAllowsLeg, markGtcSuccess } from "@/orderModes/gtc/successMarkers";
import { getProviders, pickAccount } from "@/stores/account/accountPicker";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { createDefaultUserConfig } from "@/types/userConfig";
import { prepareArbAttempt } from "./prepareArbAttempt";
import { prewarmPmSportForCandidate } from "@changmen/venue-adapter/polymarket";
import { capturePmFokPreflightMode, setPmFokPreflightMode } from "@changmen/venue-adapter/polymarket";
vi.mock("@changmen/venue-adapter/polymarket", async importOriginal => ({ ...await importOriginal<typeof import("@changmen/venue-adapter/polymarket")>(), prewarmPmSportForCandidate: vi.fn() }));

const state = vi.hoisted(() => ({ store: null as unknown as AccountStoreContext, historyStatus: vi.fn() }));
vi.mock("@/orderModes/gtc/selectionHistory", () => ({
  gtcSelectionHistoryStatus: state.historyStatus,
  gtcHistoryAllowsAccount: (...args: Parameters<typeof assertGtcHistoryAllowsLeg>) => {
    try { assertGtcHistoryAllowsLeg(...args); return true; } catch { return false; }
  },
}));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({
  ...state.store,
  getProviders: (amount: number) => getProviders(state.store, amount),
  getAccount: (provider: PlatformId, amount: number, excluded: number[], filter: (account: PlatformAccount) => boolean, options: BetOption[]) => pickAccount(state.store, provider, amount, excluded, filter, options),
}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({
  userId: "owner", config: createDefaultUserConfig(),
  extensionPrefs: { arbAllowedPlatforms: null, stakeScaleByProfit: { enabled: false } },
}) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({ getBetTarget: () => undefined }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetBegin: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbProgressTrace", () => ({ ensureArbExecutionTrace: vi.fn(), setArbExecutionTraceMeta: vi.fn() }));

let betId = 80_000;
const combinations = [
  { name: "PM FOK", providers: ["Polymarket", "RAY"], mode: "FOK" },
  { name: "ordinary venues", providers: ["RAY", "PB"], mode: "FOK" },
  { name: "ordinary venues with GTC preference", providers: ["RAY", "PB"], mode: "GTC" },
  { name: "PM GTC shared prepare", providers: ["Polymarket", "RAY"], mode: "GTC" },
] as const;
const histories = ["count", "odds", "opposite"] as const;

beforeEach(() => { sessionStorage.clear(); state.historyStatus.mockReset(); setPmFokPreflightMode("legacy"); vi.mocked(prewarmPmSportForCandidate).mockClear(); });
it.each(["legacy", "optimized"] as const)("prewarms only optimized FOK candidates and freezes %s before account selection", async mode => {
  setPmFokPreflightMode(mode);
  const fixture = makeFixture(["Polymarket", "RAY"], "FOK", "count");
  await prepareArbAttempt(fixture.params);
  expect(prewarmPmSportForCandidate).toHaveBeenCalledTimes(mode === "optimized" ? 1 : 0);
  setPmFokPreflightMode(mode === "legacy" ? "optimized" : "legacy");
  expect(capturePmFokPreflightMode(fixture.legs[0]!)).toBe(mode);
});
it("keeps GTC prewarm independent of the default legacy FOK preference", async () => {
  const fixture = makeFixture(["Polymarket", "RAY"], "GTC", "count");
  await prepareArbAttempt(fixture.params);
  expect(prewarmPmSportForCandidate).toHaveBeenCalledTimes(1);
});
describe.each(combinations)("$name preserves VPS account selection", ({ providers, mode }) => {
  it.each(histories)("GTC %s history filters only a PM GTC pair", async (history) => {
    const fixture = makeFixture(providers, mode, history);
    seedHistory(fixture, history, true);
    const ready = await prepareArbAttempt(fixture.params);
    if (mode === "GTC" && providers[0] === "Polymarket") {
      expect(ready).toBeNull();
      return;
    }
    expect(state.historyStatus).not.toHaveBeenCalled();
    expect(ready?.accountA).toBe(fixture.accounts[0]);
    expect(ready?.accountB).toBe(fixture.accounts[1]);
    expect(ready?.betBothLegs).toBe(true);
    expect(ready?.pmOrderMode).toBe(mode === "GTC" && providers[0] === "Polymarket" ? "GTC" : undefined);
  });
  it.each(histories)("original %s history still rejects both accounts", async (history) => {
    const fixture = makeFixture(providers, mode, history);
    seedHistory(fixture, history, false);
    expect(await prepareArbAttempt(fixture.params)).toBeNull();
  });
});

describe("GTC history before account selection", () => {
  it.each(histories)("selects another eligible account instead of failing after precheck: %s", async (history) => {
    const fixture = makeFixture(["Polymarket", "RAY"], "GTC", history);
    seedHistory(fixture, history, true);
    const alternatives = fixture.accounts.map(account => {
      const other = new PlatformAccount({ provider: account.provider, accountId: account.accountId + 10, playerName: "alternative", currency: "CNY", maxBetCount: account.maxBetCount, lastOdds: account.lastOdds });
      other.balance = 1000; return other;
    });
    state.store.accounts.push(...alternatives);
    const ready = await prepareArbAttempt(fixture.params);
    expect(ready?.accountA).toBe(alternatives[0]);
    expect(ready?.accountB).toBe(alternatives[1]);
  });
  it("skips selection while recovery is pending, then uses newly scanned odds", async () => {
    const fixture = makeFixture(["Polymarket", "RAY"], "GTC", "odds");
    state.historyStatus.mockReturnValueOnce("GTC 本盘口历史恢复中，等待重新选号");
    expect(await prepareArbAttempt(fixture.params)).toBeNull();
    expect(state.store.providerPickIndex.size).toBe(0);
    fixture.legs[0]!.odds = 2.5;
    markGtcSuccess("owner", 1, fixture.params.bet.id, "Home", 2.1);
    expect((await prepareArbAttempt(fixture.params))?.legA.odds).toBe(2.5);
  });
});

function makeFixture(providers: readonly PlatformId[], mode: "FOK" | "GTC", history: typeof histories[number]) {
  const accounts = providers.map((provider, index) => {
    const account = new PlatformAccount({ provider, accountId: index + 1, playerName: `p${index}`, currency: "CNY" });
    account.balance = 1000;
    account.maxBetCount = history === "count" ? 1 : 0;
    account.lastOdds = history === "odds";
    return account;
  });
  state.store = { accounts, loaded: true, providerPickIndex: new Map() } as AccountStoreContext;
  const legs = providers.map((type, index) => ({ type, target: index === 0 ? "Home" : "Away", odds: 2, betMoney: 100 })) as BetOption[];
  const bet = { id: ++betId, items: [], getOrderOptions: () => legs } as unknown as ViewBet;
  const config = { ...createDefaultUserConfig(), minMoney: 0, maxMoney: 0, betMoney: 100, profit: 1, noSameBet: history === "opposite" };
  const params = { match: { id: 1, gameId: 1, title: "A vs B", game: "英雄联盟" } as ViewMatch, bet, config, pmOrderMode: mode, setMessage: vi.fn() };
  return { accounts, legs, params };
}

function seedHistory(fixture: ReturnType<typeof makeFixture>, history: typeof histories[number], gtc: boolean) {
  fixture.accounts.forEach((account, index) => {
    const side = fixture.legs[index]!.target;
    const historicalSide = history === "opposite" ? (side === "Home" ? "Away" : "Home") : side;
    if (gtc) markGtcSuccess("owner", account.accountId, fixture.params.bet.id, historicalSide, 2.1);
    else markSuccessfulBet(account, fixture.params.bet.id, historicalSide, 2.1);
  });
}
