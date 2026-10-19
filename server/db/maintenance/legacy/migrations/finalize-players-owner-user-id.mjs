#!/usr/bin/env node
/**
 * 收尾：profile 引用的 player 补 owner_user_id；无引用活跃孤儿 soft-delete。
 * 前置：migrate-players-owner-user-id.mjs
 *
 *   node scripts/ops/migrations/finalize-players-owner-user-id.mjs [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

const dryRun = process.argv.includes("--dry-run");
loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

function accountIdOf(row) {
  return Number(row?.accountId ?? row?.AccountId) || 0;
}

const { rows: profiles } = await pool.query(`SELECT id, accounts FROM profiles`);
/** @type {Map<number, string>} */
const playerOwner = new Map();

for (const prof of profiles) {
  for (const acc of prof.accounts || []) {
    const pid = accountIdOf(acc);
    if (pid)
      playerOwner.set(pid, prof.id);
  }
}

const { rows: orphans } = await pool.query(
  `SELECT id, platform_name, player_name FROM players
   WHERE deleted_at IS NULL AND owner_user_id IS NULL
   ORDER BY id`,
);

let assigned = 0;
let deleted = 0;

for (const row of orphans) {
  const owner = playerOwner.get(Number(row.id));
  if (owner) {
    console.log(`${dryRun ? "[dry-run] " : ""}assign player ${row.id} → user ${owner}`);
    if (!dryRun) {
      await pool.query(
        `UPDATE players SET owner_user_id = $2, updated_at = $3 WHERE id = $1`,
        [row.id, owner, Date.now()],
      );
    }
    assigned += 1;
    continue;
  }
  console.log(`${dryRun ? "[dry-run] " : ""}soft-delete orphan player ${row.id} (${row.platform_name}/${row.player_name})`);
  if (!dryRun) {
    const now = Date.now();
    await pool.query(
      `UPDATE players SET deleted_at = $2, delete_description = $3, updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL`,
      [row.id, now, "finalize-players-owner: no profile reference"],
    );
  }
  deleted += 1;
}

const { rows: left } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM players WHERE deleted_at IS NULL AND owner_user_id IS NULL`,
);
console.log("done:", { assigned, deleted, activeWithoutOwner: left[0]?.n ?? 0 });
if ((left[0]?.n ?? 0) > 0) {
  console.warn("仍有活跃 player 无 owner，勿执行 027_players_active_owner_required.sql");
  process.exit(1);
}
