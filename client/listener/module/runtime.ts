import { computed, watch, type WatchStopHandle } from "vue";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { UserConfig } from "@/types/userConfig";
import { pickArbLegs, type ArbLegs } from "@changmen/arb-core/arbitrage/pickArbLegs";
import { getAuthSessionVersion, isAuthSessionCurrent, isWebAuthenticated } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { accountsFundingReady } from "@/stores/account/accountPicker";
import { filterArbProviderKeys } from "@/types/extensionPrefs";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { getPrematchFullMode, isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import { executeArbBet } from "@/orderModes/router";
import { runArbBetRound } from "@/stores/betting/runArbBetRound";
import { MAIN_LOOP_DELAY_MS, MATCH_POLL_MS, runMainBetLoopFinally } from "../../web/src/stores/match/mainBetLoop";
import { MarketSubscriptions } from "./subscriptions";
import { registerListenerHost } from "./rounds";
import { liveState } from "./state";
import { SerialRounds } from "./serialRounds";
import type { useMatchStore as OriginalUseMatchStore } from "../../web/src/stores/matchStore";

type MatchStore = ReturnType<typeof OriginalUseMatchStore>;
interface Market { match: ViewMatch; bet: ViewBet }
const keyOf = ({ match, bet }: Market) => `${match.id}:${bet.id}`;
const randomAmountEnabled = (config: UserConfig): boolean => config.minMoney !== 0 && config.maxMoney !== 0;
const runtimes = new Set<ListenerRuntime>();
const installed = new WeakMap<MatchStore, ListenerRuntime>();

/** Decorate the original actions, retaining their bodies, timers and state transitions. */
export function installListenerStore(store: MatchStore): void {
  if (installed.has(store)) return;
  const runtime = new ListenerRuntime(store);
  installed.set(store, runtime); runtimes.add(runtime);
  store.startMainLoop = () => runtime.start();
  store.stopMainLoop = () => { void runtime.stop(); };
  store.fetchMatches = force => runtime.fetchMatches(force);
}
export async function drainListenerRuntime(): Promise<void> {
  await Promise.all([...runtimes].map(runtime => runtime.stop()));
}

class ListenerRuntime {
  private active = false;
  private epoch = 0;
  private version = "";
  private userId = 0;
  private rounds = new SerialRounds();
  private arbQueued = false;
  private maintenanceStarted = false;
  private subscriptions?: MarketSubscriptions<Market, ArbLegs | undefined>;
  private stops: WatchStopHandle[] = [];
  private retries = new Map<string, ReturnType<typeof setTimeout>>();
  private dirty = new Set<string>();
  private ranks = new Map<string, number>();
  private opportunities = new Set<string>();
  private fetches = new Set<Promise<boolean>>();
  private unregister?: () => void;
  private readonly originalStart: MatchStore["startMainLoop"];
  private readonly originalStop: MatchStore["stopMainLoop"];
  private readonly originalFetch: MatchStore["fetchMatches"];

  constructor(private readonly store: MatchStore) {
    this.originalStart = store.startMainLoop.bind(store);
    this.originalStop = store.stopMainLoop.bind(store);
    this.originalFetch = store.fetchMatches.bind(store);
  }
  private current(): boolean {
    const user = useUserStore();
    return this.active && this.store.mainLoopRunning && user.userId === this.userId && user.isLoggedIn
      && isWebAuthenticated() && isAuthSessionCurrent(this.version);
  }
  private allowed({ match, bet }: Market): boolean {
    return isPrematchFullMarketAllowed(match, bet) && !isMapMuteActive(match.id, bet.round, match.liveRound);
  }
  async start(): Promise<void> {
    // The original start calls this.stopMainLoop synchronously before its first await.
    // Capture that resulting epoch so an external stop while fetching still cancels listener installation.
    const starting = this.originalStart();
    const epoch = this.epoch;
    await starting;
    if (epoch !== this.epoch || !this.store.mainLoopRunning) return;
    const user = useUserStore();
    if (!user.isLoggedIn || !user.userId) return;
    this.version = getAuthSessionVersion(); this.userId = user.userId; this.active = true;
    const accounts = useAccountStore();
    const context = computed(() => {
      const config = user.config;
      const randomAmount = randomAmountEnabled(config);
      const providers = filterArbProviderKeys([...accounts.getProviders(randomAmount || config.betMoneyMode === "total" ? 0 : config.betMoney).keys()], user.extensionPrefs.arbAllowedPlatforms);
      return { config, providers, signature: JSON.stringify([
        { ...config, betMoney: randomAmount ? undefined : config.betMoney }, providers, user.extensionPrefs,
        accounts.loaded, accounts.accounts.map(account => [account.accountId, account.provider, account.profit, account.balance,
          account.loadingBalance, account.pause, account.todayOrder, account.maxOrder, account.totalProfit, account.maxProfit]),
      ]) };
    });
    this.unregister = registerListenerHost({ serialize: run => this.serialize(async () => {
      this.maintenanceStarted = true;
      await run();
    }), scan: setMessage => this.executeDirty(setMessage) });
    this.subscriptions = new MarketSubscriptions({
      key: keyOf,
      signature: market => JSON.stringify([context.value.signature, getPrematchFullMode(), this.allowed(market), market.match.liveRound,
        market.match.liveRoundStart, market.match.startAt, market.bet.items.map(item => [item.type, item.homeId, item.awayId, item.getOdds("Home"), item.getOdds("Away")])]),
      detect: market => {
        liveState.checks += 1;
        for (const item of market.bet.items) item.updateOdds();
        if (!this.current() || !this.allowed(market)) return undefined;
        return pickArbLegs(market.bet, context.value.config, context.value.providers, accounts.accounts, market.match.game);
      },
      result: (key, result) => {
        if (result) this.opportunities.add(key); else this.opportunities.delete(key);
        liveState.opportunities = this.opportunities.size;
        if (result || randomAmountEnabled(user.config)) this.dirty.add(key); else this.dirty.delete(key);
        if (this.dirty.size && user.config.betting && accountsFundingReady(accounts)) this.requestArbitrage();
      },
      size: size => { liveState.markets = size; },
      wakeAt: market => getPrematchFullMode() === "startAt" && market.match.startAt > Date.now() ? market.match.startAt : undefined,
    });
    this.stops.push(watch(() => this.store.matchs, () => this.replaceMarkets(), { flush: "sync" }));
    this.stops.push(watch(() => [user.userId, user.isLoggedIn, isWebAuthenticated()], () => { if (!this.current()) void this.stop(); }, { flush: "sync" }));
    this.replaceMarkets();
  }
  private serialize(run: () => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    return this.rounds.run(async () => {
      while (this.fetches.size) await Promise.all([...this.fetches]);
      if (epoch !== this.epoch || !this.current()) return;
      await run();
    });
  }
  private requestArbitrage(): void {
    if (!this.current() || !this.maintenanceStarted || this.arbQueued) return;
    this.arbQueued = true;
    const epoch = this.epoch;
    void this.serialize(async () => {
      this.arbQueued = false;
      // The original timer owns polling and failed-fetch recovery. Never trade ahead of a due list refresh.
      if (!this.dirty.size || Date.now() - this.store.lastFetchAt >= MATCH_POLL_MS) return;
      try {
        await runArbBetRound({ setMessage: message => this.store.setBettingMessage(message), processLoseOrders: () => this.store.processLoseOrders() });
      }
      finally {
        // Invoke the shared cleanup; its cooldown is outside the serialized body, as in the original host.
        if (this.current()) void runMainBetLoopFinally().catch(error => console.error("[listener] cleanup failed", error));
      }
    }).catch(error => console.error("[listener] notification failed", error)).finally(() => {
      if (epoch !== this.epoch) return;
      // Cancelled work may never have entered its body.
      if (!this.current()) this.arbQueued = false;
    });
  }
  fetchMatches(force = false): Promise<boolean> {
    const task = this.originalFetch(force);
    this.fetches.add(task);
    void task.finally(() => { this.fetches.delete(task); }).catch(() => {});
    return task;
  }
  private replaceMarkets(): void {
    this.opportunities.clear(); liveState.opportunities = 0;
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear(); this.dirty.clear(); this.ranks.clear();
    const markets = this.store.matchs.flatMap(match => match.bets.map(bet => ({ match, bet })));
    markets.forEach((market, rank) => this.ranks.set(keyOf(market), rank));
    this.subscriptions?.replace(markets);
  }
  private async executeDirty(setMessage: (message: string) => void): Promise<void> {
    const keys = [...this.dirty].sort((a, b) => (this.ranks.get(a) ?? Infinity) - (this.ranks.get(b) ?? Infinity));
    const config = useUserStore().config;
    const markets = keys.map(key => this.subscriptions?.get(key)).filter((market): market is Market => Boolean(market));
    for (const market of markets) {
      const key = keyOf(market);
      this.dirty.delete(key);
      try { await executeArbBet({ ...market, config, setMessage }); }
      finally { if (this.current()) this.retry(key); }
    }
  }
  private retry(key: string): void {
    if (this.retries.has(key)) return;
    this.retries.set(key, setTimeout(() => {
      this.retries.delete(key); this.subscriptions?.invalidate(key);
    }, MAIN_LOOP_DELAY_MS));
  }
  stop(): Promise<void> {
    this.active = false; this.epoch += 1; this.arbQueued = false; this.maintenanceStarted = false;
    this.originalStop();
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    for (const stop of this.stops.splice(0)) stop();
    this.subscriptions?.stop(); this.subscriptions = undefined;
    this.unregister?.(); this.unregister = undefined;
    this.opportunities.clear(); this.dirty.clear(); liveState.opportunities = 0;
    return this.rounds.cancel();
  }
}
