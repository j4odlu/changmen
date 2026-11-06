import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { toViewMatches } from "@changmen/client-core/models/match";
import { registerOddsAccess, clearOddsAccess, type OddsAccessBridge } from "@changmen/client-core/bridge/oddsAccess";
import type { ClientMatchDto } from "@changmen/api-contract";
import { createDefaultUserConfig } from "@/types/userConfig";
import { pickArbLegs } from "@changmen/arb-core/arbitrage/pickArbLegs";
import { resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly/prematchFullOnly";
const mocks = vi.hoisted(() => ({ user: {} as Record<string, any>, account: {} as Record<string, any>, lose: {} as Record<string, any>,
  authenticated: true, funded: true, version: "session-1", muted: false, pending: false,
  bind: vi.fn(), early: vi.fn(), ev: vi.fn(),
  post: vi.fn(), execute: vi.fn(), maintenance: vi.fn(), clean: vi.fn(), startFeed: vi.fn(), stopFeed: vi.fn() }));
vi.mock("@/models/match", async () => import("@changmen/client-core/models/match"));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.version, isAuthSessionCurrent: (version: string) => version === mocks.version,
  isWebAuthenticated: () => mocks.authenticated, post: (...args: unknown[]) => mocks.post(...args) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => mocks.account }));
vi.mock("@/stores/oddsStore", () => ({ useOddsStore: () => ({ clean: mocks.clean }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => mocks.lose }));
vi.mock("@/stores/account/accountPicker", () => ({ accountsFundingReady: () => mocks.funded }));
vi.mock("@/extensions/mapBetMute", () => ({ isMapMuteActive: () => mocks.muted }));
vi.mock("@/orderModes/router", () => ({ executeArbBet: (...args: unknown[]) => mocks.execute(...args) }));
vi.mock("@/stores/betting/runArbBetRound", async () => {
  const original = await import("../../web/src/stores/betting/runArbBetRound");
  return { runArbBetRound: async (context: Parameters<typeof original.runArbBetRound>[0]) => { await mocks.maintenance(context); await original.runArbBetRound(context); } };
});
vi.mock("@/stores/betting/pendingOrderBind", () => ({ peekPendingOrderBinds: () => mocks.pending ? [{}] : [], processPendingOrderBinds: mocks.bind }));
vi.mock("@/extensions/arbBet/arbEarlyLockSell", () => ({ runArbEarlyLockSellTick: mocks.early }));
vi.mock("@/extensions/valueBet/valueBetAutoBet", () => ({ runValueBetAutoBetTick: mocks.ev }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => store }));
vi.mock("@/lib/sessionRefresh", () => ({ ensureTokenRefresh: vi.fn() }));
vi.mock("@/services/pmSportRealtime", () => ({ startPmSportRealtimeFeed: mocks.startFeed, stopPmSportRealtimeFeed: mocks.stopFeed }));
import { installListenerStore, drainListenerRuntime } from "../module";
import { liveState } from "../module/state";
import { runMainBetLoopTick } from "../module/mainBetLoop";
import { runMainBetLoopFinally } from "../../web/src/stores/match/mainBetLoop";
import type { useMatchStore } from "../../web/src/stores/matchStore";
import { runA8ArbRound as originalArbRound } from "../../web/src/stores/betting/a8/runA8ArbRound";
import { buildOrderOptions } from "../../web/src/domain/betting/buildOrderOptions";
import { filterArbProviderKeys } from "@/types/extensionPrefs";

type Store = ReturnType<typeof useMatchStore>;
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
let quotes: Map<string, { odds: number; locked: boolean; time: number }>;
let store: Store;
let originalHost: Pick<Store, "startMainLoop" | "stopMainLoop" | "fetchMatches" | "runMainLoopTick" | "scheduleMainLoop">;
const list = (): ClientMatchDto[] => [{ ID: 1, Title: "Team A vs Team B", Game: "CS2", GameID: 1, BO: 3, StartTime: 0, Matchs: { OB: "1", RAY: "1" },
  Bets: [101, 102].map(ID => ({ ID, MatchID: 1, Map: ID - 101, Name: "获胜", HomeID: 1, AwayID: 2, HomeName: "Team A", AwayName: "Team B", Sources: {
    OB: { Type: "OB", BetID: String(ID), HomeID: `h${ID}`, AwayID: `a${ID}`, HomeOdds: 0, AwayOdds: 0 },
    RAY: { Type: "RAY", BetID: String(ID), HomeID: `h${ID}`, AwayID: `a${ID}`, HomeOdds: 0, AwayOdds: 0 },
  } })), }];
