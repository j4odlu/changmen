#!/usr/bin/env node
/**
 * Fix 两处确定的队伍编号错误（audit-team-maps.mjs 查出）：
 *
 * 1. PredictFun `lol:dk-challengers` 挂在 gb 100555（Dplus KIA 一队），
 *    应改挂 gb 100058（Dplus KIA Challengers 青训队）。
 *    PredictFun 自己另有 `lol:dplus-kia-challengers` 已正确挂在 100058。
 *
 * 2. valorant JD Gaming 占了两个编号：gb 100777（正常，6 条映射）
 *    与 gb 100775（只有 IA 一条 venue_team_id="undefined" 的脏行）。
 *    删除 canonical 100775，FK ON DELETE CASCADE 会带走那条脏映射。
 *
 * Usage:
 *   node scripts/ops/incidents/fix-dk-challengers-and-jdg-gb.mjs
 *   node scripts/ops/incidents/fix-dk-challengers-and-jdg-gb.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();

const execute = process.argv.includes("--execute");

const DK_MAIN_GB = 100555;
const DK_ACADEMY_GB = 100058;
const DK_VENUE = "PredictFun";
const DK_VENUE_TEAM_ID = "lol:dk-challengers";

const JDG_DEAD_GB = 100775;
const JDG_LIVE_GB = 100777;

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS");
  process.exit(1);
}

const abort = async (msg) => {
  console.error(`\n中止：${msg}`);
  await pool.end();
  process.exit(1);
};

async function dumpGb(gb, label) {
  const ct = await pool.query(
    `SELECT name, game FROM canonical_teams WHERE gb_team_id = $1`,
    [gb],
  );
  const maps = await pool.query(
    `SELECT id, venue, venue_team_id, venue_name, source FROM team_venue_maps
     WHERE gb_team_id = $1 ORDER BY venue, venue_name`,
    [gb],
  );
  console.log(`  gb ${gb} = "${ct.rows[0]?.name ?? "(无 canonical)"}" (${ct.rows[0]?.game ?? "?"}) ${label}`);
  for (const r of maps.rows)
    console.log(`    #${r.id} ${r.venue.padEnd(11)} ${String(r.venue_name).padEnd(26)} id=${r.venue_team_id} [${r.source}]`);
  return { canonical: ct.rows[0] || null, maps: maps.rows };
}

// ── 1. PredictFun DK Challengers ─────────────────────────────────────────────
console.log("═══ 1. PredictFun lol:dk-challengers ═══");
const main = await dumpGb(DK_MAIN_GB, "← 一队");
const academy = await dumpGb(DK_ACADEMY_GB, "← 青训");

const strayRow = main.maps.find(
  r => r.venue === DK_VENUE && String(r.venue_team_id) === DK_VENUE_TEAM_ID,
);
if (!strayRow) {
  const already = academy.maps.find(
    r => r.venue === DK_VENUE && String(r.venue_team_id) === DK_VENUE_TEAM_ID,
  );
  console.log(already ? "\n  已修复，跳过" : `\n  未找到 ${DK_VENUE} ${DK_VENUE_TEAM_ID}，跳过`);
}
else if (!academy.canonical) {
  await abort(`canonical gb ${DK_ACADEMY_GB} 不存在`);
}
// UNIQUE (gb_team_id, venue, venue_name)：目标侧不能已有同平台同名行
else if (academy.maps.some(r => r.venue === DK_VENUE && r.venue_name === strayRow.venue_name)) {
  await abort(
    `gb ${DK_ACADEMY_GB} 已存在 ${DK_VENUE} "${strayRow.venue_name}"，`
    + `迁移会违反 UNIQUE(gb_team_id, venue, venue_name)，需人工决定保留哪条`,
  );
}
else {
  console.log(`\n  待迁移：#${strayRow.id} ${DK_VENUE} "${strayRow.venue_name}" gb ${DK_MAIN_GB} → ${DK_ACADEMY_GB}`);
}

// ── 2. valorant JD Gaming 双编号 ─────────────────────────────────────────────
console.log("\n═══ 2. valorant JD Gaming 双编号 ═══");
const dead = await dumpGb(JDG_DEAD_GB, "← 待删除");
const live = await dumpGb(JDG_LIVE_GB, "← 保留");

let jdgAction = null;
if (!dead.canonical) {
  console.log("\n  gb 100775 已不存在，跳过");
}
else if (!live.canonical) {
  await abort(`canonical gb ${JDG_LIVE_GB} 不存在，不能删除 ${JDG_DEAD_GB}`);
}
else {
  const realMaps = dead.maps.filter(r => String(r.venue_team_id) !== "undefined");
  if (realMaps.length) {
    await abort(
      `gb ${JDG_DEAD_GB} 上还有 ${realMaps.length} 条正常映射，不能直接删除；`
      + `请先确认是否应迁移到 ${JDG_LIVE_GB}`,
    );
  }
  // 无 FK 的历史表引用会变悬空，删除前先看有没有
  const refs = await pool.query(
    `SELECT 'client_matches' AS t, count(*)::int AS n FROM client_matches
       WHERE home_gb_team_id = $1 OR away_gb_team_id = $1
     UNION ALL SELECT 'client_matches_history', count(*)::int FROM client_matches_history
       WHERE home_gb_team_id = $1 OR away_gb_team_id = $1
     UNION ALL SELECT 'match_events', count(*)::int FROM match_events
       WHERE home_gb_team_id = $1 OR away_gb_team_id = $1
     UNION ALL SELECT 'match_events_history', count(*)::int FROM match_events_history
       WHERE home_gb_team_id = $1 OR away_gb_team_id = $1`,
    [JDG_DEAD_GB],
  );
  const dangling = refs.rows.filter(r => r.n > 0);
  if (dangling.length) {
    console.log(`\n  注意：删除后以下表会留下悬空 gb ${JDG_DEAD_GB} 引用（无 FK，不报错）：`);
    for (const r of dangling)
      console.log(`    ${r.t}: ${r.n} 行`);
  }
  else {
    console.log(`\n  无任何赛事表引用 gb ${JDG_DEAD_GB}`);
  }
  jdgAction = { cascadeMaps: dead.maps.length };
  console.log(`  待删除：canonical gb ${JDG_DEAD_GB}，级联删除 ${dead.maps.length} 条脏映射`);
}

// ── 执行 ──────────────────────────────────────────────────────────────────────
if (!execute) {
  console.log("\n[dry-run] 未改动任何数据。加 --execute 落库。");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  if (strayRow) {
    const res = await client.query(
      `UPDATE team_venue_maps SET gb_team_id = $1, source = 'manual'
       WHERE id = $2 RETURNING id, venue, venue_name, gb_team_id`,
      [DK_ACADEMY_GB, strayRow.id],
    );
    console.log(`\n已迁移：${JSON.stringify(res.rows[0])}`);
  }

  if (jdgAction) {
    const res = await client.query(
      `DELETE FROM canonical_teams WHERE gb_team_id = $1 RETURNING gb_team_id, name, game`,
      [JDG_DEAD_GB],
    );
    console.log(`已删除 canonical：${JSON.stringify(res.rows[0])}（级联 ${jdgAction.cascadeMaps} 条映射）`);
  }

  await client.query("COMMIT");
}
catch (err) {
  await client.query("ROLLBACK");
  console.error("\n失败已回滚：", err.message);
  client.release();
  await pool.end();
  process.exit(1);
}
client.release();

console.log("\n═══ 复核 ═══");
await dumpGb(DK_MAIN_GB, "← 一队");
await dumpGb(DK_ACADEMY_GB, "← 青训");
await dumpGb(JDG_DEAD_GB, "← 应为空");
await dumpGb(JDG_LIVE_GB, "← 保留");

await pool.end();
console.log("\n完成。需重启 matcher/esport（或等下一轮 matchMerge）以重载 team plugin。");
