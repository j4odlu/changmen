/**
 * 自研合场聚类：gb 对 → 队名+严格时间；最少 2 馆。
 * MergeKey 使用 match:id: / match:name: 格式。
 */
import { isComposerPbRotnumCollapse } from "../../lib/config.js";
import {
  canUseIdKey,
  canUseNameKey,
  collectPlatformEntries,
  pairKeyId,
  pairKeyName,
} from "../normalize/platform_entry.js";
import {
  collapsePbEntriesByRotNum,
  indexEntriesWithPbAliases,
  pickPrimaryPbSourceId,
} from "../normalize/pb_rotnum_collapse.js";
import { startTimesCompatibleId, startTimesCompatibleName } from "../util/time.js";
import {
  findPlatformMatch,
  sameTeamPair,
  teamIdsFromPm,
} from "../sides/orientation_lock.js";
import { reconcileClustersByName } from "./reconcile_by_name.js";

export const MIN_PLATFORMS = 2;

const META_PLATFORM_ORDER = ["Polymarket", "OB", "RAY", "IA", "PB", "TF"];

/** BO：只信 OB；无 OB 则 0。最终值由 structure/resolve_structure 覆写 */
function pickBo(entries) {
  const ob = entries.find(e => e.platform === "OB" && Number(e.BO) > 0);
  return ob ? Number(ob.BO) : 0;
}

function pickMeta(entries) {
  let best = entries[0];
  for (const p of META_PLATFORM_ORDER) {
    const hit = entries.find(e => e.platform === p);
    if (hit) {
      best = hit;
      break;
    }
  }
  return {
    Title: `${best.homeName} vs ${best.awayName}`,
    StartTime: best.startMs || 0,
    Game: best.Game || "",
    GameID: best.GameID || "",
    BO: pickBo(entries),
  };
}

function toClusterRow(entries, mergeKey, basis) {
  const Matchs = {};
  for (const e of entries)
    Matchs[e.platform] = e.sourceMatchId;
  const meta = pickMeta(entries);
  const pb = entries.find(e => e.platform === "PB");
  const row = {
    MergeKey: mergeKey,
    Matchs,
    Title: meta.Title,
    StartTime: meta.StartTime,
    Game: meta.Game,
    GameID: meta.GameID,
    BO: meta.BO,
    Round: 0,
    RoundStart: 0,
    Reverse: [],
    Bets: [],
    _clusterBasis: basis,
    _entryCount: entries.length,
  };
  // 对外投影：仅 RotNum 归组才把 sibling 拼进 Sources（changmen 扩展）。
  // 无 RotNum 时只选举 live 进 Matchs.PB，不把赛前残留图拼进盘面（A8 复刻）。
  if (pb?._pbSiblingSourceMatchIds?.length && pb._pbRotNum) {
    row._pbSiblingSourceMatchIds = [...pb._pbSiblingSourceMatchIds];
    row._pbRotNum = pb._pbRotNum;
  }
  return row;
}

function groupEntries(entries, keyFn, timeOk, basis) {
  /** @type {Map<string, object[][]>} */
  const buckets = new Map();
  for (const entry of entries) {
    const key = keyFn(entry);
    if (!key)
      continue;
    let chains = buckets.get(key);
    if (!chains) {
      chains = [];
      buckets.set(key, chains);
    }
    let placed = false;
    for (const chain of chains) {
      if (chain.some(x => x.platform === entry.platform))
        continue;
      const ref = chain[0];
      if (!timeOk(ref.startMs, entry.startMs))
        continue;
      chain.push(entry);
      placed = true;
      break;
    }
    if (!placed)
      chains.push([entry]);
  }
  const rows = [];
  const used = new Set();
  for (const [key, chains] of buckets) {
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      if (chain.length < MIN_PLATFORMS)
        continue;
      for (const e of chain)
        used.add(e.rowKey);
      // 同队对因时间拆桶时必须区分 MergeKey，否则 dry/写库会塌成同一 id
      const startMs = Number(chain[0]?.startMs) || 0;
      const mergeKey = chains.length > 1
        ? `${key}@${startMs || i}`
        : key;
      rows.push(toClusterRow(chain, mergeKey, basis));
    }
  }
  return { rows, used };
}

function isEndedClientMatchRow(row) {
  const ended = row?.ended_at ?? row?.endedAt;
  return ended != null && ended !== "";
}

function seedFromExisting(entries, existingClientRows) {
  const byKey = indexEntriesWithPbAliases(entries);
  const seeded = [];
  const used = new Set();
  for (const cm of existingClientRows || []) {
    // M4：ended 不参与种子，避免同队下场粘 sticky id 并吃掉馆源
    if (isEndedClientMatchRow(cm))
      continue;
    const matchs = cm.matchs || cm.Matchs || {};
    const chain = [];
    for (const [platform, sid] of Object.entries(matchs)) {
      const e = byKey.get(`${platform}:${sid}`);
      if (e && !used.has(e.rowKey))
        chain.push(e);
    }
    // 已通过 align 挂上 ClientMatchId、但尚未写入 matchs 的馆也并入
    for (const e of entries) {
      if (used.has(e.rowKey) || chain.some(x => x.rowKey === e.rowKey))
        continue;
      if (Number(e.clientMatchId) === Number(cm.id) && Number.isFinite(Number(cm.id)))
        chain.push(e);
    }
    if (chain.length < MIN_PLATFORMS)
      continue;
    for (const e of chain)
      used.add(e.rowKey);
    const mergeKey = cm.merge_key
      || pairKeyId(chain[0])
      || pairKeyName(chain[0])
      || `seed:${cm.id}`;
    const row = toClusterRow(chain, String(mergeKey), "seed");
    row.ID = Number(cm.id) || undefined;
    if (cm.home_gb_team_id)
      row._seedHomeGb = String(cm.home_gb_team_id);
    if (cm.away_gb_team_id)
      row._seedAwayGb = String(cm.away_gb_team_id);
    seeded.push(row);
  }
  return { rows: seeded, used };
}

