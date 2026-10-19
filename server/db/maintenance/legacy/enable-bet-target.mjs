#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

const userName = String(process.argv[2] || "").trim();
const enabled = process.argv[3] !== "off";

if (!userName) {
  console.error("用法: node scripts/ops/enable-bet-target.mjs <用户名> [off]");
  process.exit(1);
}

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT id, user_name, betting_config FROM profiles WHERE user_name ILIKE $1`,
  [userName],
);
if (!rows.length) {
  console.error(`用户不存在: ${userName}`);
  await pool.end();
  process.exit(1);
}

const row = rows[0];
const cfg
  = row.betting_config && typeof row.betting_config === "object" && !Array.isArray(row.betting_config)
    ? { ...row.betting_config }
    : {};
const before = Boolean(cfg.BetTarget);
cfg.BetTarget = enabled;
const now = Date.now();
await pool.query(
  `UPDATE profiles SET betting_config = $2::jsonb, updated_at = $3 WHERE id = $1`,
  [row.id, JSON.stringify(cfg), now],
);

console.log(JSON.stringify({
  id: row.id,
  userName: row.user_name,
  BetTargetBefore: before,
  BetTargetAfter: enabled,
}, null, 2));

await pool.end();
