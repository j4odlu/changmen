/**
 * client_matches ID 分配：复用 @changmen/match-identity/ids（非 merge）。
 * dry-run 时不 insert stub，仅复用已有 id，否则分配临时负 ID。
 */
import {
  assignMatchIds,
  findLinkedClientIdFromMatchs,
  findReuseIdByMatchsSuperset,
  findReuseIdByPlatformOverlap,
  matchsSignature,
  resolveClientMatchIds,
} from "@changmen/match-identity/ids/client_match_ids.js";

/** M3：已结束行不参与身份复用 */
export function isEndedClientMatchRow(row) {
  const ended = row?.ended_at ?? row?.endedAt;
  return ended != null && ended !== "";
}

function activeClientMatchRows(rows) {
  return (rows || []).filter(r => !isEndedClientMatchRow(r));
}

function reuseIdSync(row, existingActive, matches, byMergeKey, byMatchsSig, batchAssigned, existingIdKeyIndex, activeIds) {
  const mergeKey = row.MergeKey ? String(row.MergeKey) : null;
  let id = Number(row.ID) || 0;
  // M4：seed 可能带上 ended id；非活跃正 ID 一律丢弃
  if (id > 0 && activeIds && !activeIds.has(id))
    id = 0;

  if (!id && mergeKey?.startsWith("match:id:") && existingIdKeyIndex?.has(mergeKey))
    id = existingIdKeyIndex.get(mergeKey) || 0;
  if (!id && mergeKey)
    id = batchAssigned.get(mergeKey) || byMergeKey.get(mergeKey) || 0;
  if (!id && matches) {
    const linked = findLinkedClientIdFromMatchs(row.Matchs, matches, {
      mergeKey,
      existingIdKeyIndex,
    });
    // M3：链接到 ended CM 的 match_id 忽略
    if (linked && activeIds?.has(linked))
      id = linked;
  }
  if (!id) {
    const sig = matchsSignature(row.Matchs);
    if (sig)
      id = byMatchsSig.get(sig) || 0;
  }
  if (!id)
    id = findReuseIdByMatchsSuperset(existingActive, row.Matchs) || 0;
  if (!id)
    id = findReuseIdByPlatformOverlap(existingActive, row.Matchs) || 0;
  return { id, mergeKey };
}

/**
 * dry-run：不写 stub；新场用临时负 ID（仅内存对照）。
 */
export function resolveIdsDryRun(builtRows, {
  matches,
  existingClientRows = [],
  existingIdKeyIndex,
} = {}) {
  const activeExisting = activeClientMatchRows(existingClientRows);
  const byMergeKey = new Map();
  const byMatchsSig = new Map();
  const activeIds = new Set();
  for (const row of activeExisting) {
    const id = Number(row.id);
    activeIds.add(id);
    if (row.merge_key)
      byMergeKey.set(String(row.merge_key), id);
    const sig = matchsSignature(row.matchs || row.Matchs);
    if (sig && !byMatchsSig.has(sig))
      byMatchsSig.set(sig, id);
  }
  if (existingIdKeyIndex) {
    for (const [key, id] of existingIdKeyIndex) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0)
        activeIds.add(n);
      if (!byMergeKey.has(key))
        byMergeKey.set(key, id);
    }
  }
  const batchAssigned = new Map();
  let tempSeq = -1;
  const out = [];
  for (const row of builtRows || []) {
    const { id: reuse, mergeKey } = reuseIdSync(
      row,
      activeExisting,
      matches,
      byMergeKey,
      byMatchsSig,
      batchAssigned,
      existingIdKeyIndex,
      activeIds,
    );
    let id = reuse;
    if (!id) {
      id = tempSeq;
      tempSeq -= 1;
    }
    if (mergeKey)
      batchAssigned.set(mergeKey, id);
    const sig = matchsSignature(row.Matchs);
    if (sig)
      byMatchsSig.set(sig, id);
    out.push(assignMatchIds(row, id));
  }
  return out;
}

/**
 * 写库路径：完整 resolveClientMatchIds（可 insert stub）。
 */
export async function resolveIdsForWrite(adapter, builtRows, { matches, existingIdKeyIndex } = {}) {
  return resolveClientMatchIds(adapter, builtRows, { matches, existingIdKeyIndex });
}