/** binding / Matchs 必须与簇内锚点同队对（有 gb 时） */
export function bindingCompatibleWithRow(row, platform, sourceMatchId, matches) {
  const pm = findPlatformMatch(matches, platform, sourceMatchId);
  if (!pm)
    return false;
  const { homeGb, awayGb } = teamIdsFromPm(platform, pm);
  if (!homeGb || !awayGb)
    return true; // 无映射时放行，靠人工意图
  // 找簇内任一有 gb 的馆做参照
  for (const [p, sid] of Object.entries(row.Matchs || {})) {
    if (p === platform)
      continue;
    const other = findPlatformMatch(matches, p, sid);
    if (!other)
      continue;
    const o = teamIdsFromPm(p, other);
    if (!o.homeGb || !o.awayGb)
      continue;
    return sameTeamPair(homeGb, awayGb, o.homeGb, o.awayGb);
  }
  return true;
}

/**
 * DB 人工绑定：校验同队对后挂 Matchs。
 * PB 同 rot 多 binding 时按 rotNum 选举，避免 last-wins 把主盘打回未开图 event。
 */
export function applyPlatformBindings(list, platformBindingsByClientId, matches = {}, opts = {}) {
  if (!platformBindingsByClientId?.size)
    return { list, skippedBindings: 0 };
  const bets = opts.bets || {};
  const pbCollapse = opts.pbRotnumCollapse ?? isComposerPbRotnumCollapse();
  const byId = new Map(list.map(r => [Number(r.ID), r]));
  let skippedBindings = 0;
  for (const [cmId, bindings] of platformBindingsByClientId.entries()) {
    const id = Number(cmId);
    let row = byId.get(id);
    if (!row) {
      row = {
        ID: id,
        MergeKey: `seed:${id}`,
        Matchs: {},
        Title: "",
        StartTime: 0,
        Game: "",
        GameID: "",
        BO: 0,
        Round: 0,
        RoundStart: 0,
        Reverse: [],
        Bets: [],
        _clusterBasis: "binding",
      };
      list.push(row);
      byId.set(id, row);
    }
    const listBindings = Array.isArray(bindings) ? bindings : [];
    const byPlat = new Map();
    for (const b of listBindings) {
      const plat = b.platform || b.Platform;
      const rawSid = b.source_match_id ?? b.SourceMatchID ?? b.sourceMatchId;
      if (!plat || rawSid == null || rawSid === "")
        continue;
      if (!byPlat.has(plat))
        byPlat.set(plat, []);
      byPlat.get(plat).push(String(rawSid));
    }
    for (const [plat, sids] of byPlat) {
      let sid = sids[sids.length - 1];
      if (plat === "PB" && pbCollapse) {
        const candidates = [...new Set([
          ...(row.Matchs?.PB ? [String(row.Matchs.PB)] : []),
          ...sids,
        ])];
        if (candidates.length > 1) {
          const sticky = row.Matchs?.PB != null && String(row.Matchs.PB) !== ""
            ? new Set([String(row.Matchs.PB)])
            : new Set();
          sid = pickPrimaryPbSourceId(candidates, matches, {
            bets,
            stickySourceMatchIds: sticky,
          }) || sid;
        }
      }
      if (Object.keys(row.Matchs || {}).length
        && !bindingCompatibleWithRow(row, plat, String(sid), matches)) {
        skippedBindings += 1;
        continue;
      }
      row.Matchs[plat] = String(sid);
    }
  }
  return {
    list: list.filter(r => Object.keys(r.Matchs || {}).length >= MIN_PLATFORMS),
    skippedBindings,
  };
}

export function clusterByGbThenName(matches, existingClientRows = [], opts = {}) {
  const collected = collectPlatformEntries(matches);
  const { entries: all } = collapsePbEntriesByRotNum(collected, {
    bets: opts.bets || {},
    existingClientRows,
    enabled: opts.pbRotnumCollapse ?? isComposerPbRotnumCollapse(),
  });
  const { rows: seedRows, used: seedUsed } = seedFromExisting(all, existingClientRows);

  const remain = all.filter(e => !seedUsed.has(e.rowKey));

  const idPhase = groupEntries(
    remain.filter(canUseIdKey),
    e => pairKeyId(e),
    startTimesCompatibleId,
    "id",
  );

  const afterId = remain.filter(e => !idPhase.used.has(e.rowKey));
  const namePhase = groupEntries(
    afterId.filter(canUseNameKey),
    e => pairKeyName(e),
    startTimesCompatibleName,
    "name",
  );

  let list = [...seedRows, ...idPhase.rows, ...namePhase.rows];
  // ④ 队名补合并：漏网馆贴场 + id/name 裂场再并
  const reconciled = reconcileClustersByName(list, all);
  list = reconciled.list;
  list.sort((a, b) => (a.StartTime || 0) - (b.StartTime || 0));
  return list;
}
