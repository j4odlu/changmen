import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { AccountStoreContext } from "@/stores/account/context";
import type { PlatformId } from "@/types/esport";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { markGtcSuccess } from "@/orderModes/gtc/successMarkers";
import { getProviders, pickAccount } from "@/stores/account/accountPicker";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { createDefaultUserConfig } from "@/types/userConfig";
import { prepareArbAttempt } from "./prepareArbAttempt";
import { prewarmPmSportForCandidate } from "@changmen/venue-browser/adapter/polymarket";
import { capturePmFokPreflightMode, setPmFokPreflightMode } from "@changmen/venue-browser/adapter/polymarket";
vi.mock("@changmen/venue-browser/adapter/polymarket", async importOriginal => ({ ...await importOriginal<typeof import("@changmen/venue-browser/adapter/polymarket")>(), prewarmPmSportForCandidate: vi.fn() }));

const state = vi.hoisted(() => ({ store: null as unknown as AccountStoreContext }));
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
] as const;
const histories = ["count", "odds", "opposite"] as const;

beforeEach(() => { sessionStorage.clear(); setPmFokPreflightMode("legacy"); vi.mocked(prewarmPmSportForCandidate).mockClear(); });
it.each(["legacy", "optimized"] as const)("FOK skips Gamma prewarm and freezes %s before account selection", async mode => {
  setPmFokPreflightMode(mode);
  const fixture = makeFixture(["Polymarket", "RAY"], "count");
  await prepareArbAttempt(fixture.params);
  expect(prewarmPmSportForCandidate).not.toHaveBeenCalled();
  setPmFokPreflightMode(mode === "legacy" ? "optimized" : "legacy");
  expect(capturePmFokPreflightMode(fixture.legs[0]!)).toBe(mode);
});

describe.each(combinations)("$name preserves ordinary selection", ({ providers }) => {
  it.each(histories)("old GTC %s history does not filter new arbitrage", async history => {
    const fixture = makeFixture(providers, history); seedHistory(fixture, history, true);
    const ready = await prepareArbAttempt(fixture.params);
    expect(ready?.accountA).toBe(fixture.accounts[0]); expect(ready?.accountB).toBe(fixture.accounts[1]);
    expect(ready).not.toHaveProperty("pmOrderMode"); expect(ready).not.toHaveProperty("originalExecution");
    expect(prewarmPmSportForCandidate).not.toHaveBeenCalled();
  });
  it.each(histories)("ordinary %s history continues to reject both accounts", async history => {
    const fixture = makeFixture(providers, history); seedHistory(fixture, history, false);
    expect(await prepareArbAttempt(fixture.params)).toBeNull();
  });
});
function makeFixture(providers: readonly PlatformId[], history: typeof histories[number]) {
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
  const params = { match: { id: 1, gameId: 1, title: "A vs B", game: "英雄联盟" } as ViewMatch, bet, config, setMessage: vi.fn() };
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


it("🎯 keeps both normal accounts for LOS precheck and skips a consumed market", async () => {
  const fixture = makeFixture(["Polymarket", "RAY"], "count");
  const params = { ...fixture.params, executionMode: "lowOddsSingle" as const };
  const ready = await prepareArbAttempt(params);
  expect(ready?.executionMode).toBe("lowOddsSingle");
  expect(ready?.betBothLegs).toBe(true);
  expect(ready?.accountA).toBe(fixture.accounts[0]);
  expect(ready?.accountB).toBe(fixture.accounts[1]);
  expect(ready?.singleLegByRate).toBe(false);
  expect(ready?.linkId).toBeLessThan(-6_000_000_000_000_000);
  expect(ready?.linkId).toBeGreaterThan(-7_000_000_000_000_000);
  const key = "LowOddsSingleSubmitted:v1";
  try {
    localStorage.setItem(key, JSON.stringify(ready!.lowOddsMarketKeys));
    expect(await prepareArbAttempt(params)).toBeNull();
  }
  finally { localStorage.removeItem(key); }
});
