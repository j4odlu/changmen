/**
 * ID/队名两阶段之后的补合并：
 * 4a 贴漏网馆 → 4b 并相似场（队名交集 / gb 桥，含队名反查 gb）
 */
import {
  lookupGbTeamIdByName,
  normalizeTeam,
} from "@changmen/match-identity/teams/team_key.js";
import { isPlaceholderTeamName } from "@changmen/match-identity/teams/match_utils.js";
import { sameTeamPair } from "../sides/orientation_lock.js";
import {
  ID_START_TOLERANCE_MS,
  NAME_START_TOLERANCE_MS,
  normalizeEpochMs,
} from "../util/time.js";

/** 多候选贴馆：最优与次优都够近且彼此差 &lt; 此值 → 歧义不贴 */
export const AMBIGUOUS_ATTACH_GAP_MS = 10 * 60 * 1000;

function gameKeyOf(entryOrRow) {
  const gid = entryOrRow.GameID ?? entryOrRow.gameId;
  if (gid != null && String(gid).trim() !== "" && String(gid) !== "0")
    return String(gid);
  return String(entryOrRow.gameCode || "").trim() || "";
}

function namePairOf(homeN, awayN) {
  if (!homeN || !awayN)
    return null;
  if (isPlaceholderTeamName(homeN) || isPlaceholderTeamName(awayN))
    return null;
  const [a, b] = homeN < awayN ? [homeN, awayN] : [awayN, homeN];
  return `${a}|${b}`;
}

function namePairFromEntry(entry) {
  return namePairOf(entry.homeN, entry.awayN);
}

function enrichGb(entry) {
  let homeGb = entry.homeGb || null;
  let awayGb = entry.awayGb || null;
  if (!homeGb && entry.homeN && entry.gameCode)
    homeGb = String(lookupGbTeamIdByName(entry.homeName || entry.homeN, entry.gameCode) || "").trim() || null;
  if (!awayGb && entry.awayN && entry.gameCode)
    awayGb = String(lookupGbTeamIdByName(entry.awayName || entry.awayN, entry.gameCode) || "").trim() || null;
  return { homeGb, awayGb };
}

function entryIndex(allEntries) {
  const map = new Map();
  for (const e of allEntries || [])
    map.set(e.rowKey, e);
  return map;
}

function membersOfRow(row, byKey) {
  const out = [];
  for (const [platform, sid] of Object.entries(row.Matchs || {})) {
    const e = byKey.get(`${platform}:${sid}`);
    if (e)
      out.push(e);
  }
  return out;
}

function clusterMeta(row, byKey) {
  const members = membersOfRow(row, byKey);
  const namePairs = new Set();
  let homeGb = null;
  let awayGb = null;
  let gbConflict = false;
  let bo = Number(row.BO) || 0;
  const gKey = gameKeyOf(row) || (members[0] ? gameKeyOf(members[0]) : "");

  for (const e of members) {
    const np = namePairFromEntry(e);
    if (np)
      namePairs.add(np);
    const g = enrichGb(e);
    if (g.homeGb && g.awayGb && g.homeGb !== g.awayGb) {
      if (!homeGb) {
        homeGb = g.homeGb;
        awayGb = g.awayGb;
      }
      else if (!sameTeamPair(homeGb, awayGb, g.homeGb, g.awayGb)) {
        gbConflict = true;
      }
    }
    if (!bo && e.BO)
      bo = Number(e.BO) || 0;
  }

  // Title 兜底 namePair
  const title = String(row.Title || "");
  const vs = title.split(/\s+vs\s+/i);
  if (vs.length >= 2) {
    const np = namePairOf(normalizeTeam(vs[0]), normalizeTeam(vs.slice(1).join(" vs ")));
    if (np)
      namePairs.add(np);
  }

  const startMs = normalizeEpochMs(row.StartTime) || 0;
  return {
    members,
    namePairs,
    // 簇内 gb 互相矛盾时禁用 gb 桥，避免误并
    gbPair: (!gbConflict && homeGb && awayGb) ? { homeGb, awayGb } : null,
    bo,
    gameKey: gKey,
    startMs,
    isSeed: row._clusterBasis === "seed" || row._clusterBasis === "binding",
  };
}

