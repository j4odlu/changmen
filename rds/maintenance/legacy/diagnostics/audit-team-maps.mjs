#!/usr/bin/env node
/**
 * 只读巡检：team_venue_maps ↔ canonical_teams 结构自洽性。
 *
 * 刻意不做队名比对。电竞战队改名／换赞助是常态，映射表本就会把同一支队的多个
 * 历史名字指向同一个 gb_team_id（Monte/Luminosity、L1GA/HULIGANI、Sharks/DENDELE
 * 均已人工确认为同队）。因此「一个编号下有两个不相关的队名」不是错误特征，
 * 据此告警只会产生几百条噪声。以下检查全部与队名无关：
 *
 * A 脏 venue_team_id：写入路径把 undefined/null 落成了字符串
 * B 一队多号：同平台同游戏同队名却挂了不同 gb_team_id
 * C 跨游戏编号：同一 gb 下的映射横跨多个 game（多游戏战队的不同分部被并成一个编号）
 * D 未识别 game 标签：catalog 解析不出来的 game 值
 * E 手动孤儿：人工建了 canonical 却没有任何映射（多为关联时建重了）
 * F 悬空引用：赛事表引用的 gb 在 canonical_teams 里不存在
 *
 * Usage:
 *   node scripts/ops/diagnostics/audit-team-maps.mjs
 *   node scripts/ops/diagnostics/audit-team-maps.mjs --limit 50
 */
import "dotenv/config";
import { ensurePgPoolReady } from "@changmen/db";
import { normalizeTeam } from "@changmen/match-identity/teams/team_key.js";
import { resolveGameCode } from "@changmen/shared/catalog/game_catalog";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) || 30 : 30;

const JUNK_IDS = new Set(["undefined", "null", "nan", "", "[object object]"]);
const isJunkId = v => v == null || JUNK_IDS.has(String(v).trim().toLowerCase());

/** 各馆的 game 有 code / 中文名 / 「未知(N)」多种写法，比较前先归一 */
function gameCode(raw) {
  const s = String(raw || "").trim();
  if (!s)
    return null;
  return resolveGameCode(s);
}

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS");
  process.exit(1);
}

const more = (n) => {
  if (n > LIMIT)
    console.log(`  … 另有 ${n - LIMIT} 条`);
};

const { rows } = await pool.query(
  `SELECT tvm.id, tvm.venue, tvm.venue_team_id, tvm.venue_name, tvm.game,
          tvm.gb_team_id, tvm.source, ct.name AS canonical_name, ct.game AS canonical_game
   FROM team_venue_maps tvm
   LEFT JOIN canonical_teams ct ON ct.gb_team_id = tvm.gb_team_id
   ORDER BY tvm.gb_team_id NULLS LAST, tvm.venue, tvm.id`,
);

const mapped = rows.filter(r => r.gb_team_id != null);
const gbIds = new Set(mapped.map(r => String(r.gb_team_id)));

console.log("── 规模 ──");
console.log(
  `team_venue_maps ${rows.length} 行 · 已映射 ${mapped.length} · 待识别 ${rows.length - mapped.length}`
  + ` · 涉及 ${gbIds.size} 个 gb_team_id\n`,
);

// ── A 脏 venue_team_id ───────────────────────────────────────────────────────
// UNIQUE(venue, venue_team_id) 意味着每个平台只能有一条这样的行，
// 后续所有取不到 id 的队伍都会挤进同一个槽位；带 gb 时会造成编号分裂
const junk = rows.filter(r => isJunkId(r.venue_team_id));
console.log(`── A 脏 venue_team_id：${junk.length} 行 ──`);
for (const r of junk.slice(0, LIMIT)) {
  const flag = r.gb_team_id != null ? "  ← 已挂编号，会造成编号分裂" : "";
  console.log(`  #${r.id} ${r.venue} "${r.venue_name}" id=${JSON.stringify(r.venue_team_id)} gb=${r.gb_team_id}${flag}`);
}
more(junk.length);

// ── B 一队多号 ───────────────────────────────────────────────────────────────
const byVenueName = new Map();
for (const r of mapped) {
  if (isJunkId(r.venue_team_id))
    continue;
  const key = `${r.venue}|${r.game || ""}|${normalizeTeam(r.venue_name)}`;
  if (!byVenueName.has(key))
    byVenueName.set(key, new Map());
  const g = byVenueName.get(key);
  const gb = String(r.gb_team_id);
  if (!g.has(gb))
    g.set(gb, []);
  g.get(gb).push(r);
}
const splitTeams = [...byVenueName.entries()].filter(([, g]) => g.size >= 2);
console.log(`\n── B 一队多号：${splitTeams.length} 组 ──`);
for (const [key, g] of splitTeams.slice(0, LIMIT)) {
  const [venue, game, name] = key.split("|");
  console.log(`  ${venue} · "${name}" (game ${game || "—"})`);
  for (const [gb, list] of g)
    console.log(`    gb ${gb} = "${list[0].canonical_name ?? "?"}"  ← ${list.map(r => r.venue_team_id).join(", ")}`);
}
more(splitTeams.length);

