#!/usr/bin/env node
/**
 * Step2 只读巡检：证明 PB 可按 rot_num 认一场。
 *
 *   cd server/backend
 *   node scripts/ops/diagnostics/diag-pb-rotnum.mjs
 *   node scripts/ops/diagnostics/diag-pb-rotnum.mjs --api   # 再对照 part888 euro/odds
 *
 * 不改合场 / 不写库。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool, initDatabaseUrl } from "@changmen/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wantApi = process.argv.includes("--api");
const outDir = join(__dirname, "../../../../../.tmp/pb_rotnum_validate");

loadChangmenEnv();
process.env.DATABASE_RDS_TARGET = process.env.DATABASE_RDS_TARGET || "public";
await initDatabaseUrl();
await ensurePgPoolReady();
const pool = getPgPool();

function teamKey(home, away) {
  return `${String(home || "").trim()}|${String(away || "").trim()}`;
}

async function fetchEuroOdds(isLive) {
  const HOST = process.env.PB_ODDS_HOST || "https://www.part888.com";
  const BASE =
    "sportId=12&isHlE=false&oddsType=1&version=0&language=zh-cn&isHomePage=&leagueCode=&eventType=0&eSportCode=" +
    "&periodNum=0%2C1%2C2%2C3%2C4%2C5%2C6%2C7&participant=&locale=zh_CN";
  const ts = Date.now();
  const url =
    `${HOST}/sports-service/sv/euro/odds?${BASE}&isLive=${isLive ? "true" : "false"}` +
    `&timeStamp=${ts}&_=${ts}&withCredentials=true`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "changmen-diag-pb-rotnum/1",
      Referer: `${HOST}/zh-cn/compact/sports/e-sports`,
      Origin: HOST,
    },
  });
  if (!res.ok) throw new Error(`euro/odds HTTP ${res.status}`);
  return res.json();
}

function parseApiEvents(data, bucket) {
  const out = [];
  for (const lg of data?.leagues || []) {
    for (const ev of lg.events || []) {
      const parts = ev.participants || [];
      const home = parts.find((p) => p.type === "HOME");
      const away = parts.find((p) => p.type === "AWAY");
      if (!home || !away) continue;
      const hn = String(home.englishName || home.name || "");
      const an = String(away.englishName || away.name || "");
      const kills = /\(Kills\)/i.test(hn) || /\(Kills\)/i.test(an);
      const maps = [];
      for (const [k, p] of Object.entries(ev.periods || {})) {
        if (!/^\d+$/.test(k)) continue;
        const ml = p?.moneyLine;
        if (ml && !ml.unavailable) maps.push(Number(k));
      }
      out.push({
        bucket,
        id: String(ev.id),
        rotNum: String(ev.rotNum ?? "").trim(),
        home: hn,
        away: an,
        kills,
        game: lg.gameCode || "",
        maps: maps.sort((a, b) => a - b),
      });
    }
  }
  return out;
}

function analyzeApi(rows) {
  const nonK = rows.filter((r) => !r.kills);
  const byRot = new Map();
  for (const r of nonK) {
    if (!r.rotNum) continue;
    if (!byRot.has(r.rotNum)) byRot.set(r.rotNum, []);
    byRot.get(r.rotNum).push(r);
  }
  const multi = [];
  const collisions = [];
  for (const [rot, list] of byRot) {
    const teams = [...new Set(list.map((r) => teamKey(r.home, r.away)))];
    const ids = [...new Set(list.map((r) => r.id))];
    if (teams.length > 1) collisions.push({ rot, teams, ids });
    if (ids.length >= 2) {
      const liveMaps = [...new Set(list.filter((r) => r.bucket === "live").flatMap((r) => r.maps))];
      const preMaps = [...new Set(list.filter((r) => r.bucket === "prematch").flatMap((r) => r.maps))];
      const overlap = liveMaps.filter((m) => preMaps.includes(m));
      multi.push({
        rot,
        ids,
        teams,
        live_maps: liveMaps.sort((a, b) => a - b),
        pre_maps: preMaps.sort((a, b) => a - b),
        overlap,
        detail: list.map((r) => ({
          id: r.id,
          bucket: r.bucket,
          maps: r.maps,
          home: r.home,
          away: r.away,
        })),
      });
    }
  }
  return {
    counts: {
      events_total: rows.length,
      non_kills: nonK.length,
      kills: rows.length - nonK.length,
      empty_rot_non_kills: nonK.filter((r) => !r.rotNum).length,
      unique_rot: byRot.size,
      multi_id_rots: multi.length,
      collisions: collisions.length,
    },
    multi,
    collisions,
  };
}

const { rows: matches } = await pool.query(
  `SELECT source_match_id, rot_num, source_game_id, home, away, start_time, is_live,
          synced_at, match_id
   FROM platform_matches
   WHERE platform = 'PB'
   ORDER BY rot_num NULLS LAST, synced_at DESC NULLS LAST`,
);

const { rows: betMaps } = await pool.query(
  `SELECT source_match_id, array_agg(DISTINCT map ORDER BY map) AS maps
   FROM platform_bets
   WHERE platform = 'PB'
   GROUP BY source_match_id`,
);
const mapsById = new Map(betMaps.map((b) => [String(b.source_match_id), b.maps || []]));

const withRot = matches.filter((r) => r.rot_num != null && String(r.rot_num).trim() !== "");
const withoutRot = matches.filter((r) => r.rot_num == null || String(r.rot_num).trim() === "");

const byRot = new Map();
for (const r of withRot) {
  const rot = String(r.rot_num).trim();
  if (!byRot.has(rot)) byRot.set(rot, []);
  byRot.get(rot).push(r);
}

const collisions = [];
const multi = [];
for (const [rot, rows] of byRot) {
  const teams = [...new Set(rows.map((r) => teamKey(r.home, r.away)))];
  const games = [...new Set(rows.map((r) => String(r.source_game_id || "")))];
  if (teams.length > 1) {
    collisions.push({
      rot,
      teams,
      ids: rows.map((r) => String(r.source_match_id)),
    });
  }
  if (rows.length >= 2) {
    const detail = rows.map((r) => ({
      id: String(r.source_match_id),
      home: r.home,
      away: r.away,
      game: r.source_game_id,
      start_time: r.start_time,
      synced_at: r.synced_at,
      match_id: r.match_id,
      maps: mapsById.get(String(r.source_match_id)) || [],
    }));
    const mapSets = detail.map((d) => new Set(d.maps));
    let overlap = [];
    if (mapSets.length >= 2) {
      overlap = [...mapSets[0]].filter((m) => mapSets.every((s) => s.has(m)));
    }
    const cmIds = [...new Set(detail.map((d) => d.match_id).filter((x) => x != null))];
    multi.push({
      rot,
      n: rows.length,
      teams,
      games,
      map_overlap: overlap,
      client_match_ids: cmIds,
      bind_split: cmIds.length > 1,
      detail,
    });
  }
}

const byTeam = new Map();
for (const r of withRot) {
  const k = `${r.source_game_id}|${teamKey(r.home, r.away)}`;
  if (!byTeam.has(k)) byTeam.set(k, new Set());
  byTeam.get(k).add(String(r.rot_num).trim());
}
const sameTeamMultiRot = [...byTeam.entries()]
  .filter(([, rots]) => rots.size > 1)
  .map(([team, rots]) => ({ team, rots: [...rots] }));

/** 库内尚无 rot 时：用 API 反推当前 PB 行应如何归组 */
let expectedFromApi = null;
let apiReport = null;
if (wantApi) {
  const live = parseApiEvents(await fetchEuroOdds(true), "live");
  const pre = parseApiEvents(await fetchEuroOdds(false), "prematch");
  const apiRows = [...live, ...pre];
  apiReport = analyzeApi(apiRows);
  const byId = new Map(apiRows.filter((r) => !r.kills).map((r) => [r.id, r]));
  const groups = new Map();
  for (const m of matches) {
    const id = String(m.source_match_id);
    const api = byId.get(id);
    if (!api?.rotNum) continue;
    if (!groups.has(api.rotNum)) groups.set(api.rotNum, []);
    groups.get(api.rotNum).push({
      id,
      home: m.home,
      away: m.away,
      cm: m.match_id,
      api_bucket: api.bucket,
      api_maps: api.maps,
      api_home: api.home,
      api_away: api.away,
    });
  }
  expectedFromApi = {
    rds_ids_in_api: [...groups.values()].reduce((n, g) => n + g.length, 0),
    rds_ids_missing_in_api: matches
      .map((m) => String(m.source_match_id))
      .filter((id) => !byId.has(id)),
    groups: [...groups.entries()]
      .map(([rot, detail]) => ({
        rot,
        n: detail.length,
        teams: [...new Set(detail.map((d) => teamKey(d.api_home, d.api_away)))],
        map_overlap: (() => {
          const sets = detail.map((d) => new Set(d.api_maps || []));
          if (sets.length < 2) return [];
          return [...sets[0]].filter((m) => sets.every((s) => s.has(m)));
        })(),
        client_match_ids: [...new Set(detail.map((d) => d.cm).filter((x) => x != null))],
        detail,
      }))
      .filter((g) => g.n >= 2)
      .sort((a, b) => b.n - a.n),
  };
}

