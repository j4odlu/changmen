import * as db from "@changmen/db";
import { matchMergeOnce } from "./match_merge_once.js";
import { invalidateMatcherRdsSnapshot } from "./rds_snapshot_cache.js";
import { withMatcherWriteLock } from "../lib/write_guard.js";
import "../lib/env.js";

/**
 * 恢复已结束的 client_matches：清除 ended_at，再 matchMerge。
 * 若合场仍判定已结束，会再次写入 ended_at，并在返回中标记 reEnded。
 */

async function restoreClientMatch(clientMatchId) {
  const cmId = Number(clientMatchId);
  if (!Number.isFinite(cmId))
    throw new Error("无效的赛事 ID");

  const cm = await withMatcherWriteLock(async () => {
    const cm = await db.fetchClientMatchRow(cmId, "id, title, ended_at");
    if (!cm) throw new Error("赛事不存在");
    if (cm.ended_at != null) {
      await db.clearClientMatchEndedAt(cmId);
      invalidateMatcherRdsSnapshot(["clientMatches", "platformMatches"]);
    }
    return cm;
  });

  if (cm.ended_at == null) {
    return {
      ok: true,
      id: cmId,
      title: cm.title || "",
      alreadyVisible: true,
      matchMerge: null,
    };
  }

  const matchMerge = await matchMergeOnce({ afterInFlight: true });

  const after = await db.fetchClientMatchRow(cmId, "id, title, ended_at");
  const reEnded = after?.ended_at != null;

  return {
    ok: true,
    id: cmId,
    title: (after?.title || cm.title || ""),
    restored: true,
    reEnded,
    matchMerge,
  };
}

export { restoreClientMatch };
