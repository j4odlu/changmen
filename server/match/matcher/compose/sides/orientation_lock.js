/**
 * 场次主客锁：PM → OB → RAY → PredictFun（后者仅兜底，纯 PF/Limitless+PF 合场可建锁）。
 * 禁止 min/max；不采信 row 上脏 gb；后到高优先级 upgrade。
 */
import {
  lookupCanonicalTeamName,
  lookupGbTeamIdByPlatform,
  normalizeTeam,
} from "@changmen/match-identity/teams/team_key.js";
import { parseTitleTeams } from "@changmen/match-identity/teams/match_utils.js";
import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog";
import { resolvePlatformTeamId } from "@changmen/shared/catalog/pb_team_platform_id";

export const LOCK_ANCHOR_PLATFORMS = ["Polymarket", "OB", "RAY", "PredictFun"];

function parseLockedGb(value) {
  if (value == null || value === "")
    return null;
  const s = String(value).trim();
  return s || null;
}

export function findPlatformMatch(matches, platform, sourceMatchId) {
  const bucket = matches?.[platform];
  if (!bucket || sourceMatchId == null)
    return null;
  const sid = String(sourceMatchId);
  return bucket[sid] || Object.values(bucket).find(m => String(m.SourceMatchID) === sid) || null;
}

export function teamIdsFromPm(platform, pm) {
  const sourceGameId = pm.SourceGameID ?? pm.GameID;
  const gameCode = getGameCodeForPlatformId(platform, sourceGameId);
  const homeIdRaw = String(pm.HomeID ?? pm.home_id ?? pm.SourceHomeID ?? "").trim();
  const awayIdRaw = String(pm.AwayID ?? pm.away_id ?? pm.SourceAwayID ?? "").trim();
  const homeId = resolvePlatformTeamId(platform, homeIdRaw, sourceGameId, gameCode);
  const awayId = resolvePlatformTeamId(platform, awayIdRaw, sourceGameId, gameCode);
  const homeGb = homeId ? parseLockedGb(lookupGbTeamIdByPlatform(platform, homeId)) : null;
  const awayGb = awayId ? parseLockedGb(lookupGbTeamIdByPlatform(platform, awayId)) : null;
  return { homeGb, awayGb, homeId, awayId, gameCode };
}

export function pickLockFromAnchors(matchs, matches) {
  for (const platform of LOCK_ANCHOR_PLATFORMS) {
    const sourceMatchId = matchs?.[platform];
    if (sourceMatchId == null || sourceMatchId === "")
      continue;
    const pm = findPlatformMatch(matches, platform, sourceMatchId);
    if (!pm)
      continue;
    const { homeGb, awayGb } = teamIdsFromPm(platform, pm);
    if (!homeGb || !awayGb || homeGb === awayGb)
      continue;
    return { homeGb, awayGb, anchorPlatform: platform };
  }
  return null;
}

function titleFromLock(homeGb, awayGb, fallbackTitle) {
  const homeName = lookupCanonicalTeamName(homeGb) || parseTitleTeams(fallbackTitle)?.home;
  const awayName = lookupCanonicalTeamName(awayGb) || parseTitleTeams(fallbackTitle)?.away;
  if (!homeName || !awayName)
    return fallbackTitle || "";
  return `${String(homeName).trim()} vs ${String(awayName).trim()}`;
}

export function sameTeamPair(homeA, awayA, homeB, awayB) {
  if (!homeA || !awayA || !homeB || !awayB)
    return false;
  return (homeA === homeB && awayA === awayB)
    || (homeA === awayB && awayA === homeB);
}

function sameOrientation(homeA, awayA, homeB, awayB) {
  return homeA === homeB && awayA === awayB;
}

function applyLock(row, homeGb, awayGb, lockSource, fallbackTitle) {
  row.HomeGbTeamId = homeGb;
  row.AwayGbTeamId = awayGb;
  row.Title = titleFromLock(homeGb, awayGb, fallbackTitle);
  row._lockAnchor = lockSource;
  delete row._clearGbLock;
  return { homeGb, awayGb, locked: true, lockSource };
}

