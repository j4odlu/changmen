/**
 * PB ???? slug ??
 *
 * ?? euro/odds?live + prematch??????�?slug(englishName) + ????
 * ?? team_venue_maps?gb_team_id ????????????�? *
 * ?????? gamebet_backend/data/esport/platforms.json �?PB ?????? token�? * �?npm run account:import-platform ??????? to.txt?PB_GATEWAY/PB_TOKEN ?????�? *
 * ???? changmen/ �?team-resolver/ ??�? *   node team-resolver/scrapers/pb_scraper.mjs
 *   node team-resolver/scrapers/pb_scraper.mjs --dry-run
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { upsertTeamPlatformMapsBatched } from "@changmen/db";
import { requirePlatform } from "@changmen/venue-node";
import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog";
import { formatPbTeamPlatformId } from "@changmen/shared/catalog/pb_team_platform_id";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

import { loadAndCreatePlugin } from "../team_db.js";
const { loadPlatformsJsonSession, fetchEuroOdds } = requirePlatform(
  "PB", "node",
  "session.js",
);
const { parseEuroOddsPayload } = requirePlatform("PB", "node", "core.js");

const DRY_RUN = process.argv.includes("--dry-run");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** `${gameSlug}:${teamId}` �?{ gameSlug, teamId, teamName } */
function collectTeamsFromPayload(data) {
  const teams = new Map();
  const { matches } = parseEuroOddsPayload(data);
  for (const row of matches) {
    const gameSlug = String(row.gameCode || row.gameId || "").trim();
    if (!gameSlug) continue;
    for (const side of [row.home, row.away]) {
      if (!side?.id) continue;
      const key = `${gameSlug}:${side.id}`;
      if (teams.has(key)) continue;
      teams.set(key, {
        gameSlug,
        teamId: side.id,
        teamName: side.englishName || side.name || side.id,
      });
    }
  }
  return teams;
}

async function batchUpsert(rows) {
  if (!rows.length) return;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const end = Math.min(i + BATCH, rows.length);
    await upsertTeamPlatformMapsBatched(rows.slice(i, end), BATCH);
    process.stdout.write(`\r  ??�?${end} / ${rows.length} ?`);
    await sleep(100);
  }
  process.stdout.write("\n");
}

async function main() {
  console.log(
    DRY_RUN ? "[pb_scraper] ???dry-run????�? : "[pb_scraper] ?????????GAMEBET_DB_SCRIPT�?,
  );
  console.log("[pb_scraper] ?????platforms.json PB????????????");

  console.log("\n[pb_scraper] ?? PB ??...");
  const session = loadPlatformsJsonSession();
  console.log(`[pb_scraper] gateway: ${session.gateway}`);

  console.log("[pb_scraper] ?? euro/odds (live + prematch)...");
  const data = await fetchEuroOdds(session);
  const teams = collectTeamsFromPayload(data);
  console.log(`[pb_scraper] �?${teams.size} ??????`);

  console.log("\n[pb_scraper] ?? team_venue_maps ??...");
  const plugin = await loadAndCreatePlugin();

  const manualMapped = [];
  const platformOnly = [];
  const skipped = [];

  for (const { gameSlug, teamId, teamName } of teams.values()) {
    const gameCode = getGameCodeForPlatformId("PB", gameSlug);
    if (!gameCode || gameCode === "unknown") {
      skipped.push({ gameSlug, teamId, teamName });
      continue;
    }

    const gbTeamId = plugin.lookupById("PB", formatPbTeamPlatformId(gameSlug, teamId));
    const storedPlatformId = formatPbTeamPlatformId(gameSlug, teamId);
    const base = {
      venue: "PB",
      venue_team_id: storedPlatformId,
      venue_name: teamName,
      game: gameCode,
      source: "scraper",
    };
    if (gbTeamId) {
      manualMapped.push({ ...base, gb_team_id: Number(gbTeamId), confidence: 1.0 });
    } else {
      platformOnly.push({ ...base, gb_team_id: null, confidence: 0.0 });
    }
  }

  console.log(
    `\n[pb_scraper] ??????�?gb_team_id ${manualMapped.length} �?/ ????�?${platformOnly.length} �?/ ??(????�? ${skipped.length} ?`,
  );

  if (platformOnly.length > 0) {
    console.log("\n[pb_scraper] �?gb_team_id ???? 20 ??�?);
    platformOnly
      .slice(0, 20)
      .forEach((r) => console.log(`  [${r.game}] venue_team_id=${r.venue_team_id}  name="${r.venue_name}"`));
  }

  const toWrite = [...manualMapped, ...platformOnly];
  if (!DRY_RUN && toWrite.length > 0) {
    console.log(`\n[pb_scraper] ?? team_venue_maps�?{toWrite.length} ??...`);
    await batchUpsert(toWrite);
    console.log("[pb_scraper] ????");
  } else if (DRY_RUN) {
    console.log("\n[dry-run] ????????�?5 ??�?);
    platformOnly
      .slice(0, 5)
      .forEach((r) =>
        console.log(`  gb_team_id=NULL  [${r.game}] venue_team_id=${r.venue_team_id}  name="${r.venue_name}"`),
      );
  }

  console.log("\n�???");
}

main().catch((err) => {
  console.error("[pb_scraper] ????:", err.message);
  process.exit(1);
});