function timeDiffOk(aMs, bMs, tolMs) {
  const a = normalizeEpochMs(aMs);
  const b = normalizeEpochMs(bMs);
  if (!a || !b)
    return false;
  return Math.abs(a - b) <= tolMs;
}

function boConflict(aBo, bBo) {
  const a = Number(aBo) || 0;
  const b = Number(bBo) || 0;
  return a > 0 && b > 0 && a !== b;
}

function namePairsIntersect(setA, setB) {
  for (const p of setA) {
    if (setB.has(p))
      return true;
  }
  return false;
}

function gbCompatible(pairA, pairB) {
  if (!pairA || !pairB)
    return false;
  return sameTeamPair(pairA.homeGb, pairA.awayGb, pairB.homeGb, pairB.awayGb);
}

function hitCondition(metaA, metaB) {
  if (gbCompatible(metaA.gbPair, metaB.gbPair))
    return true;
  if (namePairsIntersect(metaA.namePairs, metaB.namePairs))
    return true;
  return false;
}

function matchsConflict(matchsA, matchsB) {
  for (const [p, sid] of Object.entries(matchsB || {})) {
    const prev = matchsA?.[p];
    if (prev != null && prev !== "" && String(prev) !== String(sid))
      return true;
  }
  return false;
}

function mergeMatchsUnion(rows) {
  const out = {};
  for (const row of rows) {
    for (const [p, sid] of Object.entries(row.Matchs || {})) {
      if (out[p] != null && String(out[p]) !== String(sid))
        return null; // conflict
      out[p] = String(sid);
    }
  }
  return out;
}

/** 合并簇时保留 PB rot 拼盘元数据（B1 periods / sibling 列表） */
function unionPbRotMeta(rows) {
  const sibs = new Set();
  let rot = "";
  for (const row of rows || []) {
    const r = String(row?._pbRotNum || "").trim();
    if (r && !rot)
      rot = r;
    for (const sid of row?._pbSiblingSourceMatchIds || []) {
      const s = String(sid || "").trim();
      if (s)
        sibs.add(s);
    }
  }
  // 并集 Matchs.PB 以外的不应进 sibling；主 id 若在 sibs 里去掉
  const primary = rows?.map(r => String(r?.Matchs?.PB || "").trim()).find(Boolean) || "";
  if (primary)
    sibs.delete(primary);
  const out = {};
  if (sibs.size)
    out._pbSiblingSourceMatchIds = [...sibs];
  if (rot)
    out._pbRotNum = rot;
  return out;
}

function pickPreferredRow(rows) {
  const idRow = rows.find(r => String(r.MergeKey || "").startsWith("match:id:"));
  if (idRow)
    return idRow;
  return [...rows].sort((a, b) => (a.StartTime || 0) - (b.StartTime || 0))[0];
}

/** BO 取自 META 优先级最高的成员（可能非 OB），仅供本阶段 boConflict 用；
 *  落库值由 structure/resolve_structure 覆写成 OB-only */
function pickMetaFromMembers(members, fallbackRow) {
  const ORDER = ["Polymarket", "OB", "RAY", "IA", "PB", "TF"];
  let best = members[0];
  for (const p of ORDER) {
    const hit = members.find(e => e.platform === p);
    if (hit) {
      best = hit;
      break;
    }
  }
  if (!best) {
    return {
      Title: fallbackRow.Title || "",
      StartTime: fallbackRow.StartTime || 0,
      Game: fallbackRow.Game || "",
      GameID: fallbackRow.GameID || "",
      BO: fallbackRow.BO || 0,
    };
  }
  return {
    Title: `${best.homeName} vs ${best.awayName}`,
    StartTime: best.startMs || fallbackRow.StartTime || 0,
    Game: best.Game || fallbackRow.Game || "",
    GameID: best.GameID || fallbackRow.GameID || "",
    BO: best.BO || fallbackRow.BO || 0,
  };
}