function clearLock(row, matches) {
  row.HomeGbTeamId = undefined;
  row.AwayGbTeamId = undefined;
  row._lockAnchor = null;
  row._clearGbLock = true;
  for (const platform of [...LOCK_ANCHOR_PLATFORMS, "IA", "PB", "TF"]) {
    const sid = row.Matchs?.[platform];
    if (!sid)
      continue;
    const pm = findPlatformMatch(matches, platform, sid);
    if (!pm)
      continue;
    const home = String(pm.Home ?? pm.home ?? "").trim();
    const away = String(pm.Away ?? pm.away ?? "").trim();
    if (home && away) {
      row.Title = `${home} vs ${away}`;
      break;
    }
  }
  return { homeGb: null, awayGb: null, locked: false, lockSource: null };
}

export function isStickyOrientationEnabled(opts = {}) {
  if (opts.stickyOrientation === true)
    return true;
  if (opts.stickyOrientation === false)
    return false;
  if (opts.forceReanchorOrientation === true)
    return false;
  const v = process.env.MATCH_COMPOSER_STICKY_ORIENTATION
    || process.env.MATCH_PROJECTOR_STICKY_ORIENTATION
    || "";
  return String(v).trim() === "1";
}

export function resolveOrientationLock(row, matches, existingRow, opts = {}) {
  const forceReanchorOrientation = opts.forceReanchorOrientation === true
    || String(process.env.MATCH_COMPOSER_REANCHOR || "").trim() === "1"
    || String(process.env.MATCH_PROJECTOR_REANCHOR || "").trim() === "1";
  const stickyOrientation = isStickyOrientationEnabled({
    ...opts,
    forceReanchorOrientation,
  });

  const existingHome = parseLockedGb(existingRow?.home_gb_team_id ?? existingRow?.HomeGbTeamId);
  const existingAway = parseLockedGb(existingRow?.away_gb_team_id ?? existingRow?.AwayGbTeamId);
  const anchor = pickLockFromAnchors(row.Matchs, matches);
  const fallbackTitle = row.Title || existingRow?.title;

  if (existingHome && existingAway && existingHome !== existingAway) {
    if (anchor) {
      if (!sameTeamPair(existingHome, existingAway, anchor.homeGb, anchor.awayGb)) {
        return applyLock(
          row,
          anchor.homeGb,
          anchor.awayGb,
          `reanchor:${anchor.anchorPlatform}`,
          fallbackTitle,
        );
      }
      const orientDiffers = !sameOrientation(
        existingHome,
        existingAway,
        anchor.homeGb,
        anchor.awayGb,
      );
      if (orientDiffers && (forceReanchorOrientation || !stickyOrientation)) {
        return applyLock(
          row,
          anchor.homeGb,
          anchor.awayGb,
          `upgrade:${anchor.anchorPlatform}`,
          fallbackTitle,
        );
      }
      return applyLock(row, existingHome, existingAway, "existing", fallbackTitle);
    }
    const hasAnchorSlot = LOCK_ANCHOR_PLATFORMS.some(
      p => row.Matchs?.[p] != null && row.Matchs[p] !== "",
    );
    if (hasAnchorSlot)
      return applyLock(row, existingHome, existingAway, "existing-gap", fallbackTitle);
  }

  if (anchor)
    return applyLock(row, anchor.homeGb, anchor.awayGb, anchor.anchorPlatform, fallbackTitle);

  return clearLock(row, matches);
}

/**
 * @param {{ home?: string, away?: string }} [lockNames] 锁两侧队名的免插件来源（持久化标题）。
 *   队名兜底不得只依赖 lookupCanonicalTeamName，否则与 gb 主路径共用 team-resolver，
 *   插件缺失时两条通道一起断，整场源清空。
 */
export function sideModeAgainstLock(platform, pm, homeGb, awayGb, lockNames) {
  if (!homeGb || !awayGb || !pm)
    return "ambiguous";
  const { homeGb: ph, awayGb: pa } = teamIdsFromPm(platform, pm);
  if (ph && pa) {
    if (ph === homeGb && pa === awayGb)
      return "aligned";
    if (ph === awayGb && pa === homeGb)
      return "reversed";
    return "ambiguous";
  }
  const phN = normalizeTeam(pm.Home ?? pm.home);
  const paN = normalizeTeam(pm.Away ?? pm.away);
  const ch = normalizeTeam(lookupCanonicalTeamName(homeGb) || lockNames?.home || "");
  const ca = normalizeTeam(lookupCanonicalTeamName(awayGb) || lockNames?.away || "");
  if (!phN || !paN || !ch || !ca)
    return "ambiguous";
  if (phN === ch && paN === ca)
    return "aligned";
  if (phN === ca && paN === ch)
    return "reversed";
  return "ambiguous";
}

export { parseLockedGb, titleFromLock };
