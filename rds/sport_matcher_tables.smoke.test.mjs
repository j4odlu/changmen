/**
 * N3 sport 表隔离 smoke：sport store 源码不得写电竞热表；电竞 team_db 不得读 sport_*。
 * 不依赖 DATABASE_URL。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rdsDir = join(__dirname, "rds");
const teamDbPath = join(__dirname, "../server/match/resolver/team_db.ts");
const migrationPath = join(
  __dirname,
  "assets/migrations/033_sport_matcher_tables.sql",
);
const applySchemaPath = join(__dirname, "maintenance/apply-rds-schema.mjs");

const { SPORT_MATCHER_TABLES } = await import("./rds/sport_client_matches_store.js");

/** 电竞热表 — 仅用于本 smoke，勿写入 sport store 源码字符串 */
const ESPORT_FORBIDDEN = [
  "client_matches",
  "client_matches_history",
  "platform_matches",
  "platform_bets",
  "live_timers",
  "canonical_teams",
  "team_venue_maps",
  "client_match_platform_overrides",
];

assert.ok(SPORT_MATCHER_TABLES.has("sport_venue_matches"));
assert.ok(SPORT_MATCHER_TABLES.has("sport_client_matches"));
assert.ok(SPORT_MATCHER_TABLES.has("sport_canonical_teams"));
assert.ok(!SPORT_MATCHER_TABLES.has("client_matches"));

const sportStoreFiles = [
  "sport_client_matches_store.js",
  "sport_venue_store.js",
  "sport_team_store.js",
];

/** SQL 动词后的表名（避免 `sport_client_matches` 子串误伤） */
function sqlTableHits(src, table) {
  const re = new RegExp(
    String.raw`(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+${table}\b`,
    "gi",
  );
  return re.test(src);
}

for (const file of sportStoreFiles) {
  const src = readFileSync(join(rdsDir, file), "utf8");
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const name of ESPORT_FORBIDDEN) {
    assert.equal(
      sqlTableHits(stripped, name),
      false,
      `${file} SQL 不得引用电竞表 ${name}`,
    );
  }
  assert.equal(
    /\bCREATE TABLE IF NOT EXISTS sport_platform_|\bINTO sport_platform_|\bFROM sport_platform_/i.test(stripped),
    false,
    `${file} 不得使用 sport_platform_*（应用 venue）`,
  );
  assert.ok(/sport_/.test(stripped), `${file} 应引用 sport_* 表`);
}

const teamDb = readFileSync(teamDbPath, "utf8");
assert.match(teamDb, /fetchAllCanonicalTeams/);
assert.doesNotMatch(
  teamDb,
  /fetchAllSportCanonicalTeams|sport_canonical_teams|sport_team_venue_maps|sport_mlb_aliases|sport_team_plugin/,
  "电竞 team_db.ts 不得加载 sport_* 队名",
);

const sportMergeSrc = readFileSync(
  join(__dirname, "../server/backend/core/esport-api/sport_merge.js"),
  "utf8",
);
assert.match(sportMergeSrc, /sport_team_plugin/);
assert.doesNotMatch(sportMergeSrc, /\/team_db(?:\.[cm]?[jt]s)?["']|fetchAllCanonicalTeams/);

const migration = readFileSync(migrationPath, "utf8");
for (const t of SPORT_MATCHER_TABLES) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
}
assert.match(migration, /next_sport_manual_gb_team_id/);
assert.match(migration, /START WITH 200000/);
assert.doesNotMatch(migration, /REFERENCES client_matches\b/);
assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS sport_platform_/);

const apply = readFileSync(applySchemaPath, "utf8");
assert.match(apply, /033_sport_matcher_tables\.sql/);

// 接线模块：不得 SQL 引用电竞热表
for (const rel of [
  "../server/backend/core/esport-api/sport_merge.js",
  "../server/backend/core/esport-api/sport_venue_ingest.js",
]) {
  const src = readFileSync(join(__dirname, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const name of ESPORT_FORBIDDEN) {
    assert.equal(
      sqlTableHits(src, name),
      false,
      `${rel} 不得 SQL 引用 ${name}`,
    );
  }
}

const storeJs = readFileSync(join(__dirname, "../server/backend/core/esport-api/store.js"), "utf8");
assert.match(storeJs, /buildMatchList/);
assert.match(storeJs, /ingestAndMergeSportLists/);
// 电竞主列表仍只读 client_matches 路径
assert.match(storeJs, /loadClientMatchesFromDb/);

console.log("sport_matcher_tables.smoke: ok", {
  tables: [...SPORT_MATCHER_TABLES].sort(),
});
