import * as db from "@changmen/db";
import { setTeamPlugin } from "@changmen/match-identity";
import {
  invalidateMatcherRdsSnapshot,
} from "./rds_snapshot_cache.js";
import "../lib/env.js";

/**
 * 单次 matchMerge：由 match-composer 读 platform 快照、合场并写 client_matches。
 *
 * 数据边界：本函数产出是 Client_GetMatchs 的唯一权威来源；读路径不应再 reconcile/promote/trim。
 */

let _pluginReady = null;
/** @type {string|null} */
let _pluginMapsRevision = null;
let _matchMergeInFlight = null;

function resetTeamPluginCache() {
  _pluginReady = null;
  _pluginMapsRevision = null;
}

/** 队伍映射 / canonical 写入后调用，使下次 matchMerge 重载 team-resolver */
function invalidateTeamPlugin() {
  resetTeamPluginCache();
  // matcher 人工关联与 composer 各有一份 plugin 缓存；两边都要失效
  import("../compose/io/snapshot.js")
    .then(m => m.resetTeamPluginCache?.())
    .catch(() => { /* revision 热检仍会兜底 */ });
}

async function ensureTeamPlugin() {
  let revision = null;
  try {
    if (typeof db.fetchTeamMapsRevision === "function")
      revision = await db.fetchTeamMapsRevision();
  }
  catch (err) {
    console.warn("[matchMerge] fetchTeamMapsRevision:", err.message);
  }

  if (_pluginReady && revision != null && revision === _pluginMapsRevision)
    return _pluginReady;
  if (_pluginReady && revision == null)
    return _pluginReady;

  if (_pluginReady && revision != null && revision !== _pluginMapsRevision) {
    console.log(
      `[matchMerge] team-resolver 映射变更 ${_pluginMapsRevision} → ${revision}，重载`,
    );
  }

  _pluginMapsRevision = revision;
  _pluginReady = (async () => {
    try {
      const { loadAndCreatePlugin } = await import("@changmen/team-resolver/team_db.js");
      const plugin = await loadAndCreatePlugin();
      setTeamPlugin(plugin);
    }
    catch (err) {
      console.warn("[matchMerge] team-resolver 加载失败:", err.message);
      _pluginMapsRevision = null;
    }
  })();
  return _pluginReady;
}

/**
 * 唯一写路径：整段交给 match-composer。
 * viaMatcherWriter 仅跳过本进程 matcher HB，仍挡其它 matcher/composer 写进程。
 */
async function matchMergeOnceImpl() {
  const { composeOnce } = await import("../compose/compose_once.js");
  const result = await composeOnce({
    write: true,
    registerTeams: true,
    viaMatcherWriter: true,
  });
  const now = result.builtAt || Date.now();
  invalidateMatcherRdsSnapshot(["clientMatches"]);
  if (result.matchIdBackfill?.updated)
    invalidateMatcherRdsSnapshot(["platformMatches"]);
  if (result.endedCount > 0) {
    console.log(`[matchMerge] writer=composer 已结束移出活跃列表 ${result.endedCount} 场`);
  }
  console.log(
    `[matchMerge] writer=composer matches=${result.matchCount}`
    + ` locked=${result.projectStats?.locked}`
    + ` unlocked=${result.projectStats?.unlocked}`
    + ` alignId=${result.alignStats?.alignedById || 0}`
    + ` alignName=${result.alignStats?.alignedByName || 0}`,
  );
  return {
    matchCount: result.matchCount,
    builtAt: now,
    matchIdBackfill: result.matchIdBackfill,
    teamReg: result.teamReg,
    nameSync: result.nameSync,
    alignStats: result.alignStats || { alignedById: 0, alignedByName: 0 },
    hotCollector: null,
    sideEngine: "composer",
    projectStats: result.projectStats,
    writer: "composer",
    endedCount: result.endedCount || 0,
  };
}

/** 进程内互斥：matcher 循环与 UI 人工 matchMerge 共用同一 in-flight Promise */
async function matchMergeOnce(opts = {}) {
  if (_matchMergeInFlight) {
    if (opts.afterInFlight) {
      await _matchMergeInFlight;
      return matchMergeOnce();
    }
    return _matchMergeInFlight;
  }
  _matchMergeInFlight = matchMergeOnceImpl().finally(() => {
    _matchMergeInFlight = null;
  });
  return _matchMergeInFlight;
}

export {
  ensureTeamPlugin,
  invalidateTeamPlugin,
  matchMergeOnce,
  resetTeamPluginCache,
};
