/**
 * 投影后不变式检查（测试与 dry-run 自检共用）。
 */
import { lookupGbTeamIdByPlatform } from "@changmen/match-identity/teams/team_key.js";
import { findPlatformMatch } from "./sides/orientation_lock.js";

export function checkHomeSlotConsistency(row, nativeByPlatformMap = {}) {
  const violations = [];
  const reverse = new Set(row.Reverse || []);
  for (const bet of row.Bets || []) {
    const mapNum = Number(bet.Map) || 0;
    for (const [platform, src] of Object.entries(bet.Sources || {})) {
      const key = `${platform}:${mapNum}`;
      const raw = nativeByPlatformMap[key];
      if (!raw) {
        const map0 = (row.Bets || []).find(b => (Number(b.Map) || 0) === 0)?.Sources?.[platform];
        if (mapNum !== 0 && map0
          && String(src.HomeID) === String(map0.HomeID)
          && String(src.AwayID) === String(map0.AwayID)) {
          continue;
        }
        // 决胜局拷贝后 Map0 可能已剥除该馆（PM）：对照 Map0 原生盘 + Reverse
        const map0Native = nativeByPlatformMap[`${platform}:0`];
        if (mapNum !== 0 && map0Native) {
          const shouldSwap = reverse.has(platform);
          const expectHome = shouldSwap ? String(map0Native.AwayID ?? "") : String(map0Native.HomeID ?? "");
          const expectAway = shouldSwap ? String(map0Native.HomeID ?? "") : String(map0Native.AwayID ?? "");
          if (String(src.HomeID ?? "") === expectHome && String(src.AwayID ?? "") === expectAway)
            continue;
        }
        violations.push(`#${row.ID} ${key}: missing native for I1 check`);
        continue;
      }
      const shouldSwap = reverse.has(platform);
      const expectHome = shouldSwap ? String(raw.AwayID ?? "") : String(raw.HomeID ?? "");
      const expectAway = shouldSwap ? String(raw.HomeID ?? "") : String(raw.AwayID ?? "");
      if (String(src.HomeID ?? "") !== expectHome || String(src.AwayID ?? "") !== expectAway) {
        violations.push(
          `#${row.ID} ${key}: Home/Away mismatch reverse=${shouldSwap}`
          + ` got=${src.HomeID}/${src.AwayID} expect=${expectHome}/${expectAway}`,
        );
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function checkReverseSubsetOfSources(row) {
  const platforms = new Set();
  for (const bet of row.Bets || []) {
    for (const p of Object.keys(bet.Sources || {}))
      platforms.add(p);
  }
  const violations = [];
  for (const p of row.Reverse || []) {
    if (!platforms.has(p))
      violations.push(`#${row.ID}: Reverse has ${p} but no Sources`);
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Bets 的局段必须来自赛制层。shape 只会删行不会加行，故用子集而非相等。
 * 触发即说明有人绕开 resolveMatchStructure 造了 Bet 行。
 */
export function checkBetsWithinPeriods(row) {
  const periods = row?._periods;
  if (!Array.isArray(periods))
    return { ok: true, violations: [], skipped: true };
  const allowed = new Set(periods.map(p => Number(p) || 0));
  const violations = [];
  for (const bet of row.Bets || []) {
    const mapNum = Number(bet.Map) || 0;
    if (!allowed.has(mapNum))
      violations.push(`#${row.ID}: Map=${mapNum} not in periods [${periods.join(",")}]`);
  }
  return { ok: violations.length === 0, violations };
}

export function resolveOidToGb(platform, oid, raw, pm) {
  if (!oid || !raw || !pm)
    return null;
  const o = String(oid);
  const homeVenueId = String(pm.HomeID ?? pm.home_id ?? pm.SourceHomeID ?? "").trim();
  const awayVenueId = String(pm.AwayID ?? pm.away_id ?? pm.SourceAwayID ?? "").trim();
  if (o === String(raw.HomeID ?? "")) {
    return homeVenueId ? String(lookupGbTeamIdByPlatform(platform, homeVenueId) || "") || null : null;
  }
  if (o === String(raw.AwayID ?? "")) {
    return awayVenueId ? String(lookupGbTeamIdByPlatform(platform, awayVenueId) || "") || null : null;
  }
  return null;
}

export function checkNotSamePhysicalSide(row, {
  platformA,
  slotA,
  platformB,
  slotB,
  nativeByPlatformMap,
  matches,
  map = 0,
} = {}) {
  const bet = (row.Bets || []).find(b => (Number(b.Map) || 0) === map);
  const srcA = bet?.Sources?.[platformA];
  const srcB = bet?.Sources?.[platformB];
  if (!srcA || !srcB)
    return { ok: true, violations: [], skipped: true };

  const rawA = nativeByPlatformMap[`${platformA}:${map}`];
  const rawB = nativeByPlatformMap[`${platformB}:${map}`];
  const pmA = findPlatformMatch(matches, platformA, row.Matchs?.[platformA]);
  const pmB = findPlatformMatch(matches, platformB, row.Matchs?.[platformB]);
  if (!rawA || !rawB || !pmA || !pmB)
    return { ok: true, violations: [], skipped: true };

  const oidA = String(srcA[`${slotA}ID`] ?? "");
  const oidB = String(srcB[`${slotB}ID`] ?? "");
  const gbA = resolveOidToGb(platformA, oidA, rawA, pmA);
  const gbB = resolveOidToGb(platformB, oidB, rawB, pmB);

  const violations = [];
  if (gbA && gbB && gbA === gbB) {
    violations.push(
      `#${row.ID}: same gb ${gbA} via ${platformA}.${slotA}=${oidA} + ${platformB}.${slotB}=${oidB}`,
    );
  }
  return { ok: violations.length === 0, violations, gbA, gbB };
}

export function checkSourcesMatchLockTeams(row, {
  matches,
  nativeByPlatformMap,
  map = 0,
} = {}) {
  const homeGb = String(row.HomeGbTeamId || "");
  const awayGb = String(row.AwayGbTeamId || "");
  if (!homeGb || !awayGb)
    return { ok: true, violations: [], skipped: true };

  const bet = (row.Bets || []).find(b => (Number(b.Map) || 0) === map);
  const violations = [];
  for (const [platform, src] of Object.entries(bet?.Sources || {})) {
    const raw = nativeByPlatformMap[`${platform}:${map}`];
    const pm = findPlatformMatch(matches, platform, row.Matchs?.[platform]);
    if (!raw || !pm)
      continue;
    const h = resolveOidToGb(platform, src.HomeID, raw, pm);
    const a = resolveOidToGb(platform, src.AwayID, raw, pm);
    if (h && h !== homeGb)
      violations.push(`#${row.ID} ${platform}: Home slot gb=${h} ≠ lock home=${homeGb}`);
    if (a && a !== awayGb)
      violations.push(`#${row.ID} ${platform}: Away slot gb=${a} ≠ lock away=${awayGb}`);
  }
  return { ok: violations.length === 0, violations };
}

export function checkUnlockedEmpty(row) {
  const violations = [];
  if (!row.HomeGbTeamId && !row.AwayGbTeamId) {
    if (Array.isArray(row.Reverse) && row.Reverse.length)
      violations.push(`#${row.ID}: unlocked but Reverse nonempty`);
    for (const bet of row.Bets || []) {
      if (Object.keys(bet.Sources || {}).length)
        violations.push(`#${row.ID}: unlocked but Sources nonempty map=${bet.Map}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