beforeEach(async () => {
  await drainListenerRuntime();
  resetPrematchFullOnlyForTests();
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(1_000_000);
  mocks.authenticated = true; mocks.funded = true; mocks.version = "session-1"; mocks.muted = false;
  mocks.pending = false; mocks.bind.mockImplementation(async () => { mocks.pending = false; }); mocks.early.mockResolvedValue(undefined); mocks.ev.mockResolvedValue(undefined);
  mocks.user = reactive({ userId: 73, userName: "any-user", isLoggedIn: true, config: createDefaultUserConfig(), extensionPrefs: { arbAllowedPlatforms: null } });
  mocks.account = reactive({ loaded: true, accounts: [{ accountId: 1, provider: "OB", profit: 0, balance: 500, active: false }, { accountId: 2, provider: "RAY", profit: 0, balance: 500, active: false }],
    getProviders: () => new Map([["OB", []], ["RAY", []]]) });
  mocks.lose = { orders: new Map(), ensureOrdersMap: vi.fn(), removeOrders: vi.fn() };
  quotes = reactive(new Map());
  for (const platform of ["OB", "RAY"]) for (const id of [101, 102]) for (const side of ["h", "a"])
    quotes.set(`${platform}:${side}${id}`, { odds: 2.2, locked: false, time: Date.now() });
  registerOddsAccess({ read: (platform, id) => { const row = quotes.get(`${platform}:${id}`); return row && !row.locked ? row.odds : 0; },
    save: () => {}, clean: () => {}, isOdds: () => true, getEntry: () => undefined, updateOddsLock: () => {}, updateBetLock: () => {}, updateMessage: () => {}, getLimit: () => undefined, setLimit: () => {},
  } satisfies OddsAccessBridge);
  store = reactive({ matchs: [], lastFetchAt: 0, loading: false, mainLoopRunning: false, defaultOddsFetchedAt: Date.now(), lastLoseOrderPruneAt: Date.now(),
    _rebuildProviderIndex: vi.fn(), setBettingMessage: vi.fn(), tickBettingAutoOpen: vi.fn(), processLoseOrders: vi.fn(), fetchMatchDefaultOdds: vi.fn(), updatePmSport: vi.fn(),
    getDefaultOdds: vi.fn(), refreshOddsOnBets: vi.fn(),
    // This host fixture models the original timer while exposing the body promise independently of cooldown.
    startMainLoop: vi.fn(async () => {
      store.stopMainLoop(); store.mainLoopRunning = true;
      await store.fetchMatches(true); void store.fetchMatchDefaultOdds(); mocks.startFeed(); store.scheduleMainLoop(0);
    }),
    stopMainLoop: vi.fn(() => { store.mainLoopRunning = false; clearTimeout(store.mainLoopTimer!); mocks.stopFeed(); }),
    scheduleMainLoop: vi.fn((delay: number) => {
      if (!store.mainLoopRunning) return;
      clearTimeout(store.mainLoopTimer!);
      store.mainLoopTimer = setTimeout(() => { void store.runMainLoopTick(); }, delay);
    }),
    runMainLoopTick: vi.fn(async () => {
      const state = { lastLoseOrderPruneAt: store.lastLoseOrderPruneAt };
      try { await runMainBetLoopTick(state); store.lastLoseOrderPruneAt = state.lastLoseOrderPruneAt; }
      finally { if (store.mainLoopRunning) void runMainBetLoopFinally().then(() => store.scheduleMainLoop(0)); }
    }),
    fetchMatches: async (force = false) => {
      if (!force && Date.now() - store.lastFetchAt < 30_000) return false;
      try {
        const result = await mocks.post();
        store.matchs = toViewMatches(result.success === 1 && Array.isArray(result.info) ? result.info : []);
        store.lastFetchAt = Date.now(); store.error = null;
        store.refreshOddsOnBets();
        if (Date.now() - store.defaultOddsFetchedAt > 600_000) await store.fetchMatchDefaultOdds();
        return true;
      } catch (error) { store.error = String(error); return false; }
    },
  }) as unknown as Store;
  mocks.post.mockResolvedValue({ success: 1, info: list() }); mocks.execute.mockResolvedValue(undefined); mocks.maintenance.mockResolvedValue(undefined);
  originalHost = { startMainLoop: store.startMainLoop, stopMainLoop: store.stopMainLoop, fetchMatches: store.fetchMatches,
    runMainLoopTick: store.runMainLoopTick, scheduleMainLoop: store.scheduleMainLoop };
  liveState.checks = 0; installListenerStore(store);
});
afterEach(async () => { await drainListenerRuntime(); clearOddsAccess(); vi.useRealTimers(); });
describe("integrated listener host (all order functions mocked)", () => {
  it("delegates startup/stop and preserves original tick/timer methods rather than replacing their business", async () => {
    expect(store.runMainLoopTick).toBe(originalHost.runMainLoopTick);
    expect(store.scheduleMainLoop).toBe(originalHost.scheduleMainLoop);
    await store.startMainLoop(); await flush();
    expect(originalHost.startMainLoop).toHaveBeenCalledOnce(); expect(originalHost.stopMainLoop).toHaveBeenCalledOnce();
    expect(mocks.startFeed).toHaveBeenCalledOnce(); expect(originalHost.scheduleMainLoop).toHaveBeenCalledWith(0);
    await drainListenerRuntime(); expect(originalHost.stopMainLoop).toHaveBeenCalledTimes(2); expect(mocks.stopFeed).toHaveBeenCalledTimes(2);
  });
  it.each(["buy", "total", "total-rounded", "profit-reject", "minOdds-reject", "locked", "whitelist", "profit-override", "disabled",
    "sort-Low", "sort-High", "sort-Parallel", "sort-WinRate", "fixed-provider"])("matches original shared leg/stake plans for %s", async scenario => {
    if (scenario.startsWith("total")) Object.assign(mocks.user.config, { betMoneyMode: "total", betMoney: 203, tenNumber: scenario === "total-rounded" });
    if (scenario === "profit-reject") mocks.user.config.maxProfit = 1.05;
    if (scenario === "minOdds-reject") mocks.user.config.minOdds = 3;
    if (scenario === "locked") { quotes.get("OB:h101")!.locked = true; quotes.get("RAY:h101")!.locked = true; }
    if (scenario === "whitelist") mocks.user.extensionPrefs.arbAllowedPlatforms = ["OB"];
    if (scenario === "profit-override") mocks.account.accounts[0].profit = 1.2;
    if (scenario.startsWith("sort-")) mocks.user.config.betSorting = scenario.slice(5);
    if (scenario === "fixed-provider") mocks.user.config.providerFixed = ["RAY"];
    mocks.user.config.betting = scenario !== "disabled";
    const plans: unknown[] = [];
    mocks.execute.mockImplementation(async ({ match, bet, config }) => {
      const providers = filterArbProviderKeys([...mocks.account.getProviders().keys()], mocks.user.extensionPrefs.arbAllowedPlatforms);
      const options = buildOrderOptions(bet, match, config, mocks.account.accounts, providers, { getEntry: () => undefined, getPmQuoteEntry: () => undefined });
      if (options) plans.push({ bet: bet.id, legs: options.map(option => ({ type: option.type, side: option.target, odds: option.odds, amount: option.betMoney })) });
    });
    await store.startMainLoop(); await flush(); const listenerPlans = [...plans];
    await drainListenerRuntime(); plans.length = 0; await originalArbRound({ setMessage: () => {} });
    expect(listenerPlans).toEqual(plans);
    if (["profit-reject", "minOdds-reject", "whitelist", "profit-override", "disabled"].includes(scenario)) expect(plans).toHaveLength(0);
    else expect(plans).toHaveLength(scenario === "locked" ? 1 : 2);
  });
  it("keeps the user's disabled setting, accepts any account and still monitors markets", async () => {
    await store.startMainLoop(); await flush();
    expect(mocks.user.config.betting).toBe(false); expect(liveState.markets).toBe(2); expect(liveState.opportunities).toBe(2); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("allows the user to enable buying and delegates to the existing execution entry", async () => {
    await store.startMainLoop(); await flush(); mocks.user.config.betting = true; await flush();
    expect(mocks.user.config.betting).toBe(true); expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0]![0].config).toBe(mocks.user.config);
  });
  it("lets the original executor roll an affordable random amount before filtering funds", async () => {
    Object.assign(mocks.user.config, { betting: true, betMoney: 1000, minMoney: 100, maxMoney: 1000 });
    mocks.account.getProviders = vi.fn((minimum: number) => minimum <= 500 ? new Map([["OB", []], ["RAY", []]]) : new Map());
    mocks.execute.mockImplementation(async ({ config }) => {
      // The reused prepare phase owns the random draw and exact funding check.
      config.betMoney = 100;
      expect(mocks.account.getProviders(config.betMoney).size).toBe(2);
    });
    await store.startMainLoop(); await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0]![0].config).toBe(mocks.user.config);
  });
  it("does not filter a random attempt by a pre-roll profit snapshot", async () => {
    Object.assign(mocks.user.config, { betting: true, minMoney: 100, maxMoney: 1000, maxProfit: 1.15 });
    mocks.account.accounts.push({ accountId: 3, provider: "PB", profit: 0, balance: 50, active: false });
    mocks.account.getProviders = (minimum: number) => new Map(mocks.account.accounts
      .filter((account: { balance: number }) => account.balance >= minimum).map((account: { provider: string }) => [account.provider, []]));
    const matches = list();
    for (const bet of matches[0]!.Bets!) {
      bet.Sources.PB = { Type: "PB", BetID: String(bet.ID), HomeID: `h${bet.ID}`, AwayID: `a${bet.ID}`, HomeOdds: 0, AwayOdds: 0 };
      quotes.set(`PB:h${bet.ID}`, { odds: 4, locked: false, time: Date.now() });
      quotes.set(`PB:a${bet.ID}`, { odds: 4, locked: false, time: Date.now() });
    }
    mocks.post.mockResolvedValueOnce({ success: 1, info: matches });
    await store.startMainLoop(); await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it.each([[0, 0], [100, 0], [0, 1000]])("retains fixed-amount funding gates when the random range is %s/%s", async (minMoney, maxMoney) => {
    Object.assign(mocks.user.config, { betting: true, betMoney: 1000, minMoney, maxMoney });
    mocks.account.getProviders = (minimum: number) => minimum <= 500 ? new Map([["OB", []], ["RAY", []]]) : new Map();
    await store.startMainLoop(); await flush();
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.user.config.betMoney).toBe(1000);
  });
  it("does not execute or roll a random amount while buying is closed", async () => {
    Object.assign(mocks.user.config, { betMoney: 1000, minMoney: 100, maxMoney: 1000 });
    await store.startMainLoop(); await flush();
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.user.config.betMoney).toBe(1000);
  });
  it("does not immediately requeue itself when the original executor changes the random amount", async () => {
    Object.assign(mocks.user.config, { betting: true, minMoney: 100, maxMoney: 200 });
    mocks.execute.mockImplementation(async ({ config }) => {
      // Bound the mock even on a regression so a feedback loop fails without hanging the test.
      if (mocks.execute.mock.calls.length <= 4) config.betMoney = config.betMoney === 100 ? 200 : 100;
    });
    await store.startMainLoop(); await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100); await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(4);
  });
  it.each(["off", "liveRound"] as const)("installs a start-time wakeup when switching from %s while the full market stays allowed", async mode => {
    setPrematchFullMode(mode);
    const matches = list(); matches[0]!.StartTime = (Date.now() + 1000) / 1000;
    mocks.post.mockResolvedValueOnce({ success: 1, info: matches });
    await store.startMainLoop(); await flush();
    setPrematchFullMode("startAt"); await flush(); expect(liveState.opportunities).toBe(1);
    await vi.advanceTimersByTimeAsync(1001); await flush();
    expect(liveState.opportunities).toBe(0); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("reschedules a start-time wakeup when the listed start time changes", async () => {
    setPrematchFullMode("startAt");
    const matches = list(); matches[0]!.StartTime = (Date.now() + 1000) / 1000;
    mocks.post.mockResolvedValueOnce({ success: 1, info: matches });
    await store.startMainLoop(); await flush();
    store.matchs[0]!.startAt = Date.now() + 2000; await flush();
    await vi.advanceTimersByTimeAsync(1001); expect(liveState.opportunities).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); expect(liveState.opportunities).toBe(0);
  });
  it("clears the start-time wakeup when the filter is turned off", async () => {
    setPrematchFullMode("startAt");
    const matches = list(); matches[0]!.StartTime = (Date.now() + 1000) / 1000;
    mocks.post.mockResolvedValueOnce({ success: 1, info: matches });
    await store.startMainLoop(); await flush(); expect(liveState.opportunities).toBe(1);
    setPrematchFullMode("off"); await flush(); expect(liveState.opportunities).toBe(2);
    await vi.advanceTimersByTimeAsync(1001); expect(liveState.opportunities).toBe(2);
  });
  it("does not inspect an unrelated market on quote changes or identical snapshots", async () => {
    await store.startMainLoop(); await flush(); const before = liveState.checks;
    quotes.set("OB:h101", { odds: 2.2, locked: false, time: Date.now() + 1 }); await flush(); expect(liveState.checks).toBe(before);
    quotes.set("OB:h101", { odds: 2.3, locked: false, time: Date.now() + 2 }); await flush(); expect(liveState.checks).toBe(before + 1);
    quotes.set("OB:unrelated", { odds: 4, locked: false, time: Date.now() }); await flush(); expect(liveState.checks).toBe(before + 1);
  });
  it("closing buy preserves the original in-flight round and prevents later rounds", async () => {
    let release!: () => void; mocks.execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    mocks.user.config.betting = true; await store.startMainLoop(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(1);
    mocks.user.config.betting = false; release(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2); expect(mocks.user.config.betting).toBe(false);
    await vi.advanceTimersByTimeAsync(200); expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("serializes markets and keeps a busy market's updates coalesced", async () => {
    let release!: () => void; mocks.execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    mocks.user.config.betting = true; await store.startMainLoop(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 10; n++) quotes.set("OB:h101", { odds: 2.21 + n / 100, locked: false, time: Date.now() });
    await flush(); expect(mocks.execute).toHaveBeenCalledTimes(1); release(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it("rechecks a queued market against current locked quotes", async () => {
    const plans: number[] = [];
    let release!: () => void;
    mocks.execute.mockImplementation(async ({ match, bet, config }) => {
      // Model the reused preparation's current-quote selection, without submitting orders.
      if (!pickArbLegs(bet, config, ["OB", "RAY"], mocks.account.accounts, match.game)) return;
      plans.push(bet.id);
      if (bet.id === 101) await new Promise<void>(resolve => { release = resolve; });
    });
    mocks.user.config.betting = true; await store.startMainLoop(); await flush();
    quotes.get("OB:h102")!.locked = true; quotes.get("RAY:h102")!.locked = true; release(); await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(2); expect(plans).toEqual([101]);
  });
  it("matches the original empty-list handling of a non-success business response", async () => {
    await store.startMainLoop(); await flush();
    mocks.post.mockResolvedValueOnce({ success: 0, msg: "offline" }); expect(await store.fetchMatches(true)).toBe(true);
    mocks.user.config.betting = true; quotes.get("OB:h101")!.odds = 2.3; await flush(); expect(mocks.execute).not.toHaveBeenCalled(); expect(liveState.markets).toBe(0);
    expect(await store.fetchMatches(true)).toBe(true); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("waits for an in-flight execution before stop resolves", async () => {
    let release!: () => void; mocks.execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    mocks.user.config.betting = true; await store.startMainLoop(); await flush(); let drained = false;
    const stopping = drainListenerRuntime().then(() => { drained = true; }); await flush(); expect(drained).toBe(false);
    release(); await stopping; expect(drained).toBe(true); expect(mocks.execute).toHaveBeenCalledTimes(2); expect(store.mainLoopRunning).toBe(false);
  });
  it("a stop during an initial list request leaves no late listener work", async () => {
    let release!: (value: unknown) => void; mocks.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const starting = store.startMainLoop(); await flush(); await drainListenerRuntime(); release({ success: 1, info: list() }); await starting; await flush();
    expect(liveState.markets).toBe(0); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("runs original scheduled rounds without rescanning every market", async () => {
    await store.startMainLoop(); await flush(); const checks = liveState.checks;
    await vi.advanceTimersByTimeAsync(500); await flush(); expect(mocks.maintenance).toHaveBeenCalled(); expect(liveState.checks).toBe(checks);
  });
  it("rechecks a persistent opportunity after the previous attempt settles", async () => {
    mocks.user.config.betting = true; await store.startMainLoop(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(4);
  });
  it("waits for the original initial default-odds barrier before executing", async () => {
    let release!: () => void;
    store.defaultOddsFetchedAt = 0; mocks.user.config.betting = true;
    store.fetchMatchDefaultOdds = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const starting = store.startMainLoop(); await flush();
    expect(store.matchs).toHaveLength(1); expect(mocks.execute).not.toHaveBeenCalled();
    store.defaultOddsFetchedAt = Date.now(); release(); await starting; await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("also waits for default odds during a manual list refresh", async () => {
    await store.startMainLoop(); await flush();
    let release!: () => void; store.defaultOddsFetchedAt = 0;
    store.fetchMatchDefaultOdds = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const refreshing = store.fetchMatches(true); await flush();
    mocks.user.config.betting = true; await flush(); expect(mocks.execute).not.toHaveBeenCalled();
    store.defaultOddsFetchedAt = Date.now(); release(); await refreshing; await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("preserves distinct original manual refresh requests while tracking both readiness barriers", async () => {
    await store.startMainLoop(); await flush();
    let releaseFirst!: (value: unknown) => void; let releaseSecond!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSecond = resolve; }));
    const first = store.fetchMatches(true); const second = store.fetchMatches(true);
    expect(mocks.post).toHaveBeenCalledTimes(3);
    mocks.user.config.betting = true; await flush(); expect(mocks.execute).not.toHaveBeenCalled();
    releaseFirst({ success: 1, info: list() }); await first; await flush(); expect(mocks.execute).not.toHaveBeenCalled();
    releaseSecond({ success: 1, info: list() }); await second; await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("uses original pending-bind, arbitrage, then makeup ordering", async () => {
    const order: string[] = []; mocks.pending = true; mocks.user.config.betting = true; mocks.user.config.makeUp = true;
    mocks.lose.orders.set(101, {});
    mocks.bind.mockImplementation(async () => { order.push("bind"); mocks.pending = false; });
    mocks.execute.mockImplementation(async ({ bet }) => { order.push(`arb:${bet.id}`); });
    store.processLoseOrders = vi.fn(async () => { order.push("makeup"); });
    await store.startMainLoop(); await flush();
    expect(order).toEqual(["bind", "arb:101", "arb:102", "makeup"]);
  });
  it("continues pending-bind and makeup work for an empty successful list", async () => {
    mocks.pending = true; mocks.user.config.makeUp = true; mocks.lose.orders.set(101, {});
    mocks.post.mockResolvedValueOnce({ success: 0, info: null });
    await store.startMainLoop(); await flush();
    expect(store.matchs).toEqual([]); expect(mocks.bind).toHaveBeenCalledOnce();
    expect(store.processLoseOrders).toHaveBeenCalledOnce(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("retries a due network failure at the original next 100ms round", async () => {
    await store.startMainLoop(); await flush(); store.lastFetchAt = Date.now() - 30_000;
    mocks.post.mockRejectedValueOnce(new Error("offline"));
    await store.runMainLoopTick(); await flush(); expect(mocks.post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(99); expect(mocks.post).toHaveBeenCalledTimes(2);
    // The original host waits 100ms, then schedules its next zero-delay timer turn.
    await vi.advanceTimersByTimeAsync(2); await flush(); expect(mocks.post).toHaveBeenCalledTimes(3);
  });
  it("retries an initial network failure on the first original round", async () => {
    mocks.post.mockRejectedValueOnce(new Error("offline"));
    await store.startMainLoop(); await flush(); expect(mocks.post).toHaveBeenCalledTimes(2); expect(store.matchs).toHaveLength(1);
  });
  it("does not poll in parallel with an in-flight arbitrage attempt", async () => {
    let release!: () => void; mocks.user.config.betting = true;
    mocks.execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await store.startMainLoop(); await flush();
    await vi.advanceTimersByTimeAsync(30_001); await flush(); expect(mocks.post).toHaveBeenCalledOnce();
    release(); await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(101); await flush(); expect(mocks.post).toHaveBeenCalledTimes(2);
  });
  it("processes a notification batch in original list order", async () => {
    await store.startMainLoop(); await flush(); mocks.user.config.betting = true; await flush(); mocks.execute.mockClear();
    quotes.get("OB:h102")!.odds = 2.3; quotes.get("OB:h101")!.odds = 2.3; await flush();
    expect(mocks.execute.mock.calls.map(([{ bet }]) => bet.id)).toEqual([101, 102]);
  });
  it("leaves slow extension strategies asynchronous as in the original loop", async () => {
    mocks.user.extensionPrefs.arbEarlyLockSell = { enabled: true };
    mocks.user.extensionPrefs.valueBet = { autoBet: { enabled: true } };
    let release!: () => void; mocks.early.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await store.startMainLoop(); await flush(); expect(mocks.early).toHaveBeenCalledOnce(); expect(mocks.ev).toHaveBeenCalledOnce();
    mocks.user.config.betting = true; await flush(); expect(mocks.execute).toHaveBeenCalledTimes(2); expect(mocks.ev).toHaveBeenCalledOnce(); release();
  });
  it("does not accelerate EV or early-sell maintenance on quote notifications", async () => {
    mocks.user.config.betting = true;
    mocks.user.extensionPrefs.arbEarlyLockSell = { enabled: true };
    mocks.user.extensionPrefs.valueBet = { autoBet: { enabled: true } };
    await store.startMainLoop(); await flush(); expect(mocks.ev).toHaveBeenCalledOnce(); expect(mocks.early).toHaveBeenCalledOnce();
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(20); quotes.get("OB:h101")!.odds += 0.01; await flush();
    }
    expect(mocks.execute).toHaveBeenCalledTimes(5); expect(mocks.ev).toHaveBeenCalledOnce(); expect(mocks.early).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(41); await flush(); expect(mocks.ev).toHaveBeenCalledTimes(2); expect(mocks.early).toHaveBeenCalledTimes(2);
  });
  it("isolates extension failures without skipping EV or default-odds work", async () => {
    mocks.user.extensionPrefs.arbEarlyLockSell = { enabled: true };
    mocks.user.extensionPrefs.valueBet = { autoBet: { enabled: true } };
    mocks.early.mockRejectedValue(new Error("strategy failed"));
    await store.startMainLoop(); await flush(); const calls = vi.mocked(store.fetchMatchDefaultOdds).mock.calls.length;
    store.defaultOddsFetchedAt = 0; await store.runMainLoopTick(); await flush();
    expect(mocks.ev).toHaveBeenCalledTimes(2); expect(store.fetchMatchDefaultOdds).toHaveBeenCalledTimes(calls + 1);
  });
});
