import { cleanVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { getGames } from "@changmen/client-core/bridge/clientApi";
import { getStaticVenueGames } from "@changmen/client-core/shared/venueGames";
import { PB_PLUGIN_REQUIRED_MSG, pbCollectEuroOdds, resolvePbAccount } from "./transport";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { PLATFORMS } from "../shared/platforms";
import { parseEuroOddsPayload, stampEuroOddsQueryIsLive } from "./parse";
import { isPbAllowedSourceGameId } from "./gameFilter";
import { ingestAndReportPbParsedMatch } from "./markets";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useMatchStore } from "../shared/webBridge";
import { startPbWsStatusPoll } from "./wsStatusPoll";
import {
  isPbChangmenExtensions,
  isPbLiveFoOnly,
  isPbPrematchCollectEnabled,
} from "./extensionsMode";
const PLATFORM = PLATFORMS.PB;
const POLL_MS = 5_000;
const SAVE_MS = 60_000;

/**
 * 默认对齐 A8 `YY` / `mHe`：只拉 isLive=true、每 5s 写 fo、60s SaveMatch/SaveBet。
 * [changmen 扩展] `pbChangmenExtensions` 开：另采 prematch、两侧写 fo、RotNum、WS 影子观测。
 * 切换开关须重启本 collector（userStore.setPbChangmenExtensions → restartCollector("PB")）。
 */

type SnapshotEntry = { match: CollectMatchDto; bets: CollectBetDto[] };

/** Client_GetGames 失败/空时回退静态表，避免整轮过滤成 0 场 */
async function resolvePbPlatformGames(): Promise<string[]> {
  try {
    const games = await getGames(PLATFORM);
    if (games.length) return games;
  } catch (err) {
    console.warn("[PB] getGames failed, fallback to static venue games", err);
  }
  return getStaticVenueGames(PLATFORM);
}

