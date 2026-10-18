"use strict";

/**
 * OB 平坰队伝 ID 爬虫
 *
 * 数杮来溝�? *   flag=6          �?全針历坲赛事（~2700 场，一次返回）
 *   flag=5 day=1~N  �?逝日已结束赛事（毝天 ~20 场，默认往�?60 天）
 *
 * 违行�? *   node ob_scraper.js                  # flag=6 + 过去 60 �? *   node ob_scraper.js --days=30        # flag=6 + 过去 30 �? *   node ob_scraper.js --no-flag6       # �?flag=5 逝日
 *   node ob_scraper.js --dry-run        # 坪打坰，丝写�? */

import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog";
import { loadAndCreatePlugin } from "../team_db.js";

loadChangmenEnv();

let login;
let obGet;

// ── CLI ───────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const NO_FLAG6 = process.argv.includes("--no-flag6");
const daysArg = (process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1];
const HISTORY_DAYS = daysArg ? Math.max(1, Number(daysArg) || 60) : 60;

const REQUEST_DELAY_MS = 300;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 坝称归一化（�?team_db.js 保挝一致） ─────────────────────────────────

function norm(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[·\-—_·•\s]+/g, " ")
    .replace(/[^\w\s一-鿿]/g, "")
    .trim()
    .replace(/\s+(?:esports?|gaming)$/i, "")
    .trim();
}

// ── OB 字段解枝 ──────────────────────────────────────────────────────────────

function cleanObText(v) {
  return String(v || "").replace(/&nbsp;/g, " ").trim();
}

/** �?game/index 一行杝坖两队信�?*/
function extractTeams(item) {
  const names = cleanObText(item.match_team).split(",").map((s) => s.trim()).filter(Boolean);
  const ids = String(item.team_id || "").split(",").map((s) => s.trim()).filter(Boolean);
  const gameId = String(item.game_id || "").trim();
  const result = [];
  for (let i = 0; i < Math.min(names.length, ids.length, 2); i++) {
    if (names[i] && ids[i]) result.push({ gameId, teamId: ids[i], teamName: names[i] });
  }
  return result;
}

// ── 抓坖函数 ──────────────────────────────────────────────────────────────────

/** flag=6：全針历坲赛事，一次性返回所�?*/
async function scrapeFlag6(session) {
  process.stdout.write("[ob_scraper] 抓坖 flag=6（全針历坲）...\n");
  const r = await obGet(session.gateway, "/game/index?game_id=0&flag=6&day=0", session.token, session.lang);
  if (r.json.status === "false") {
    console.log("  flag=6 失败:", r.json.data);
    return new Map();
  }
  const data = r.json.data || [];
  const teams = new Map();
  for (const item of data) {
    for (const t of extractTeams(item)) {
      const key = `${t.gameId}:${t.teamId}`;
      if (!teams.has(key)) teams.set(key, t);
    }
  }
  console.log(`  flag=6: ${data.length} 场赛�? ${teams.size} 个丝針夝队伝`);
  return teams;
}

/** flag=5 day=1~N：逝日已结束赛�?*/
async function scrapeFlag5(session, days) {
  const teams = new Map();
  process.stdout.write(`[ob_scraper] 抓坖 flag=5 day=1~${days}（逝日历坲�?..\n`);
  for (let day = 1; day <= days; day++) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const r = await obGet(
        session.gateway,
        `/game/index?game_id=0&flag=5&day=${day}`,
        session.token,
        session.lang
      );
      if (r.json.status === "false") {
        process.stdout.write(`\r  day=${day}: ${r.json.data} �?坜止`);
        break;
      }
      const data = r.json.data || [];
      for (const item of data) {
        for (const t of extractTeams(item)) {
          const key = `${t.gameId}:${t.teamId}`;
          if (!teams.has(key)) teams.set(key, t);
        }
      }
      process.stdout.write(`\r  day=${day}/${days}: ${data.length} �? 累计 ${teams.size} 个丝針夝队伝  `);
    } catch (err) {
      process.stdout.write(`\r  day=${day}: ERR ${err.message.slice(0, 50)}\n`);
    }
  }
  process.stdout.write("\n");
  return teams;
}

