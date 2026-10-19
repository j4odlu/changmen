#!/usr/bin/env node
/**
 * Fix: mCon esports vs Once Upon A Team both mapped to gb 100025.
 * Keep mCon on 100025; move Once Upon* venue maps → 100830.
 *
 * Usage:
 *   node scripts/ops/incidents/fix-mcon-onceupon-gb-mixup.mjs
 *   node scripts/ops/incidents/fix-mcon-onceupon-gb-mixup.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();

const MCON_GB = "100025";
const OUAT_GB = "100830";
const execute = process.argv.includes("--execute");

function isOnceUponName(name) {
  const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  // full name or OB/IA/RAY acronym
  return n.includes("once upon") || n === "ouat";
}

function isMconName(name) {
  const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  // avoid matching "once upon" etc.
  if (isOnceUponName(n))
    return false;
  return /\bmcon\b/.test(n) || n === "mcn";
}

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("no pool");
  process.exit(1);
}

const teams = await pool.query(
  `SELECT id, gb_team_id, game, name, acronym
   FROM canonical_teams
   WHERE gb_team_id IN ($1, $2)
      OR name ILIKE '%mcon%'
      OR name ILIKE '%once upon%'
   ORDER BY gb_team_id NULLS LAST, id`,
  [MCON_GB, OUAT_GB],
);
console.log("=== canonical_teams ===");
for (const r of teams.rows)
  console.log(`  id=${r.id} gb=${r.gb_team_id} game=${r.game} name=${r.name} acronym=${r.acronym}`);

const mapsOnMcon = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name, game, source
   FROM team_venue_maps
   WHERE gb_team_id = $1
   ORDER BY venue, venue_name`,
  [MCON_GB],
);

const ouatOnWrong = mapsOnMcon.rows.filter(r => isOnceUponName(r.venue_name));
const mconOnOk = mapsOnMcon.rows.filter(r => isMconName(r.venue_name));
const otherOnMcon = mapsOnMcon.rows.filter(
  r => !isOnceUponName(r.venue_name) && !isMconName(r.venue_name),
);

console.log(`\n=== maps currently on ${MCON_GB} (mCon) ===`);
console.log(`  mCon-like: ${mconOnOk.length}`);
for (const r of mconOnOk)
  console.log(`    keep  ${r.venue} | ${r.venue_team_id} | ${r.venue_name}`);
console.log(`  OnceUpon-like (WRONG): ${ouatOnWrong.length}`);
for (const r of ouatOnWrong)
  console.log(`    move→${OUAT_GB}  ${r.venue} | ${r.venue_team_id} | ${r.venue_name}`);
if (otherOnMcon.length) {
  console.log(`  other (review): ${otherOnMcon.length}`);
  for (const r of otherOnMcon)
    console.log(`    ???   ${r.venue} | ${r.venue_team_id} | ${r.venue_name}`);
}

const mapsOnOuat = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name, game, source
   FROM team_venue_maps
   WHERE gb_team_id = $1
   ORDER BY venue, venue_name`,
  [OUAT_GB],
);
console.log(`\n=== maps already on ${OUAT_GB} (Once Upon) ===`);
for (const r of mapsOnOuat.rows)
  console.log(`  ${r.venue} | ${r.venue_team_id} | ${r.venue_name}`);

const ouatTeam = await pool.query(
  `SELECT id, gb_team_id, name FROM canonical_teams WHERE gb_team_id = $1`,
  [OUAT_GB],
);
if (!ouatTeam.rows.length) {
  console.error(`\nERROR: canonical team gb=${OUAT_GB} missing — abort`);
  await pool.end();
  process.exit(1);
}

if (!execute) {
  console.log(`\n[dry-run] would UPDATE ${ouatOnWrong.length} maps: gb ${MCON_GB} → ${OUAT_GB}`);
  console.log("Re-run with --execute to apply.");
  await pool.end();
  process.exit(0);
}

if (!ouatOnWrong.length) {
  console.log("\nnothing to move");
  await pool.end();
  process.exit(0);
}

const ids = ouatOnWrong.map(r => r.id);
const updated = await pool.query(
  `UPDATE team_venue_maps
   SET gb_team_id = $1, source = 'manual'
   WHERE id = ANY($2::bigint[])
   RETURNING id, venue, venue_team_id, venue_name, gb_team_id`,
  [OUAT_GB, ids],
);
console.log("\nupdated:");
for (const r of updated.rows)
  console.log(`  ${r.id} ${r.venue} ${r.venue_name} → ${r.gb_team_id}`);

console.log("\n=== verify ===");
for (const gb of [MCON_GB, OUAT_GB]) {
  const v = await pool.query(
    `SELECT venue, venue_name, gb_team_id FROM team_venue_maps
     WHERE gb_team_id = $1
     ORDER BY venue, venue_name`,
    [gb],
  );
  console.log(`gb ${gb}:`);
  for (const r of v.rows)
    console.log(`  ${r.venue} | ${r.venue_name}`);
}

await pool.end();
console.log("\nDone. Restart matcher/esport (or wait next matchMerge) so team plugin reloads.");