export function startPbCollector(): () => void {
  let stopped = false;
  let lastSaveAt = 0;
  let saving = false;
  let pluginMissingNotified = false;
  /** 任一循环正在拉数时置位，供 maybeSave 避免首包/半包竞态；单循环内串行，主要用于跨循环互斥。 */
  let liveInFlight = false;
  let prematchInFlight = false;
  let liveSyncedOnce = false;
  let prematchSyncedOnce = false;
  const startedAt = Date.now();
  /** 单侧迟迟不成功时，超时后允许用已有缓存上报，避免永久不 Save。 */
  const SAVE_WARMUP_MS = 15_000;
  const liveById = new Map<string, SnapshotEntry>();
  const prematchById = new Map<string, SnapshotEntry>();
  const collect = useCollectStore();
  const matchStore = useMatchStore();

  type GateOk = { account: PlatformAccount; games: string[] };

  async function resolveGate(): Promise<"skip" | "no-account" | GateOk> {
    // [changmen 扩展] 暂停 PB Client_GetCollectPlatform；采集凭证来自本机账号，仅保留游戏配置请求。
    const games = await resolvePbPlatformGames();
    const account = resolvePbAccount();
    if (!account) {
      console.log(PLATFORM, "当前未检测到账号");
      cleanVenueOdds(PLATFORM);
      return "no-account";
    }

    if (!hasA8PluginRuntime()) {
      if (!pluginMissingNotified) {
        notifyCollectError("PB", PB_PLUGIN_REQUIRED_MSG);
        pluginMissingNotified = true;
      }
      return "skip";
    }
    pluginMissingNotified = false;
    return { account, games };
  }

  function canSaveMergedSnapshot(): boolean {
    if (liveInFlight || prematchInFlight) return false;
    // A8 默认只采 live：不等 prematchSyncedOnce / 15s warmup
    if (!isPbPrematchCollectEnabled()) return liveSyncedOnce;
    if (liveSyncedOnce && prematchSyncedOnce) return true;
    return Date.now() - startedAt >= SAVE_WARMUP_MS;
  }

  async function maybeSaveMerged(): Promise<void> {
    if (saving) return;
    if (!canSaveMergedSnapshot()) return;
    if (Date.now() - lastSaveAt <= SAVE_MS) return;
    if (!liveById.size && !prematchById.size) return;

    saving = true;
    try {
      const merged = new Map<string, SnapshotEntry>();
      if (isPbPrematchCollectEnabled()) {
        for (const [id, entry] of prematchById) merged.set(id, entry);
      }
      for (const [id, entry] of liveById) merged.set(id, entry);

      const matchPayload = [...merged.values()].map((e) => e.match);
      const saved = await collect.saveMatch(PLATFORM, matchPayload);
      if (saved) {
        await Promise.all(
          [...merged.entries()]
            .filter(([, e]) => e.bets.length)
            .map(([matchId, e]) => collect.saveBets(PLATFORM, matchId, e.bets)),
        );
        lastSaveAt = Date.now();
      }
    } finally {
      saving = false;
    }
  }

  async function runOddsCycle(isLive: boolean): Promise<number> {
    const gate = await resolveGate();
    if (gate === "skip") return 0;
    if (gate === "no-account") return -1;

    const raw = await pbCollectEuroOdds(gate.account, isLive);
    if (raw == null) {
      console.warn(`[PB] euro/odds ${isLive ? "live" : "prematch"} empty response`);
      return 0;
    }
    const stamped = stampEuroOddsQueryIsLive(raw, isLive);
    if (!stamped) return 0;

    const { matches: parsed } = parseEuroOddsPayload(stamped);
    const matches = parsed.filter((row) =>
      isPbAllowedSourceGameId(row.gameId, gate.games),
    );
    const cache = isLive ? liveById : prematchById;
    const now = Date.now();

    // 先建 next 再同步替换，避免 await 间隙；ingest 为同步，整段对事件循环原子。
    const next = new Map<string, SnapshotEntry>();
    // A8 默认仅 live 写 fo；changmen 扩展开时两侧都写
    const writeFo = isLive || !isPbLiveFoOnly();
    for (const row of matches) {
      const { match, bets } = ingestAndReportPbParsedMatch(row, now, { writeFo });
      next.set(row.matchId, { match, bets });
    }
    cache.clear();
    for (const [id, entry] of next) cache.set(id, entry);

    if (isLive) liveSyncedOnce = true;
    else prematchSyncedOnce = true;

    if (writeFo)
      matchStore.refreshOddsOnBets();
    return matches.length;
  }

  const pollLive = async () => {
    while (!stopped) {
      const started = Date.now();
      let matchCount = 0;
      try {
        if (liveInFlight) {
          continue;
        }
        liveInFlight = true;
        try {
          const n = await runOddsCycle(true);
          if (n < 0) {
            await wait(3_000);
            continue;
          }
          matchCount = n;
        } finally {
          liveInFlight = false;
        }
        await maybeSaveMerged();
      } catch (err) {
        console.warn("[PB] collect live error", err);
        notifyCollectError("PB", err);
      } finally {
        console.debug(`[PB]live:${Date.now() - started}ms，读取比赛:${matchCount}场`);
        await wait(POLL_MS);
      }
    }
  };

  const pollPrematch = async () => {
    while (!stopped) {
      if (!isPbPrematchCollectEnabled()) {
        if (prematchById.size) prematchById.clear();
        prematchSyncedOnce = false;
        await wait(POLL_MS);
        continue;
      }
      const started = Date.now();
      let matchCount = 0;
      try {
        if (prematchInFlight) {
          continue;
        }
        prematchInFlight = true;
        try {
          const n = await runOddsCycle(false);
          if (n < 0) {
            await wait(3_000);
            continue;
          }
          matchCount = n;
        } finally {
          prematchInFlight = false;
        }
        await maybeSaveMerged();
      } catch (err) {
        console.warn("[PB] collect prematch error", err);
        notifyCollectError("PB", err);
      } finally {
        console.debug(`[PB]prematch:${Date.now() - started}ms，读取比赛:${matchCount}场`);
        await wait(POLL_MS);
      }
    }
  };

  void pollLive();
  if (isPbPrematchCollectEnabled()) {
    void pollPrematch();
  }
  // A8 无 sports-websocket 观测；仅扩展模式启停
  const stopWsStatusPoll = isPbChangmenExtensions() ? startPbWsStatusPoll() : () => {};

  return () => {
    stopped = true;
    stopWsStatusPoll();
  };
}
