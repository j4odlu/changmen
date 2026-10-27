#!/usr/bin/env node
import { ensurePgPoolReady, fetchClientMatches, fetchPlatformBets } from "@changmen/db";
/**
 * 巡检 client_matches 与 platform_bets / matchMerge 预览是否一致。
 *
 *   node server/match/matcher/scripts/audit-client-sources.mjs           # 静态 + rebuild diff
 *   node server/match/matcher/scripts/audit-client-sources.mjs --quick # 仅静态规则
 *   node server/match/matcher/scripts/audit-client-sources.mjs --strict # 有问题 exit 1
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { composeOnce } from "../compose/compose_once.js";
import { swapBetSource } from "@changmen/matcher/compose/util/swap";

loadChangmenEnv();
process.env.CHANGMEN_DB_SCRIPT = process.env.CHANGMEN_DB_SCRIPT || "rds";

const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const strict = args.has("--strict");

await ensurePgPoolReady();

/** @type {import("@changmen/db").ClientMatchRow[]} */
const storedRows = (await fetchClientMatches()) || [];
const platformBets = await fetchPlatformBets();

const issues = [];

function findPlatformBet(platform, sourceMatchId, betId) {
  const block = platformBets[`${platform}:${sourceMatchId}`];
  if (!block?.bets)
    return null;
  return block.bets.find(b => String(b.SourceBetID) === String(betId)) || null;
}

function sourceFromRaw(platform, raw, reversed) {
  const base = {
    Type: platform,
    BetID: String(raw.SourceBetID),
    HomeID: String(raw.SourceHomeID || ""),
    AwayID: String(raw.SourceAwayID || ""),
    HomeOdds: Number(raw.HomeOdds) || 0,
    AwayOdds: Number(raw.AwayOdds) || 0,
    Status: raw.Status || "Normal",
  };
  return reversed ? swapBetSource(base) : base;
}

function oddsEqual(a, b, eps = 0.001) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function sourcesSignature(bets) {
  const out = {};
  for (const bet of bets || []) {
    const map = bet.Map ?? 0;
    out[map] = {};
    for (const [plat, src] of Object.entries(bet.Sources || {})) {
      out[map][plat] = {
        betId: String(src.BetID || ""),
        h: Number(src.HomeOdds) || 0,
        a: Number(src.AwayOdds) || 0,
      };
    }
  }
  return JSON.stringify(out);
}

// ── 静态：platform_bets vs client_matches Sources ─────────────────────────────
for (const row of storedRows) {
  const id = Number(row.id);
  const reverse = new Set(Array.isArray(row.reverse) ? row.reverse : []);
  const matchs = row.matchs || {};
  const round = Number(row.round) || 0;

  for (const [platform, sourceMatchId] of Object.entries(matchs)) {
    const hasAnySource = (row.bets || []).some(b => b.Sources?.[platform]);
    const block = platformBets[`${platform}:${sourceMatchId}`];
    if (block?.bets?.length && !hasAnySource) {
      issues.push({
        kind: "missing_sources",
        id,
        title: row.title,
        platform,
        detail: "Matchs 有平台且 platform_bets 非空，但 Bets 无该平台 Sources",
      });
    }
  }

  for (const bet of row.bets || []) {
    const map = bet.Map ?? 0;
    for (const [platform, src] of Object.entries(bet.Sources || {})) {
      const sourceMatchId = matchs[platform];
      if (!sourceMatchId) {
        issues.push({
          kind: "orphan_source",
          id,
          title: row.title,
          platform,
          map,
          detail: "Sources 含平台但 Matchs 无关联",
        });
        continue;
      }
      const raw = findPlatformBet(platform, sourceMatchId, src.BetID);
      if (!raw) {
        issues.push({
          kind: "stale_bet_id",
          id,
          title: row.title,
          platform,
          map,
          detail: `BetID ${src.BetID} 不在 platform_bets`,
        });
        continue;
      }
      const expected = sourceFromRaw(platform, raw, reverse.has(platform));
      if (!oddsEqual(src.HomeOdds, expected.HomeOdds) || !oddsEqual(src.AwayOdds, expected.AwayOdds)) {
        issues.push({
          kind: "odds_mismatch",
          id,
          title: row.title,
          platform,
          map,
          detail: `stored H/A=${src.HomeOdds}/${src.AwayOdds} expected ${expected.HomeOdds}/${expected.AwayOdds}${
            reverse.has(platform) ? " (Reverse)" : ""}`,
        });
      }
    }

    if (round > 0 && map === 0) {
      const keys = Object.keys(bet.Sources || {});
      const bad = keys.filter(p => p !== "OB" && p !== "Polymarket");
      if (bad.length) {
        issues.push({
          kind: "map0_trim",
          id,
          title: row.title,
          platform: bad.join(","),
          map: 0,
          detail: `Round=${round} 时 Map=0 应仅 OB/Polymarket 或空，实际: ${keys.join(",")}`,
        });
      }
    }
  }
}

// ── rebuild diff：composer 预览 vs RDS ───────────────────────────────────────
if (!quick) {
  const { info: preview } = await composeOnce({ write: false, registerTeams: false });
  const previewById = new Map(preview.map(m => [Number(m.ID), m]));
  const storedById = new Map(storedRows.map(r => [Number(r.id), r]));

  for (const [id, built] of previewById) {
    const stored = storedById.get(id);
    if (!stored)
      continue;
    const revBuilt = [...(built.Reverse || [])].sort().join(",");
    const revStored = [...(stored.reverse || [])].sort().join(",");
    if (revBuilt !== revStored) {
      issues.push({
        kind: "rebuild_reverse",
        id,
        title: built.Title,
        detail: `stored [${revStored}] vs preview [${revBuilt}]`,
      });
    }
    if (Number(built.Round) !== Number(stored.round)) {
      issues.push({
        kind: "rebuild_round",
        id,
        title: built.Title,
        detail: `stored Round=${stored.round} vs preview ${built.Round}`,
      });
    }
    const sigBuilt = sourcesSignature(built.Bets);
    const sigStored = sourcesSignature(stored.bets);
    if (sigBuilt !== sigStored) {
      issues.push({
        kind: "rebuild_sources",
        id,
        title: built.Title,
        detail: "Bets/Sources 与 matchMerge 预览不一致（可能 merge 未跑或输入已变）",
      });
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
console.log(`=== client_matches audit · ${storedRows.length} rows · ${issues.length} issue(s) ===\n`);

const byKind = new Map();
for (const issue of issues) {
  if (!byKind.has(issue.kind))
    byKind.set(issue.kind, []);
  byKind.get(issue.kind).push(issue);
}

for (const [kind, list] of byKind) {
  console.log(`--- ${kind} (${list.length}) ---`);
  for (const item of list.slice(0, 20)) {
    console.log(`  #${item.id} ${item.title || ""}${item.platform ? ` · ${item.platform}` : ""}${item.map != null ? ` map${item.map}` : ""}`);
    console.log(`    ${item.detail}`);
  }
  if (list.length > 20)
    console.log(`  ... +${list.length - 20} more`);
  console.log("");
}

if (!issues.length)
  console.log("OK — no issues found.");

if (strict && issues.length)
  process.exit(1);
