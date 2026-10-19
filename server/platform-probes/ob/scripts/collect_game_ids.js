#!/usr/bin/env node
/**
 * 从 OB game/index + CDN pc.json 收集 game_id，合并到 ob_game_ids.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Core from "../core.js";
import { login, obGet } from "../session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../data/ob_game_ids.json");
const PC_JSON = "https://uphw-cdn4.shudarong.com/upload/json/pc.json";

function cleanLeague(name) {
  return String(name || "").replace(/&nbsp;/g, " ").trim();
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const session = await login();
  const index = await obGet(
    session.gateway,
    "/game/index?game_id=0&flag=1&day=1",
    session.token,
    session.lang,
  );
  const matches = Core.normalizeGameIndex(index.json);

  const live = {};
  for (const m of matches) {
    const id = String(m.gameId);
    if (!live[id]) live[id] = { count: 0, leagues: new Set() };
    live[id].count += 1;
    live[id].leagues.add(cleanLeague(m.raw?.tournament_cn_name).slice(0, 48));
  }

  let pcIds = [];
  try {
    const res = await fetch(PC_JSON);
    const pc = await res.json();
    pcIds = Object.keys(pc.game_imag || {});
  } catch (err) {
    console.warn("pc.json fetch failed:", err.message);
  }

  const allIds = new Set([...Object.keys(catalog.games), ...pcIds, ...Object.keys(live)]);

  for (const id of allIds) {
    if (!catalog.games[id]) {
      catalog.games[id] = {
        name: "待确认",
        nameEn: "Unknown",
        code: "unknown",
        verified: false,
        hints: [],
      };
    }
    const rec = catalog.games[id];
    const leagues = live[id] ? [...live[id].leagues] : [];
    const merged = new Set([...(rec.hints || []), ...leagues]);
    rec.hints = [...merged].slice(0, 8);
    if (live[id]) rec.liveMatchCount = live[id].count;
    rec.inCdn = pcIds.includes(id);
  }

  catalog.updatedAt = new Date().toISOString();
  fs.writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  const verified = Object.values(catalog.games).filter((g) => g.verified).length;
  console.log(
    JSON.stringify(
      {
        total: allIds.size,
        verified,
        liveGames: Object.keys(live).length,
        output: OUT,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
