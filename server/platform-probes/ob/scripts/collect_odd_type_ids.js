#!/usr/bin/env node
/**
 * Discover OB match_winner odd_type_id per game (full / map).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import gameCatalog from "@changmen/shared/catalog/game_catalog.json" with { type: "json" };
import { login, obGet } from "../session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const games = gameCatalog.games;
const CATALOG_PATH = require.resolve("@changmen/shared/catalog/market_catalog.json");
const OUT_PATH = path.join(__dirname, "../data/ob_odd_type_ids.json");

function cleanText(v) {
  return String(v ?? "").replace(/&nbsp;/g, " ").trim();
}

function classifyWinnerMarket(raw) {
  const cn = cleanText(raw.cn_name);
  const en = cleanText(raw.en_name).toLowerCase();
  if (cn.includes("+")) return null;
  const odds = Object.values(raw.odds || {});
  const names = new Set(odds.map((o) => cleanText(o.name)));
  if (!names.has("@T1") || !names.has("@T2")) return null;
  if (/^ȫ��\s*-\s*��ʤ$/.test(cn) || en === "match winner") return "full";
  if (/^����\s*-\s*��ʤ$/.test(cn) || en === "map winner") return "map";
  return null;
}

async function fetchIndexRows(session, gameId) {
  const rows = [];
  const seen = new Set();
  const queries = [
    [1, 1],
    [1, 0],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
    [2, 5],
    [2, 6],
    [2, 7],
    [3, 1],
    [4, 1],
    [5, 0],
    [5, 1],
    [0, 0],
  ];
  for (const [flag, day] of queries) {
    try {
      const r = await obGet(
        session.gateway,
        `/game/index?game_id=${gameId}&flag=${flag}&day=${day}`,
        session.token,
        session.lang,
      );
      for (const m of r.json.data || []) {
        const id = String(m.id);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(m);
      }
    } catch {
      /* skip failed index query */
    }
    await sleep(100);
  }
  return rows;
}

async function fetchGameViewRaw(session, matchId, stageId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await sleep(500 * (attempt + 1));
      const r = await obGet(
        session.gateway,
        `/game/view?match_id=${matchId}&stage_id=${stageId}`,
        session.token,
        session.lang,
      );
      if (r.json.status === "false") {
        throw new Error(r.json.data || "game/view failed");
      }
      return r.json.data || [];
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverForGame(session, game) {
  const gameId = game.platforms.OB;
  const result = {
    code: game.code,
    name: game.name,
    gameId,
    matchCount: 0,
    sample: null,
    full: null,
    map: null,
    error: null,
  };

  try {
    const matches = await fetchIndexRows(session, gameId);
    result.matchCount = matches.length;
    if (!matches.length) {
      result.error = "no matches in index";
      return result;
    }

    matches.sort(
      (a, b) =>
        (b.is_live === 2) - (a.is_live === 2) || Number(b.bo) - Number(a.bo),
    );
    const pick = matches.find((m) => Number(m.bo) >= 2) || matches[0];
    result.sample = {
      matchId: String(pick.id),
      bo: Number(pick.bo),
      teams: cleanText(pick.match_team),
      isLive: pick.is_live,
    };

    const bo = Math.max(1, Number(pick.bo) || 1);
    const stages = [0];
    for (let i = 1; i <= Math.min(bo, 3); i += 1) stages.push(i);

    for (const stageId of stages) {
      const rows = await fetchGameViewRaw(session, String(pick.id), stageId);
      for (const row of rows) {
        const kind = classifyWinnerMarket(row);
        if (!kind) continue;
        const rec = {
          odd_type_id: String(row.odd_type_id),
          cn_name: cleanText(row.cn_name),
          en_name: cleanText(row.en_name),
          round: row.round,
          stageId,
          sort_code: row.sort_code,
          option_type: row.option_type,
        };
        if (kind === "full" && !result.full) result.full = rec;
        if (kind === "map" && !result.map) result.map = rec;
      }
      await sleep(200);
    }

    if (!result.full || !result.map) {
      result.error = "winner markets not found in sampled match";
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

function toGameOddTypes(discovery) {
  const entry = {};
  if (discovery.full?.odd_type_id) entry.full = discovery.full.odd_type_id;
  if (discovery.map?.odd_type_id) entry.map = discovery.map.odd_type_id;
  if (discovery.sample?.matchId) {
    entry.verifiedMatchId = discovery.sample.matchId;
  }
  entry.verifiedAt = new Date().toISOString().slice(0, 10);
  return entry;
}

function writeCatalog(discoveries) {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const market = catalog.markets.find((m) => m.code === "match_winner");
  if (!market?.platforms?.OB) {
    throw new Error("match_winner.OB not found in market_catalog.json");
  }
  market.platforms.OB.gameOddTypes = market.platforms.OB.gameOddTypes || {};
  for (const d of discoveries) {
    if (!d.full?.odd_type_id || !d.map?.odd_type_id) continue;
    market.platforms.OB.gameOddTypes[d.code] = toGameOddTypes(d);
  }
  catalog.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function main() {
  const write = process.argv.includes("--write");
  const session = await login();
  const discoveries = [];

  for (const game of games) {
    if (!game.platforms?.OB) continue;
    const d = await discoverForGame(session, game);
    discoveries.push(d);
    console.error(
      `[${d.code}] full=${d.full?.odd_type_id || "-"} map=${d.map?.odd_type_id || "-"} ${d.error || "ok"}`,
    );
  }

  const report = {
    fetchedAt: new Date().toISOString(),
    provider: "OB",
    marketCode: "match_winner",
    games: discoveries,
  };

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (write) {
    writeCatalog(discoveries);
    console.error(`Updated ${CATALOG_PATH}`);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
