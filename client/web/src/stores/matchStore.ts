import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { MainBetLoopState } from "@/stores/match/mainBetLoop";
import type { PlatformId, PmSportSnapshot } from "@/types/esport";
import { defineStore } from "pinia";
import { getMatchs } from "@/api/esport";
import { getMatchDefaultOdds } from "@/api/report";
import { ensureTokenRefresh } from "@/lib/sessionRefresh";
import { toViewMatches } from "@/models/match";
import {
  startPmSportRealtimeFeed,
  stopPmSportRealtimeFeed,
} from "@/services/pmSportRealtime";
import { processLoseOrders as runProcessLoseOrders } from "@/stores/betting/loseOrder";
import { runManualBet } from "@/stores/betting/manualBet";
import { runValueBetConfirm } from "@/stores/betting/valueBetConfirm";
import {

  runMainBetLoopFinally,
  runMainBetLoopTick,
} from "@/stores/match/mainBetLoop";
import { publishBetTargetPayload } from "@/realtime/betTargetPublish";
import { useUserStore } from "@/stores/userStore";

const POLL_MS = 30_000;
const DEFAULT_ODDS_MS = 10 * 60 * 1000;
const BET_TARGET_KEY = "BetTarget";

/** 对齐 A8 Pinia `zg`：只消费 Client_GetMatchs，不在前端做赛事合并 */
export const useMatchStore = defineStore("match", {
  state: () => ({
    matchs: [] as ViewMatch[],
    loading: false,
    error: null as string | null,
    lastFetchAt: 0,
    /** platform → betRowId → Home|Away */
    betTargets: new Map<PlatformId, Map<number, BetSide>>(),
    /** [changmen 扩展] 远程 BetTarget 推送后强制刷新（低频） */
    tick: 0,
    /** [changmen 扩展] pm_sport WS 推送后 MatchCard 刷新 */
    pmSportTick: 0,
    /** key `${betId}:Home|Away`（对齐 A8 `defaultOdds`） */
    defaultOdds: new Map<string, number>(),
    defaultOddsFetchedAt: 0,
    /** [A8 可证实] 单主循环 `P()` 是否在跑 */
    mainLoopRunning: false,
    mainLoopTimer: null as ReturnType<typeof setTimeout> | null,
    lastLoseOrderPruneAt: Date.now(),
    /** 对齐 A8 `O()` 内下注状态（原 bettingStore） */
    bettingLastMessage: "",
    bettingLastAt: 0,
    /** "platform:sourceMatchId" → matchs 数组下标；fetchMatches 后重建 */
    _providerIndex: new Map<string, number>(),
  }),

  getters: {
    matchCount: s => s.matchs.length,
  },

  actions: {
    async initBetTarget() {
      this.betTargets = await this.loadBetTarget();
    },

    loadBetTarget(): Map<PlatformId, Map<number, BetSide>> {
      return this.parseBetTargetPayload(this.readBetTargetSession());
    },

    /** 对齐 A8 `Vg.loadBetTarget(r)`：BetTarget 频道 pub/sub 推送 */
    applyRemoteBetTarget(raw: Record<string, Record<string, BetSide>>) {
      this.betTargets = this.parseBetTargetPayload(raw);
      this.persistBetTarget();
      this.tick += 1;
    },

    readBetTargetSession(): Record<string, Record<string, BetSide>> {
      try {
        const raw = sessionStorage.getItem(BET_TARGET_KEY);
        if (!raw)
          return {};
        return JSON.parse(raw) as Record<string, Record<string, BetSide>>;
      }
      catch {
        return {};
      }
    },

    parseBetTargetPayload(
      parsed: Record<string, Record<string, BetSide>>,
    ): Map<PlatformId, Map<number, BetSide>> {
      const empty = new Map<PlatformId, Map<number, BetSide>>();
      for (const [platform, bets] of Object.entries(parsed)) {
        const map = new Map<number, BetSide>();
        for (const [betId, side] of Object.entries(bets ?? {})) {
          map.set(Number(betId), side);
        }
        empty.set(platform as PlatformId, map);
      }
      return empty;
    },

    toBetTargetPayload(): Record<string, Record<string, BetSide>> {
      const out: Record<string, Record<string, BetSide>> = {};
      this.betTargets.forEach((bets, platform) => {
        const row: Record<string, BetSide> = {};
        bets.forEach((side, betId) => {
          row[String(betId)] = side;
        });
        out[platform] = row;
      });
      return out;
    },

    persistBetTarget() {
      sessionStorage.setItem(BET_TARGET_KEY, JSON.stringify(this.toBetTargetPayload()));
    },

    /** [A8 可证实] `Ut.saveBetTarget`：pub/sub 广播 + finally sessionStorage */
    async saveBetTarget(): Promise<boolean> {
      const user = useUserStore();
      if (!user.betTargetEnabled())
        return false;

      const payload = this.toBetTargetPayload();
      try {
        return await publishBetTargetPayload(payload);
      }
      finally {
        sessionStorage.setItem(BET_TARGET_KEY, JSON.stringify(payload));
      }
    },

    getBetTarget(platform: PlatformId, betRowId: number): BetSide | undefined {
      return this.betTargets.get(platform)?.get(betRowId);
    },

    async setBetTarget(platform: PlatformId, betRowId: number, side: BetSide): Promise<boolean> {
      const user = useUserStore();
      if (!user.betTargetEnabled())
        return false;
      if (!this.betTargets || !(this.betTargets instanceof Map)) {
        this.betTargets = new Map();
      }
      if (!this.betTargets.has(platform))
        this.betTargets.set(platform, new Map());
      const bucket = this.betTargets.get(platform)!;
      if (bucket.get(betRowId) === side)
        bucket.delete(betRowId);
      else bucket.set(betRowId, side);
      return await this.saveBetTarget();
    },

    refreshOddsOnBets() {
      const now = Date.now();
      for (const match of this.matchs) {
        const lr = match.liveRound;
        const rs = match.liveRoundStart;
        const isLiveMatch = lr !== 0;
        for (const bet of match.bets) {
          if (isLiveMatch && lr === bet.round) {
            bet.isLive = true;
            bet.startTime
              = rs > 0 ? rs : bet.startTime && bet.startTime > 0 ? bet.startTime : now;
          }
          else if (bet.isLive !== undefined) {
            bet.isLive = undefined;
            bet.startTime = undefined;
          }
          for (const item of bet.items) {
            item.updateOdds();
          }
        }
      }
    },

    /** changmen WS 推送的 pm_sport（已 Title 对齐，直接展示） */
    updatePmSport(clientMatchId: number, pmSport: PmSportSnapshot) {
      const id = Number(clientMatchId);
      if (!Number.isFinite(id))
        return;
      const match = this.matchs.find(m => m.id === id);
      if (!match)
        return;
      match.pmSport = pmSport;
      this.pmSportTick += 1;
    },

    getDefaultOdds(betId: number, side: BetSide): number {
      return this.defaultOdds.get(`${betId}:${side}`) ?? 0;
    },

    async fetchMatchDefaultOdds() {
      const user = useUserStore();
      if (!user.isLoggedIn)
        return;
      const ids = this.matchs.map(m => m.id);
      try {
        const info = await getMatchDefaultOdds(ids);
        if (info && Object.keys(info).length) {
          const next = new Map<string, number>();
          for (const [key, value] of Object.entries(info)) {
            next.set(key, Number(value) || 0);
          }
          this.defaultOdds = next;
        }
        // [A8 可证实] 门控到期即 `b=Date.now()`，空列表也推进计时
        this.defaultOddsFetchedAt = Date.now();
      }
      catch {
        /* 后端未实现时保持空 Map */
      }
    },

    /** @returns 是否成功拉取并写入 matchs（A8 `GetMatchs` Truthy）；失败/跳过为 false */
    async fetchMatches(force = false): Promise<boolean> {
      const user = useUserStore();
      if (!user.isLoggedIn)
        return false;
      const now = Date.now();
      if (!force && now - this.lastFetchAt < POLL_MS)
        return false;

      this.loading = true;
      this.error = null;
      try {
        const list = await getMatchs(user.userName);
        this.matchs = toViewMatches(list);
        this._rebuildProviderIndex();
        this.lastFetchAt = Date.now();
        this.refreshOddsOnBets();
        if (Date.now() - this.defaultOddsFetchedAt > DEFAULT_ODDS_MS) {
          await this.fetchMatchDefaultOdds();
        }
        return true;
      }
      catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        return false;
      }
      finally {
        this.loading = false;
      }
    },

    /** [A8 可证实] 单主循环：拉列表门控 + 每轮 updateOdds + 自动下单 + wait(100) */
    async startMainLoop() {
      this.stopMainLoop();

      this.mainLoopRunning = true;
      await this.fetchMatches(true);
      void this.fetchMatchDefaultOdds();

      if (useUserStore().isLoggedIn) {
        void ensureTokenRefresh();
        void startPmSportRealtimeFeed((id, snap) => {
          this.updatePmSport(id, snap);
        });
      }

      this.scheduleMainLoop(0);
    },

    stopMainLoop() {
      this.mainLoopRunning = false;
      stopPmSportRealtimeFeed();
      if (this.mainLoopTimer) {
        clearTimeout(this.mainLoopTimer);
        this.mainLoopTimer = null;
      }
    },

    scheduleMainLoop(delayMs: number) {
      if (!this.mainLoopRunning)
        return;
      if (this.mainLoopTimer)
        clearTimeout(this.mainLoopTimer);
      this.mainLoopTimer = setTimeout(() => {
        void this.runMainLoopTick();
      }, delayMs);
    },

    async runMainLoopTick() {
      const state: MainBetLoopState = { lastLoseOrderPruneAt: this.lastLoseOrderPruneAt };
      try {
        await runMainBetLoopTick(state);
        this.lastLoseOrderPruneAt = state.lastLoseOrderPruneAt;
      }
      /* eslint-disable no-unsafe-finally */
      finally {
        if (!this.mainLoopRunning)
          return; // intentional: skip cleanup when loop is stopped
        await runMainBetLoopFinally();
        this.scheduleMainLoop(0);
      }
      /* eslint-enable no-unsafe-finally */
    },

    _rebuildProviderIndex() {
      const idx = new Map<string, number>();
      for (let i = 0; i < this.matchs.length; i++) {
        for (const [platform, sourceId] of Object.entries(this.matchs[i].providers)) {
          idx.set(`${platform}:${sourceId}`, i);
        }
      }
      this._providerIndex = idx;
    },

    setBettingMessage(msg: string) {
      this.bettingLastMessage = msg;
      this.bettingLastAt = Date.now();
    },

    tickBettingAutoOpen() {
      const user = useUserStore();
      const cfg = user.config;
      if (cfg.bettingAutoOpen && !cfg.betting && cfg.bettingAutoOpenTime) {
        if (Date.now() >= cfg.bettingAutoOpenTime) {
          cfg.betting = true;
          cfg.bettingAutoOpen = false;
          cfg.bettingAutoOpenTime = 0;
          void user.saveConfig();
        }
      }
    },

    async manualBet(
      match: ViewMatch,
      bet: ViewBet,
      item: ViewBetItem,
      side: BetSide,
      oddsOverride?: number,
    ) {
      await runManualBet(match, bet, item, side, {
        setMessage: m => this.setBettingMessage(m),
      }, oddsOverride);
    },

    /** [changmen 扩展] 点击金色 EV 角标 → 正 EV 确认下单 */
    async valueBetConfirm(match: ViewMatch, bet: ViewBet, item: ViewBetItem, side: BetSide) {
      await runValueBetConfirm(match, bet, item, side, {
        setMessage: m => this.setBettingMessage(m),
      });
    },

    async processLoseOrders() {
      await runProcessLoseOrders({
        setMessage: m => this.setBettingMessage(m),
      });
    },
  },
});
