/**
 * 写 client_matches + 对齐 post-hooks。
 * active 写 ended_at=NULL（DB sticky 不会清已有 ended_at）；
 * 已有比赛结束只写 ended_at，保留原匹配、方向、盘口及其它字段；
 * markEndedIds：sources-gone 的 active gap（或 sticky 再确认）；
 * 不用「本拍未合出」整表差量归档（M1 / #1669）。
 */
import * as db from "@changmen/db";
import { invalidateClientMatchSnapshot } from "@changmen/db/client_match_snapshot.js";
import { collectorRuntime, publishCommittedClientMatches } from "../../runtime_ports.js";
import { clientMatchWriteRow } from "../write_payload.js";
import { filterRayRiskMatches } from "../../ray_match_risk.js";

/**
 * @param {object[]} info 活跃行
 * @param {number} [builtAt]
 * @param {{ endedRows?: object[], markEndedIds?: number[], stickyEndedIds?: Set<number>|number[], existingClientRows?: object[] }} [opts]
 */
export async function writeClientMatches(info, builtAt = Date.now(), opts = {}) {
  if (!db.isMatcherStoreReady())
    throw new Error("MATCH_COMPOSER_WRITE=1 但数据库未配置");

  const stickyEndedIds = new Set(
    [...(opts.stickyEndedIds || [])].map(Number).filter(id => Number.isFinite(id) && id > 0),
  );
  const endedRowsRaw = Array.isArray(opts.endedRows) ? opts.endedRows : [];
  const existingById = new Map((opts.existingClientRows || []).map(row => [Number(row.id ?? row.ID), row]));
  const newlyEnded = [];
  const stickyOnlyIds = [];
  for (const m of endedRowsRaw) {
    const id = Number(m.ID);
    if (!Number.isFinite(id) || id <= 0)
      continue;
    if (stickyEndedIds.has(id) || existingById.has(id))
      stickyOnlyIds.push(id);
    else
      newlyEnded.push(clientMatchWriteRow(m, builtAt, { endedAt: builtAt }));
  }

  const activeRows = (info || [])
    .filter(m => Number.isFinite(Number(m.ID)) && Number(m.ID) > 0)
    .map(m => {
      const row = clientMatchWriteRow(m, builtAt, { endedAt: null });
      row.matchs = { ...existingById.get(row.id)?.matchs, ...row.matchs };
      return row;
    });

  await db.writeClientMatchesAsync({
    activeRows,
    endedRows: newlyEnded,
    markEndedIds: [...(opts.markEndedIds || []), ...stickyOnlyIds],
    builtAt,
  });

  invalidateClientMatchSnapshot();
  try {
    filterRayRiskMatches([...activeRows, ...(opts.existingClientRows || [])]
      .map(row => ({ ID: row.id, Matchs: row.matchs || {} })));
  } catch (err) { console.warn("[match-composer] save RAY risk identities:", err.message); }
  try { await publishCommittedClientMatches(); }
  catch (err) { console.warn("[match-composer] publish committed snapshot:", err.message); }
  const endedForMemory = endedRowsRaw.map(row => {
    const existing = existingById.get(Number(row.ID));
    return existing ? { ...row, Matchs: existing.matchs ?? existing.Matchs ?? {} } : row;
  });
  const publishedEndedIds = new Set(endedForMemory.map(row => Number(row.ID)));
  for (const id of opts.markEndedIds || []) {
    const existing = existingById.get(Number(id));
    if (existing && !publishedEndedIds.has(Number(id)))
      endedForMemory.push({ ID: Number(id), Matchs: existing.matchs ?? existing.Matchs ?? {} });
  }
  try { collectorRuntime.patchCollectorMatchClientIds([...(info || []), ...endedForMemory]); }
  catch (err) { console.warn("[match-composer] patchCollectorMatchClientIds:", err.message); }

  return { wrote: true, builtAt };
}
