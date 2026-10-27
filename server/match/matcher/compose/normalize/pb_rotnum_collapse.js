/**
 * PB 同系列多 event → 合场只占一个 Matchs.PB 槽（交易主键仍是 event.id）。
 * 有 RotNum：同 rot 归组（changmen 扩展上报）。
 * 无 RotNum（A8）：live 图 + 未开图残留仍并成一场，主盘选滚球账本。
 */
import { normalizeTeam } from "@changmen/match-identity/teams/team_key.js";
import { collectPlatformEntries } from "./platform_entry.js";
import { betBucketKey } from "./native_bets.js";

export function readRotNum(pmOrEntry) {
  const raw = pmOrEntry?.rotNum
    ?? pmOrEntry?.RotNum
    ?? pmOrEntry?.rot_num
    ?? pmOrEntry?.nativeRow?.RotNum
    ?? pmOrEntry?.nativeRow?.rotNum
    ?? pmOrEntry?.nativeRow?.rot_num;
  const s = raw != null ? String(raw).trim() : "";
  return s;
}

export function isPbKillsName(home, away) {
  return /\(\s*Kills\s*\)/i.test(`${home || ""} ${away || ""}`);
}

function betRowsFor(bets, platform, sourceMatchId) {
  const block = bets?.[betBucketKey(platform, sourceMatchId)]
    || bets?.[`${platform}:${String(sourceMatchId)}`];
  if (!block)
    return [];
  if (Array.isArray(block))
    return block;
  return Array.isArray(block.bets) ? block.bets : [];
}

export function mapsFromBets(bets, platform, sourceMatchId) {
  const maps = new Set();
  for (const b of betRowsFor(bets, platform, sourceMatchId)) {
    const m = Number(b.Map ?? b.map);
    if (Number.isFinite(m))
      maps.add(m);
  }
  return maps;
}

function liveFlag(pm) {
  const raw = pm?.IsLive ?? pm?.isLive ?? pm?.live ?? pm?.is_live;
  if (raw === true || raw === 1 || raw === "1")
    return true;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "true")
    return true;
  return false;
}

export function isPbLiveLike(entry, bets = {}) {
  const pm = entry?.nativeRow && typeof entry.nativeRow === "object" ? entry.nativeRow : entry;
  if (liveFlag(pm))
    return true;
  return mapsFromBets(bets, entry.platform || "PB", entry.sourceMatchId).has(0);
}