/**
 * 4a：把漏网单馆贴到已有场
 */
export function attachOrphans(list, orphans, byKey, stats) {
  const remaining = [];
  for (const orphan of orphans || []) {
    if (!canUseNameOrGb(orphan)) {
      remaining.push(orphan);
      continue;
    }
    const oMeta = {
      namePairs: new Set([namePairFromEntry(orphan)].filter(Boolean)),
      gbPair: (() => {
        const g = enrichGb(orphan);
        return g.homeGb && g.awayGb && g.homeGb !== g.awayGb
          ? { homeGb: g.homeGb, awayGb: g.awayGb }
          : null;
      })(),
      bo: Number(orphan.BO) || 0,
      gameKey: gameKeyOf(orphan),
      startMs: orphan.startMs || 0,
    };

    const candidates = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const cMeta = clusterMeta(row, byKey);
      if (!cMeta.gameKey || cMeta.gameKey !== oMeta.gameKey)
        continue;
      if (row.Matchs?.[orphan.platform])
        continue;
      const tol = (row._clusterBasis === "id" || String(row.MergeKey || "").startsWith("match:id:"))
        ? ID_START_TOLERANCE_MS
        : NAME_START_TOLERANCE_MS;
      if (!timeDiffOk(cMeta.startMs, oMeta.startMs, tol))
        continue;
      if (boConflict(cMeta.bo, oMeta.bo))
        continue;
      if (!hitCondition(cMeta, oMeta))
        continue;
      candidates.push({
        i,
        dt: Math.abs((cMeta.startMs || 0) - (oMeta.startMs || 0)),
        preferId: row._clusterBasis === "id" || String(row.MergeKey || "").startsWith("match:id:"),
      });
    }

    if (!candidates.length) {
      remaining.push(orphan);
      continue;
    }
    candidates.sort((a, b) => a.dt - b.dt || (b.preferId - a.preferId));
    const best = candidates[0];
    const second = candidates[1];
    // 两个都已是合法候选时，时间差过近 → 歧义不贴（不限 30min 窗）
    if (second && Math.abs(best.dt - second.dt) < AMBIGUOUS_ATTACH_GAP_MS) {
      stats.skippedAmbiguous += 1;
      remaining.push(orphan);
      continue;
    }

    const target = list[best.i];
    target.Matchs = { ...target.Matchs, [orphan.platform]: orphan.sourceMatchId };
    if (target._clusterBasis === "id" || target._clusterBasis === "name")
      target._clusterBasis = "reconciled";
    target._reconciled = true;
    stats.attached += 1;
  }
  return remaining;
}

function canUseNameOrGb(entry) {
  const np = namePairFromEntry(entry);
  const g = enrichGb(entry);
  if (np)
    return true;
  if (g.homeGb && g.awayGb && g.homeGb !== g.awayGb)
    return true;
  return false;
}

/**
 * 4b：并相似场
 */