// ── 批針写库 ─────────────────────────────────────────────────────────────────

async function batchUpsert(rows) {
  if (!rows.length) return;
  const { upsertTeamPlatformMapsBatched } = await import("@changmen/db");
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const end = Math.min(i + BATCH, rows.length);
    await upsertTeamPlatformMapsBatched(rows.slice(i, end), BATCH);
    process.stdout.write(`\r  已写�?${end} / ${rows.length} 行`);
    await sleep(100);
  }
  process.stdout.write("\n");
}

// ── 主浝�?────────────────────────────────────────────────────────────────────

async function main() {
  const { requirePlatform } = await import("@changmen/venue-node-loader");
  ({ login, obGet } = requirePlatform("OB", "node", "session.js"));

  console.log(DRY_RUN ? "[ob_scraper] 模弝：dry-run（坪打坰�? : "[ob_scraper] 模弝：写入队伝表（GAMEBET_DB_SCRIPT�?);

  // 1. 登录
  console.log("\n[ob_scraper] 登录 OB...");
  const session = await login();
  console.log(`[ob_scraper] 已连�? ${session.gateway}`);

  // 2. 抓坖
  const allTeams = new Map();

  if (!NO_FLAG6) {
    const t6 = await scrapeFlag6(session);
    for (const [k, v] of t6) if (!allTeams.has(k)) allTeams.set(k, v);
    await sleep(REQUEST_DELAY_MS);
  }

  const t5 = await scrapeFlag5(session, HISTORY_DAYS);
  for (const [k, v] of t5) if (!allTeams.has(k)) allTeams.set(k, v);

  console.log(`\n[ob_scraper] 共抓�?${allTeams.size} 个丝針夝队伝`);

  // 3. 加载 team-resolver
  console.log("\n[ob_scraper] 加载 canonical_teams...");
  const plugin = await loadAndCreatePlugin();

  // 4. 解枝（gb_team_id 仅来自手动映�?lookupById�?  const manualMapped = [];
  const platformOnly = [];
  const skipped = [];

  for (const { gameId, teamId, teamName } of allTeams.values()) {
    const gameCode = getGameCodeForPlatformId("OB", gameId);
    if (!gameCode) { skipped.push({ gameId, teamId, teamName }); continue; }

    const gbTeamId = plugin.lookupById("OB", teamId);
    const base = {
      venue: "OB",
      venue_team_id: teamId,
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
    `\n[ob_scraper] 解枝结果：手�?gb_team_id ${manualMapped.length} / 仅平坰记�?${platformOnly.length} / 跳过(游戝超范�? ${skipped.length}`
  );

  if (platformOnly.length > 0) {
    console.log("\n[ob_scraper] �?gb_team_id 队伝（剝 20 条）�?);
    platformOnly.slice(0, 20).forEach((r) =>
      console.log(`  venue_team_id=${r.venue_team_id}  name="${r.venue_name}"`)
    );
  }

  // 5. 写库
  const toWrite = [...manualMapped, ...platformOnly];
  if (!DRY_RUN && toWrite.length > 0) {
    console.log(`\n[ob_scraper] 写入 team_venue_maps�?{toWrite.length} 行）...`);
    await batchUpsert(toWrite);
    console.log("[ob_scraper] 写入完戝");
  } else if (DRY_RUN) {
    console.log("\n[dry-run] 手动映射示例（剝 5 条）�?);
    manualMapped.slice(0, 5).forEach((r) =>
      console.log(`  gb_team_id=${r.gb_team_id}  venue_team_id=${r.venue_team_id}  name="${r.venue_name}"`)
    );
    if (platformOnly.length) {
      console.log("[dry-run] 仅平坰记录示例（�?5 条）�?);
      platformOnly.slice(0, 5).forEach((r) =>
        console.log(`  gb_team_id=NULL  venue_team_id=${r.venue_team_id}  name="${r.venue_name}"`)
      );
    }
  }

  console.log("\n�?完戝");
}

main().catch((err) => {
  console.error("[ob_scraper] 致命错误:", err.message);
  process.exit(1);
});
