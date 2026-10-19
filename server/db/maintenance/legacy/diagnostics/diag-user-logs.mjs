#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

const uid = process.argv[2];
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT create_at, title FROM user_logs WHERE user_id = $1 ORDER BY create_at DESC LIMIT 30`,
  [uid],
);
for (const row of rows) {
  console.log(`${new Date(Number(row.create_at)).toISOString()}\t${row.title}`);
}
await pool.end();