export function mergeClustersByName(list, byKey, stats) {
  const n = list.length;
  if (n < 2)
    return list;

  const metas = list.map(row => clusterMeta(row, byKey));
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb)
      parent[rb] = ra;
  }

  function componentRows(root) {
    const rows = [];
    for (let k = 0; k < n; k++) {
      if (find(k) === root)
        rows.push(list[k]);
    }
    return rows;
  }

  /** @type {{ i: number, j: number, dt: number, preferId: number }[]} */
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = metas[i];
      const b = metas[j];
      if (a.isSeed || b.isSeed)
        continue;
      if (!a.gameKey || a.gameKey !== b.gameKey)
        continue;
      if (!timeDiffOk(a.startMs, b.startMs, NAME_START_TOLERANCE_MS))
        continue;
      if (boConflict(a.bo, b.bo)) {
        stats.skippedBo += 1;
        continue;
      }
      if (!hitCondition(a, b))
        continue;
      if (matchsConflict(list[i].Matchs, list[j].Matchs)) {
        stats.skippedConflict += 1;
        continue;
      }
      const preferId = (String(list[i].MergeKey || "").startsWith("match:id:") ? 1 : 0)
        + (String(list[j].MergeKey || "").startsWith("match:id:") ? 1 : 0);
      edges.push({
        i,
        j,
        dt: Math.abs((a.startMs || 0) - (b.startMs || 0)),
        preferId,
      });
    }
  }

  // 先合「含 id 键 / 时间更近」的边，降低传递冲突误伤 A+B 的概率
  edges.sort((x, y) => y.preferId - x.preferId || x.dt - y.dt);

  for (const e of edges) {
    const ra = find(e.i);
    const rb = find(e.j);
    if (ra === rb)
      continue;
    const mergedProbe = mergeMatchsUnion([
      ...componentRows(ra),
      ...componentRows(rb),
    ]);
    if (!mergedProbe) {
      stats.skippedConflict += 1;
      continue;
    }
    union(e.i, e.j);
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r))
      groups.set(r, []);
    groups.get(r).push(i);
  }

  const out = [];
  for (const idxs of groups.values()) {
    if (idxs.length === 1) {
      out.push(list[idxs[0]]);
      continue;
    }
    const rows = idxs.map(i => list[i]);
    const unionMatchs = mergeMatchsUnion(rows);
    if (!unionMatchs) {
      stats.skippedConflict += 1;
      for (const row of rows)
        out.push(row);
      continue;
    }
    const preferred = pickPreferredRow(rows);
    const allMembers = [];
    for (const row of rows)
      allMembers.push(...membersOfRow(row, byKey));
    // 也纳入并集里可能尚未在 membersOfRow 的（理论上都在）
    const meta = pickMetaFromMembers(allMembers, preferred);
    const pbMeta = unionPbRotMeta(rows);
    const merged = {
      ...preferred,
      Matchs: unionMatchs,
      Title: meta.Title,
      StartTime: meta.StartTime,
      Game: meta.Game,
      GameID: meta.GameID,
      BO: meta.BO || preferred.BO || 0,
      MergeKey: String(preferred.MergeKey || "").startsWith("match:id:")
        ? preferred.MergeKey
        : (rows.find(r => String(r.MergeKey || "").startsWith("match:id:"))?.MergeKey
          || preferred.MergeKey),
      _clusterBasis: "reconciled",
      _reconciled: true,
      _entryCount: Object.keys(unionMatchs).length,
      ...pbMeta,
    };
    if (!pbMeta._pbSiblingSourceMatchIds)
      delete merged._pbSiblingSourceMatchIds;
    if (!pbMeta._pbRotNum)
      delete merged._pbRotNum;
    stats.merged += 1;
    out.push(merged);
  }

  out.sort((a, b) => (a.StartTime || 0) - (b.StartTime || 0));
  return out;
}

/**
 * @param {object[]} list 已有簇
 * @param {object[]} allEntries 全部平台条目
 * @returns {{ list: object[], stats: object }}
 */
export function reconcileClustersByName(list, allEntries) {
  const stats = {
    attached: 0,
    merged: 0,
    skippedConflict: 0,
    skippedAmbiguous: 0,
    skippedBo: 0,
  };
  const byKey = entryIndex(allEntries);
  const inCluster = new Set();
  for (const row of list || []) {
    for (const [p, sid] of Object.entries(row.Matchs || {}))
      inCluster.add(`${p}:${sid}`);
  }
  const orphans = (allEntries || []).filter(e => !inCluster.has(e.rowKey));

  let next = (list || []).map(r => ({ ...r, Matchs: { ...r.Matchs } }));
  attachOrphans(next, orphans, byKey, stats);
  // 刷新索引中的 members（Matchs 已变）
  next = mergeClustersByName(next, byKey, stats);

  return { list: next, stats };
}