function teamPairKey(entry) {
  const a = String(entry.homeN || normalizeTeam(entry.homeName || "") || "").trim();
  const b = String(entry.awayN || normalizeTeam(entry.awayName || "") || "").trim();
  if (!a || !b)
    return "";
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function gbPairKey(entry) {
  const a = String(entry.homeGb || "").trim();
  const b = String(entry.awayGb || "").trim();
  if (!a || !b || a === b)
    return "";
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function teamPairFromPm(pm) {
  const a = normalizeTeam(String(pm?.Home ?? pm?.home ?? "").trim());
  const b = normalizeTeam(String(pm?.Away ?? pm?.away ?? "").trim());
  if (!a || !b)
    return "";
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 同 rot 组是否撞号（异队）。半边有 gb、半边仅队名不同 → 仍撞号。 */
export function isPbRotGroupCollision(group) {
  const namePairs = new Set((group || []).map(teamPairKey).filter(Boolean));
  const gbPairs = new Set((group || []).map(gbPairKey).filter(Boolean));
  if (gbPairs.size > 1)
    return true;
  if (namePairs.size <= 1)
    return false;
  // 多名对：仅当全员有 gb 且同属一个 gb 对（队名异写）才合并
  const allHaveGb = (group || []).every(e => Boolean(gbPairKey(e)));
  return !(allHaveGb && gbPairs.size === 1);
}

function isUnstartedMapsOnly(entry, bets = {}) {
  if (isPbLiveLike(entry, bets))
    return false;
  const maps = mapsFromBets(bets, entry.platform || "PB", entry.sourceMatchId);
  if (!maps.size)
    return true;
  return ![...maps].some(m => m === 0);
}

function stickySetFromClientRows(existingClientRows) {
  const ids = new Set();
  for (const cm of existingClientRows || []) {
    const ended = cm?.ended_at ?? cm?.endedAt;
    if (ended != null && ended !== "")
      continue;
    const matchs = cm.matchs || cm.Matchs || {};
    const sid = matchs.PB;
    if (sid != null && sid !== "")
      ids.add(String(sid));
  }
  return ids;
}

/**
 * 主 event：粘性 → 升主盘（未开图 sticky + 同组 live）→ live/map0 → 稳定 id。
 */
export function pickPrimaryPbEntry(entries, {
  bets = {},
  stickySourceMatchIds = new Set(),
} = {}) {
  if (!entries?.length)
    return null;
  if (entries.length === 1)
    return entries[0];

  const sticky = entries.filter(e => stickySourceMatchIds.has(String(e.sourceMatchId)));
  const liveLike = entries.filter(e => isPbLiveLike(e, bets));

  if (sticky.length === 1) {
    const s = sticky[0];
    if (isUnstartedMapsOnly(s, bets)) {
      const live = liveLike.find(e => e.sourceMatchId !== s.sourceMatchId);
      if (live)
        return live;
    }
    return s;
  }
  if (sticky.length > 1) {
    const stickyLive = sticky.filter(e => isPbLiveLike(e, bets));
    if (stickyLive.length) {
      return [...stickyLive].sort((a, b) =>
        String(a.sourceMatchId).localeCompare(String(b.sourceMatchId)))[0];
    }
    return [...sticky].sort((a, b) =>
      String(a.sourceMatchId).localeCompare(String(b.sourceMatchId)))[0];
  }

  if (liveLike.length === 1)
    return liveLike[0];
  if (liveLike.length > 1) {
    return [...liveLike].sort((a, b) =>
      String(a.sourceMatchId).localeCompare(String(b.sourceMatchId)))[0];
  }

  return [...entries].sort((a, b) =>
    String(a.sourceMatchId).localeCompare(String(b.sourceMatchId)))[0];
}

export function pickPrimaryPbSourceId(sourceIds, matches, opts = {}) {
  const want = [...new Set((sourceIds || []).map(String).filter(Boolean))];
  if (!want.length)
    return "";
  if (want.length === 1)
    return want[0];
  const bucket = matches?.PB || {};
  const subset = {};
  for (const sid of want) {
    const pm = bucket[sid]
      || Object.values(bucket).find(m => String(m?.SourceMatchID) === sid);
    if (pm)
      subset[sid] = pm;
  }
  const entries = collectPlatformEntries({ PB: subset });
  const primary = pickPrimaryPbEntry(entries, opts);
  return primary?.sourceMatchId || want[want.length - 1];
}

function findPbMatch(matches, sourceMatchId) {
  const sid = String(sourceMatchId);
  const bucket = matches?.PB;
  if (!bucket || typeof bucket !== "object")
    return null;
  if (bucket[sid])
    return bucket[sid];
  return Object.values(bucket).find(m => String(m?.SourceMatchID) === sid) || null;
}

function sourceGameKey(pm) {
  return String(pm?.SourceGameID ?? pm?.GameID ?? "").trim();
}

/** 与 primary 同 rot 的其它 PB event.id（撞号 / Kills 排除） */
export function listPbRotNumSiblings(matches, primarySourceMatchId) {
  const primary = findPbMatch(matches, primarySourceMatchId);
  if (!primary)
    return [];
  const rot = readRotNum(primary);
  if (!rot)
    return [];
  if (isPbKillsName(primary.Home ?? primary.home, primary.Away ?? primary.away))
    return [];
  const game = sourceGameKey(primary);
  const pair = teamPairFromPm(primary);
  // 主场次队名不全则无法校验同队，不扩 sibling（防空名放行）
  if (!pair)
    return [];
  const out = [];
  for (const pm of Object.values(matches?.PB || {})) {
    const sid = String(pm?.SourceMatchID ?? "");
    if (!sid || sid === String(primarySourceMatchId))
      continue;
    if (readRotNum(pm) !== rot)
      continue;
    if (isPbKillsName(pm.Home ?? pm.home, pm.Away ?? pm.away))
      continue;
    const g = sourceGameKey(pm);
    if (game && g && game !== g)
      continue;
    const otherPair = teamPairFromPm(pm);
    if (!otherPair || otherPair !== pair)
      continue;
    out.push(sid);
  }
  return out;
}

/**
 * B1 投影用：Matchs.PB（主）+ 簇内 sibling + 同 rotNum 的其它 event.id。
 * 不含 Kills；不改 Matchs.PB。
 */
export function listPbEventIdsForProjection(row, matches) {
  const primary = String(row?.Matchs?.PB ?? row?.matchs?.PB ?? "").trim();
  if (!primary)
    return [];
  const out = new Set([primary]);
  for (const sid of row?._pbSiblingSourceMatchIds || []) {
    const s = String(sid || "").trim();
    if (s)
      out.add(s);
  }
  for (const sid of listPbRotNumSiblings(matches || {}, primary))
    out.add(sid);
  return [...out];
}

export function indexEntriesWithPbAliases(entries) {
  const byKey = new Map();
  for (const e of entries || []) {
    byKey.set(e.rowKey, e);
    for (const sid of e._pbSiblingSourceMatchIds || [])
      byKey.set(`PB:${sid}`, e);
  }
  return byKey;
}

function groupKey(entry) {
  return `${entry.GameID || entry.gameCode || ""}:${readRotNum(entry)}`;
}

function mergePbGroup(group, { bets, stickySourceMatchIds }) {
  const primary = pickPrimaryPbEntry(group, { bets, stickySourceMatchIds });
  const siblings = group
    .filter(e => e.sourceMatchId !== primary.sourceMatchId)
    .map(e => String(e.sourceMatchId));
  primary._pbSiblingSourceMatchIds = siblings;
  primary._pbRotNum = readRotNum(primary);
  // 用组内最早开赛时间聚类，避免 live event.time 偏离系列赛开打时间导致拆场
  const times = group.map(e => Number(e.startMs) || 0).filter(n => n > 0);
  if (times.length)
    primary.startMs = Math.min(...times);
  if (primary.clientMatchId == null) {
    const linked = group.find(e => e.clientMatchId != null && Number.isFinite(Number(e.clientMatchId)));
    if (linked)
      primary.clientMatchId = linked.clientMatchId;
  }
  return primary;
}

/**
 * A8 不上报 RotNum。开赛后 live event 新插入、赛前 event 仍留在库里，
 * 合场每馆只有一个 PB 槽：必须把滚球账本接到这场上，否则 UI 用赛前 HomeID 对 fo 全是锁盘。
 * 指纹：同一 game+队对，恰好一场 live-like + 其余未开图（无 map0）。
 * 只改 Matchs.PB 主盘选举；不把 sibling 交给投影层（那是 RotNum 拼未开图，属 changmen 扩展）。
 */
function collapsePbUnkeyedLivePrematch(entries, { bets, stickySourceMatchIds }) {
  const rest = [];
  const pb = [];
  for (const e of entries || []) {
    if (
      e.platform === "PB"
      && !readRotNum(e)
      && !isPbKillsName(e.homeName, e.awayName)
    ) {
      pb.push(e);
    }
    else {
      rest.push(e);
    }
  }

  const groups = new Map();
  for (const e of pb) {
    const pair = teamPairKey(e);
    if (!pair) {
      rest.push(e);
      continue;
    }
    const key = `${e.GameID || e.gameCode || ""}:${pair}`;
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push(e);
  }

  let skippedCollisions = 0;
  let collapsedGroups = 0;
  const collapsed = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    if (isPbRotGroupCollision(group)) {
      skippedCollisions += 1;
      collapsed.push(...group);
      continue;
    }
    const liveLike = group.filter(e => isPbLiveLike(e, bets));
    const unstarted = group.filter(e => isUnstartedMapsOnly(e, bets));
    if (liveLike.length !== 1 || unstarted.length < 1) {
      collapsed.push(...group);
      continue;
    }
    collapsed.push(mergePbGroup(group, { bets, stickySourceMatchIds }));
    collapsedGroups += 1;
  }

  return {
    entries: [...rest, ...collapsed],
    skippedCollisions,
    collapsedGroups,
  };
}

/**
 * @returns {{ entries: object[], skippedCollisions: number, collapsedGroups: number }}
 */
export function collapsePbEntriesByRotNum(entries, {
  bets = {},
  existingClientRows = [],
  enabled = true,
} = {}) {
  if (!enabled)
    return { entries: entries || [], skippedCollisions: 0, collapsedGroups: 0 };

  const stickySourceMatchIds = stickySetFromClientRows(existingClientRows);
  const rest = [];
  const pb = [];
  for (const e of entries || []) {
    if (
      e.platform === "PB"
      && readRotNum(e)
      && !isPbKillsName(e.homeName, e.awayName)
    ) {
      pb.push(e);
    }
    else {
      rest.push(e);
    }
  }

  const groups = new Map();
  for (const e of pb) {
    const key = groupKey(e);
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push(e);
  }

  let skippedCollisions = 0;
  let collapsedGroups = 0;
  const collapsed = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    if (isPbRotGroupCollision(group)) {
      skippedCollisions += 1;
      console.warn(
        `[match-composer] PB rotNum collision rot=${readRotNum(group[0])} `
        + `ids=${group.map(e => e.sourceMatchId).join(",")}`,
      );
      collapsed.push(...group);
      continue;
    }

    collapsed.push(mergePbGroup(group, { bets, stickySourceMatchIds }));
    collapsedGroups += 1;
  }

  const unkeyed = collapsePbUnkeyedLivePrematch([...rest, ...collapsed], {
    bets,
    stickySourceMatchIds,
  });
  skippedCollisions += unkeyed.skippedCollisions;
  collapsedGroups += unkeyed.collapsedGroups;

  if (collapsedGroups || skippedCollisions) {
    console.log(
      `[match-composer] PB rotNum collapse groups=${collapsedGroups} collisions=${skippedCollisions}`,
    );
  }

  return {
    entries: unkeyed.entries,
    skippedCollisions,
    collapsedGroups,
  };
}
