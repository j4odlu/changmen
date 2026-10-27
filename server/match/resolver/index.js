/**
 * team-resolver — 主入口
 *
 * 解析顺序：
 *   1. 本地缓存（cache/teams.json，TTL 7天）
 *   2. PandaScore（需 PANDASCORE_TOKEN 环境变量）
 */

import * as cache from "./cache.js";
import * as pandascore from "./providers/pandascore.js";
import { normalize } from "./normalize.js";

const ENABLE_ACRONYM_MATCHING = false;

export async function resolve(teamName, gameCode, opts = {}) {
  const normalizedName = normalize(teamName);
  if (!normalizedName) return null;

  if (!opts.forceRefresh) {
    const cached = cache.get(normalizedName, gameCode);
    if (cached && cached.source === "pandascore"
      && (ENABLE_ACRONYM_MATCHING || !String(cached.matchType || "").startsWith("acronym"))) {
      return { ...cached, source: "cache" };
    }
  }

  let result = null;

  if (pandascore.isConfigured()) {
    try {
      result = await pandascore.resolve(teamName, gameCode);
    } catch (err) {
      console.warn(`[pandascore] ${teamName}/${gameCode} 查询失败:`, err.message);
    }
  }

  if (result) {
    cache.set(normalizedName, gameCode, result);
  }

  return result;
}

export async function resolveMatch(homeTeam, awayTeam, gameCode, opts = {}) {
  const [home, away] = await Promise.all([
    resolve(homeTeam, gameCode, opts),
    resolve(awayTeam, gameCode, opts),
  ]);
  return { home, away };
}

export async function scoreMatchPair(matchA, matchB) {
  if (matchA.gameCode !== matchB.gameCode) {
    return { shouldMerge: false, confidence: 0, reason: "game_mismatch" };
  }

  const timeDiffMs = Math.abs((matchA.startTimeMs || 0) - (matchB.startTimeMs || 0));
  if (timeDiffMs > 30 * 60 * 1000) {
    return { shouldMerge: false, confidence: 0, reason: "time_too_far" };
  }

  const [resHomeA, resHomeB, resAwayA, resAwayB] = await Promise.all([
    resolve(matchA.home, matchA.gameCode),
    resolve(matchB.home, matchB.gameCode),
    resolve(matchA.away, matchA.gameCode),
    resolve(matchB.away, matchB.gameCode),
  ]);

  const homeMatch =
    resHomeA && resHomeB && resHomeA.id === resHomeB.id
      ? { same: true, score: Math.min(resHomeA.confidence, resHomeB.confidence) }
      : { same: false, score: 0 };

  const awayMatch =
    resAwayA && resAwayB && resAwayA.id === resAwayB.id
      ? { same: true, score: Math.min(resAwayA.confidence, resAwayB.confidence) }
      : { same: false, score: 0 };

  if (homeMatch.same && awayMatch.same) {
    const confidence = (homeMatch.score + awayMatch.score) / 2;
    return { shouldMerge: true, confidence, reason: "both_teams_matched" };
  }

  const [crossHomeA, crossHomeB] = [resHomeA, resAwayB];
  const [crossAwayA, crossAwayB] = [resAwayA, resHomeB];
  const crossHome = crossHomeA && crossHomeB && crossHomeA.id === crossHomeB.id;
  const crossAway = crossAwayA && crossAwayB && crossAwayA.id === crossAwayB.id;
  if (crossHome && crossAway) {
    const confidence =
      (Math.min(crossHomeA.confidence, crossHomeB.confidence) +
        Math.min(crossAwayA.confidence, crossAwayB.confidence)) /
      2;
    return { shouldMerge: true, confidence, reason: "both_teams_matched_reversed", reversed: true };
  }

  return { shouldMerge: false, confidence: 0, reason: "teams_not_resolved" };
}
