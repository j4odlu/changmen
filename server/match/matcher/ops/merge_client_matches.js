import * as db from "@changmen/db";
import { collectorRuntime as store } from "../runtime_ports.js";
import { matchMergeOnce } from "./match_merge_once.js";
import { invalidateMatcherRdsSnapshot } from "./rds_snapshot_cache.js";

/**
 * 合并两条 client_matches：source 并入 target，保留 target.id。
 */

async function previewMergeClientMatches({ sourceClientMatchId, targetClientMatchId }) {
  const sourceId = Number(sourceClientMatchId);
  const targetId = Number(targetClientMatchId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
    throw new TypeError("无效的赛事 ID");
  }
  if (sourceId === targetId)
    throw new Error("不能合并同一条赛事");

  const source = await db.fetchClientMatchRow(
    sourceId,
    "id,title,game,game_id,start_time,matchs,bets",
  );
  const target = await db.fetchClientMatchRow(
    targetId,
    "id,title,game,game_id,start_time,matchs,bets",
  );
  if (!source)
    throw new Error("源赛事不存在");
  if (!target)
    throw new Error("目标赛事不存在");

  const sourceMatchs = source.matchs || {};
  const targetMatchs = target.matchs || {};
  const conflicts = [];
  for (const [plat, srcId] of Object.entries(sourceMatchs)) {
    const existing = targetMatchs[plat];
    if (existing != null && String(existing) !== String(srcId)) {
      conflicts.push({ platform: plat, sourceMatchId: String(srcId), targetMatchId: String(existing) });
    }
  }

  const mergedPlatformSet = new Set([
    ...Object.keys(sourceMatchs),
    ...Object.keys(targetMatchs),
  ]);

  return {
    sourceClientMatchId: sourceId,
    targetClientMatchId: targetId,
    source: {
      id: sourceId,
      title: source.title || "",
      matchs: sourceMatchs,
      platforms: Object.keys(sourceMatchs),
    },
    target: {
      id: targetId,
      title: target.title || "",
      matchs: targetMatchs,
      platforms: Object.keys(targetMatchs),
    },
    conflicts,
    mergedPlatforms: [...mergedPlatformSet],
    canMerge: conflicts.length === 0,
  };
}

async function mergeClientMatches({ sourceClientMatchId, targetClientMatchId }) {
  const preview = await previewMergeClientMatches({
    sourceClientMatchId,
    targetClientMatchId,
  });
  if (!preview.canMerge) {
    const names = preview.conflicts.map(c => c.platform).join("、");
    throw new Error(`无法合并：${names} 在两场赛事中指向不同 platform_match`);
  }

  const sourceId = preview.sourceClientMatchId;
  const targetId = preview.targetClientMatchId;

  for (const [plat, srcId] of Object.entries(preview.source.matchs)) {
    await db.setPlatformMatchId(plat, String(srcId), targetId, { force: true });
  }

  await db.reassignPlatformMatchIds(sourceId, targetId);
  await db.deleteClientMatchRow(sourceId);

  store.patchCollectorMatchClientIds([{
    ID: targetId,
    Matchs: { ...preview.target.matchs, ...preview.source.matchs },
  }]);

  invalidateMatcherRdsSnapshot(["platformMatches", "clientMatches"]);
  const matchMerge = await matchMergeOnce({ afterInFlight: true });

  return {
    ok: true,
    sourceClientMatchId: sourceId,
    targetClientMatchId: targetId,
    mergedPlatforms: preview.mergedPlatforms,
    matchMerge,
    summary: `赛事 #${sourceId} 已并入 #${targetId}（${preview.mergedPlatforms.length} 个平台）`,
  };
}

export { mergeClientMatches, previewMergeClientMatches };
