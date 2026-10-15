import * as db from "@changmen/db";
import { removeClientMatchFromMemory } from "../runtime_ports.js";
import { invalidateMatcherRdsSnapshot } from "./rds_snapshot_cache.js";
import { matchMergeOnce } from "./match_merge_once.js";
import "../lib/env.js";

/**
 * 强制结束：写 ended_at，保留 matchs 与 platform_matches；不搬 history。
 * 场馆继续上报时合场复用同一 client_matches.id，Client_GetMatchs 不再返回。
 */

async function forceEndClientMatch(clientMatchId) {
  const cmId = Number(clientMatchId);
  if (!Number.isFinite(cmId))
    throw new Error("无效的赛事 ID");

  const cm = await db.fetchClientMatchRow(cmId, "id, title, matchs, ended_at");
  if (!cm)
    throw new Error("赛事不存在");

  const result = await db.forceEndClientMatch(cmId);
  removeClientMatchFromMemory(cmId);

  invalidateMatcherRdsSnapshot(["platformMatches", "clientMatches"]);
  const matchMerge = await matchMergeOnce({ afterInFlight: true });

  return {
    ok: true,
    id: cmId,
    title: cm.title || "",
    ended: true,
    archived: true,
    alreadyEnded: !!result.alreadyEnded,
    ended_at: result.ended_at,
    platformMatchesDeleted: 0,
    deletedPlatforms: [],
    matchMerge,
  };
}

/** @deprecated 别名：旧 API / UI 仍叫 archive */
async function clientMatchToHistory(clientMatchId) {
  return forceEndClientMatch(clientMatchId);
}

export { clientMatchToHistory, forceEndClientMatch };
