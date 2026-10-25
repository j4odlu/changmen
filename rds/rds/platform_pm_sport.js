/** PM 状态属于平台场次；独立于 match_id，不创建比赛或修改关联。 */
import { getPgPool } from "./common.js";

export async function fetchPlatformPmSports(eventIds) {
  const ids = [...new Set((eventIds || []).map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  const pool = getPgPool();
  if (!pool) throw new Error("PM 场次状态数据库不可用");
  try {
    const { rows } = await pool.query(
      "SELECT source_match_id, pm_sport FROM platform_matches WHERE platform = 'Polymarket' AND source_match_id = ANY($1::text[]) AND pm_sport IS NOT NULL", [ids],
    );
    return new Map(rows.map(row => [String(row.source_match_id), row.pm_sport]));
  }
  catch (error) {
    // 滚动发布中 collector 尚未初始化状态列时显示“状态待更新”。
    if (error.code === "42703") return new Map();
    throw error;
  }
}

export async function writePlatformPmSports(snapshots) {
  const records = new Map();
  for (const snapshot of snapshots || []) {
    const id = String(snapshot?.eventId ?? "").trim();
    if (!id || !["gamma", "ws"].includes(snapshot.source)
      || !Number.isSafeInteger(Number(snapshot.updatedAt)) || Number(snapshot.updatedAt) <= 0) continue;
    const previous = records.get(id);
    if (!previous || (snapshot.source === "ws" && previous.source !== "ws")
      || (snapshot.source === previous.source && Number(snapshot.updatedAt) >= Number(previous.updatedAt)))
      records.set(id, snapshot);
  }
  if (!records.size) return 0;
  const pool = getPgPool();
  if (!pool) throw new Error("PM 场次状态数据库不可用");
  const { rowCount } = await pool.query(`
    UPDATE platform_matches pm SET pm_sport = incoming.snapshot
    FROM jsonb_array_elements($1::jsonb) AS incoming(snapshot)
    WHERE pm.platform = 'Polymarket' AND pm.source_match_id = incoming.snapshot->>'eventId'
      AND ((incoming.snapshot->>'source' = 'ws' AND pm.pm_sport->>'source' IS DISTINCT FROM 'ws')
        OR (COALESCE((pm.pm_sport->>'updatedAt')::bigint, 0) <= (incoming.snapshot->>'updatedAt')::bigint
          AND (incoming.snapshot->>'source' = 'ws'
            OR pm.pm_sport->>'source' IS DISTINCT FROM 'ws')))`,
  [JSON.stringify([...records.values()])]);
  return rowCount || 0;
}