const coverage = matches.length ? Number(((withRot.length / matches.length) * 100).toFixed(1)) : 0;
const readyForStep3 =
  coverage >= 95 &&
  collisions.length === 0 &&
  (multi.length > 0 || (expectedFromApi?.groups?.length ?? 0) > 0);

const report = {
  fetched_at: new Date().toISOString(),
  step2_rules_ref: "client/web/docs/platforms/PB_ROTNUM_GROUPING.md",
  rds: {
    counts: {
      pb_total: matches.length,
      with_rot: withRot.length,
      without_rot: withoutRot.length,
      coverage_pct: coverage,
      unique_rots: byRot.size,
      multi_event_rots: multi.length,
      rot_team_collisions: collisions.length,
      same_team_multi_rot: sameTeamMultiRot.length,
      multi_bound_to_different_cm: multi.filter((m) => m.bind_split).length,
    },
    collisions,
    sameTeamMultiRot,
    multi,
    without_rot_sample: withoutRot.slice(0, 30).map((r) => ({
      id: String(r.source_match_id),
      home: r.home,
      away: r.away,
      game: r.source_game_id,
      synced_at: r.synced_at,
      match_id: r.match_id,
    })),
  },
  api: apiReport,
  expected_groups_if_rot_written: expectedFromApi,
  gate: {
    ready_for_step3_compose: readyForStep3,
    blockers: [
      ...(coverage < 95
        ? [`RDS rot_num coverage ${coverage}% < 95% — deploy/restart PB collect with RotNum`]
        : []),
      ...(collisions.length ? [`${collisions.length} rot_num team collision(s)`] : []),
      ...(withRot.length === 0 && !(expectedFromApi?.groups?.length)
        ? ["No multi-event evidence yet (need --api while PB live splits exist, or wait for rot writes)"]
        : []),
    ],
  },
};

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `diag_pb_rotnum_${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  rds: report.rds.counts,
  api: apiReport?.counts || null,
  expected_multi_groups: expectedFromApi?.groups?.length ?? null,
  gate: report.gate,
  wrote: outPath,
}, null, 2));

if (expectedFromApi?.groups?.length) {
  console.log("\n=== expected rot groups (API × current RDS ids) ===");
  for (const g of expectedFromApi.groups) {
    console.log(JSON.stringify(g));
  }
}
if (multi.length) {
  console.log("\n=== RDS multi-event rot groups ===");
  for (const g of multi) console.log(JSON.stringify(g));
}

await pool.end();
