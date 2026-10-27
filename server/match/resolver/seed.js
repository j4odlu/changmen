/**
 * 冷启动脚本：用 PandaScore 数据填充 canonical_teams（含 acronym 字段）
 *
 * 运行：
 *   PANDASCORE_TOKEN=xxx node seed.js
 *   node seed.js --dry-run     仅打印，不写库
 *   node seed.js --game=lol    只跑一个游戏
 */

import { loadChangmenEnv } from "@changmen/storage/load_env";
import axios from "axios";

loadChangmenEnv();

const PANDASCORE_TOKEN = process.env.PANDASCORE_TOKEN || "";

const DRY_RUN = process.argv.includes("--dry-run");
const GAME_FILTER = (process.argv.find((a) => a.startsWith("--game=")) || "").split("=")[1] || null;

const GAMES = {
  lol:      "lol",
  cs2:      "csgo",
  dota2:    "dota2",
  valorant: "valorant",
};

// ── PandaScore ────────────────────────────────────────────────────────────────

async function fetchTeamsPage(psEndpoint, page) {
  const url =
    `https://api.pandascore.co/${psEndpoint}/teams` +
    `?token=${PANDASCORE_TOKEN}&per_page=100&page=${page}&sort=-modified_at`;
  const res = await axios.get(url, { timeout: 10000 });
  return res.data || [];
}

async function fetchAllTeams(psEndpoint) {
  const result = [];
  for (let page = 1; ; page++) {
    const teams = await fetchTeamsPage(psEndpoint, page);
    if (!teams.length) break;
    result.push(...teams);
    await sleep(300);
    if (teams.length < 100) break;
  }
  return result.filter((t) => t.acronym && t.name);
}

// ── RDS ──────────────────────────────────────────────────────────────────────

async function batchUpsertCanonical(rows) {
  const { upsertCanonicalTeams } = await import("@changmen/db");
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await upsertCanonicalTeams(chunk);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`  [batch ${i}] attempt ${attempt + 1} 失败:`, e.message);
        await sleep(1000 * (attempt + 1));
      }
    }
    if (lastErr) throw lastErr;
    await sleep(100);
  }
}

// ── 核心逻辑 ──────────────────────────────────────────────────────────────────

async function seedGame(gameCode, psEndpoint) {
  console.log(`\n[${gameCode}] 拉取 PandaScore 数据...`);
  const teams = await fetchAllTeams(psEndpoint);
  console.log(`  获取 ${teams.length} 支有效队伍`);

  if (DRY_RUN) {
    teams.slice(0, 5).forEach((t) =>
      console.log(`  示例: id=${t.id}  name="${t.name}"  acronym="${t.acronym}"`)
    );
    console.log(`  [dry-run] 跳过写库`);
    return;
  }

  // 去重：同名队伍保留 pandascore_id 最大（最新）的那条
  const byName = new Map();
  for (const t of teams) {
    const prev = byName.get(t.name);
    if (!prev || t.id > prev.id) byName.set(t.name, t);
  }
  const rows = [...byName.values()].map((t) => ({
    game: gameCode,
    name: t.name,
    acronym: t.acronym,
    pandascore_id: t.id,
    updated_at: new Date().toISOString(),
  }));

  await batchUpsertCanonical(rows);
  console.log(`  canonical_teams: upsert ${rows.length} 行`);
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PANDASCORE_TOKEN) {
    console.error("❌ 缺少 PANDASCORE_TOKEN（环境变量或 .env）");
    process.exit(1);
  }
  if (!DRY_RUN && !process.env.DATABASE_URL) {
    console.error("❌ 未配置 DATABASE_URL（请在 server/backend/.env 配置 RDS 连接）");
    process.exit(1);
  }

  console.log(DRY_RUN ? "模式：dry-run（只打印）" : "模式：写入队伍表（GAMEBET_DB_SCRIPT）");

  const games = GAME_FILTER ? { [GAME_FILTER]: GAMES[GAME_FILTER] } : GAMES;

  for (const [gameCode, psEndpoint] of Object.entries(games)) {
    if (!psEndpoint) { console.log(`[${gameCode}] 跳过（PandaScore 无数据）`); continue; }
    await seedGame(gameCode, psEndpoint);
  }

  console.log("\n✅ 完成");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
