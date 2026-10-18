import { formatTitle, isPlaceholderTeamName } from "./match_utils.js";
import { normalizeTeam } from "./team_key.js";

/** 平台优先级：数值越大，队名 / Title 越优先采用 */
const PROVIDER_PRIORITY = {
  OB: 10,
  RAY: 9,
  PB: 8,
  TF: 7,
  IA: 6,
  IMT: 5,
  IM: 4,
  Stake: 3,
  SABA: 3,
  XBet: 3,
  HG: 2,
};

/** canonical 主客 gb 锁初值：按序取第一个双侧 gb 已映射平台的 native 槽位（PF 最后兜底） */
const CANONICAL_ANCHOR_PLATFORMS = ["Polymarket", "OB", "RAY", "PredictFun"];

function providerPriority(platform) {
  return PROVIDER_PRIORITY[String(platform || "").trim()] || 0;
}

function sortByProviderPriority(rows, platformKey = "platform") {
  return [...(rows || [])].sort(
    (a, b) => providerPriority(b[platformKey]) - providerPriority(a[platformKey]),
  );
}

/** 从带 platform/home/away 的行中取最高优先级平台 */
function pickCanonicalPlatformRow(rows, platformKey = "platform") {
  const sorted = sortByProviderPriority(rows, platformKey);
  for (const row of sorted) {
    const home = String(row.home ?? row.Home ?? "").trim();
    const away = String(row.away ?? row.Away ?? "").trim();
    if (isPlaceholderTeamName(home) && isPlaceholderTeamName(away))
      continue;
    return { ...row, home, away, platform: row[platformKey] ?? row.platform };
  }
  return null;
}

function titleFromPlatformRow(row) {
  if (!row)
    return null;
  const home = String(row.home ?? row.Home ?? "").trim();
  const away = String(row.away ?? row.Away ?? "").trim();
  if (isPlaceholderTeamName(home) && isPlaceholderTeamName(away))
    return null;
  return formatTitle(home, away);
}

function resolveCanonicalNameForId(resolvers, platform, platformId) {
  const id = String(platformId ?? "").trim();
  if (!id)
    return null;
  const gbTeamId = resolvers.lookupGbTeamId(platform, id);
  if (!gbTeamId)
    return null;
  const name = String(resolvers.lookupCanonicalName(gbTeamId) || "").trim();
  if (!name || isPlaceholderTeamName(name))
    return null;
  return name;
}

/**
 * 按最高优先级平台的 canonical 主客取向解析队名。
 * 各平台 home/away 槽位可能颠倒（如 TF），需用队名对齐后再取对应 platform_id 映射。
 */
function resolveCanonicalSideNames(rows, resolvers) {
  if (!resolvers?.lookupGbTeamId || !resolvers?.lookupCanonicalName)
    return null;

  const sorted = sortByProviderPriority(rows);
  const ref = pickCanonicalPlatformRow(rows);
  if (!ref)
    return null;

  const refHome = normalizeTeam(ref.home);
  const refAway = normalizeTeam(ref.away);
  let home = null;
  let away = null;

  for (const row of sorted) {
    const platform = row.platform ?? row.Platform;
    const rowHome = normalizeTeam(row.home);
    const rowAway = normalizeTeam(row.away);
    const homeId = row.homeId ?? row.HomeID;
    const awayId = row.awayId ?? row.AwayID;

    if (!home && refHome) {
      if (rowHome === refHome)
        home = resolveCanonicalNameForId(resolvers, platform, homeId);
      else if (rowAway === refHome)
        home = resolveCanonicalNameForId(resolvers, platform, awayId);
    }
    if (!away && refAway) {
      if (rowAway === refAway)
        away = resolveCanonicalNameForId(resolvers, platform, awayId);
      else if (rowHome === refAway)
        away = resolveCanonicalNameForId(resolvers, platform, homeId);
    }
    if (home && away)
      break;
  }

  if (!home || !away)
    return null;
  if (normalizeTeam(home) === normalizeTeam(away))
    return null;

  return {
    platform: ref.platform,
    home,
    away,
    title: formatTitle(home, away),
    canonical: true,
  };
}

function teamsFromPlatformRows(rows, resolvers) {
  const canonical = resolveCanonicalSideNames(rows, resolvers);
  if (canonical)
    return canonical;

  const picked = pickCanonicalPlatformRow(rows);
  if (!picked)
    return null;
  return {
    platform: picked.platform,
    home: picked.home,
    away: picked.away,
    title: formatTitle(picked.home, picked.away),
  };
}

export {
  CANONICAL_ANCHOR_PLATFORMS,
  pickCanonicalPlatformRow,
  PROVIDER_PRIORITY,
  providerPriority,
  resolveCanonicalSideNames,
  sortByProviderPriority,
  teamsFromPlatformRows,
  titleFromPlatformRow,
};