// ── C 跨游戏编号 ─────────────────────────────────────────────────────────────
// gb_team_id 是按游戏划分的（canonical_teams UNIQUE(game, name)）。
// 多游戏战队的两个分部若共用一个编号，两个游戏的赛事就可能被合到一起
const byGb = new Map();
for (const r of mapped) {
  const key = String(r.gb_team_id);
  if (!byGb.has(key))
    byGb.set(key, []);
  byGb.get(key).push(r);
}
const crossGame = [];
for (const [gb, list] of byGb) {
  const codes = [...new Set(list.map(r => gameCode(r.game)).filter(Boolean))];
  const canonCode = gameCode(list[0].canonical_game);
  if (codes.length > 1)
    crossGame.push({ gb, codes, canonCode, list });
}
console.log(`\n── C 同一 gb 横跨多个 game：${crossGame.length} 个编号 ──`);
for (const { gb, codes, canonCode, list } of crossGame.slice(0, LIMIT)) {
  console.log(`  gb ${gb} = "${list[0].canonical_name ?? "?"}" canonical=${canonCode ?? "?"} → ${codes.join(" / ")}`);
  for (const c of codes) {
    const sample = list.filter(r => gameCode(r.game) === c);
    console.log(`    ${c}: ${sample.map(r => `${r.venue}:${r.venue_name}`).join(", ")}`);
  }
}
more(crossGame.length);

// ── D 未识别 game 标签 ───────────────────────────────────────────────────────
const badGame = mapped.filter(r => r.game && !gameCode(r.game));
const badGameLabels = new Map();
for (const r of badGame) {
  const k = String(r.game);
  badGameLabels.set(k, (badGameLabels.get(k) || 0) + 1);
}
console.log(`\n── D catalog 解析不出的 game 标签：${badGameLabels.size} 种 / ${badGame.length} 行 ──`);
for (const [label, n] of [...badGameLabels.entries()].sort((a, b) => b[1] - a[1]).slice(0, LIMIT)) {
  const venues = [...new Set(badGame.filter(r => String(r.game) === label).map(r => r.venue))];
  console.log(`  "${label}" × ${n}  ← ${venues.join(", ")}`);
}
more(badGameLabels.size);

// ── E 手动孤儿 canonical ─────────────────────────────────────────────────────
// canonical_teams 大部分是批量目录，没映射很正常；人工建的却没映射才可疑
const { rows: orphans } = await pool.query(
  `SELECT ct.gb_team_id, ct.name, ct.game, ct.updated_by
   FROM canonical_teams ct
   LEFT JOIN team_venue_maps tvm ON tvm.gb_team_id = ct.gb_team_id
   WHERE tvm.id IS NULL AND ct.updated_by IS NOT NULL
     AND ct.updated_by NOT LIKE '%retire%'
   ORDER BY ct.gb_team_id`,
);
console.log(`\n── E 人工建但无任何映射的 canonical：${orphans.length} 个 ──`);
for (const r of orphans.slice(0, LIMIT))
  console.log(`  gb ${r.gb_team_id} "${r.name}" (${r.game}) [${r.updated_by}]`);
more(orphans.length);

// ── F 悬空引用 ───────────────────────────────────────────────────────────────
const { rows: dangling } = await pool.query(
  `WITH refs AS (
     SELECT home_gb_team_id AS gb FROM client_matches WHERE home_gb_team_id IS NOT NULL
     UNION SELECT away_gb_team_id FROM client_matches WHERE away_gb_team_id IS NOT NULL
     UNION SELECT home_gb_team_id FROM client_matches_history WHERE home_gb_team_id IS NOT NULL
     UNION SELECT away_gb_team_id FROM client_matches_history WHERE away_gb_team_id IS NOT NULL
   )
   SELECT refs.gb FROM refs
   LEFT JOIN canonical_teams ct ON ct.gb_team_id = refs.gb
   WHERE ct.gb_team_id IS NULL ORDER BY refs.gb`,
);
console.log(`\n── F 赛事表引用了不存在的 gb：${dangling.length} 个 ──`);
for (const r of dangling.slice(0, LIMIT))
  console.log(`  gb ${r.gb}`);
more(dangling.length);

console.log("\n── 小结 ──");
console.log(
  `A 脏 id ${junk.length} · B 一队多号 ${splitTeams.length} · C 跨游戏编号 ${crossGame.length}`
  + ` · D 未识别 game ${badGameLabels.size} 种 · E 手动孤儿 ${orphans.length} · F 悬空引用 ${dangling.length}`,
);

await pool.end();
