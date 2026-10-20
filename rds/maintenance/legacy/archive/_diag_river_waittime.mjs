#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const r2 = await pool.query(
  `SELECT u.user_name, pr.betting_config
   FROM profiles pr
   JOIN users u ON u.id = pr.id
   WHERE LOWER(u.user_name) = 'river'`,
);
for (const row of r2.rows) {
  const uc = row.betting_config?.USERCONFIG ?? row.betting_config;
  console.log("user:", row.user_name);
  console.log("waitTime:", JSON.stringify(uc?.waitTime ?? uc?.WaitTime, null, 2));
  console.log("makeUp:", uc?.makeUp);
}
await pool.end();
