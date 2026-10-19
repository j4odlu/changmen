#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const uid = "6ae8c38e-c4a2-4b2d-9896-733196115322";
const t0 = new Date("2026-06-30T08:10:00Z").getTime();
const t1 = new Date("2026-06-30T08:20:00Z").getTime();
const logs = await pool.query(
  `SELECT create_at, action, message, meta FROM user_logs
   WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
   ORDER BY create_at ASC`,
  [uid, t0, t1],
);
console.log("logs", logs.rowCount);
for (const l of logs.rows) {
  console.log(
    JSON.stringify({
      at: new Date(Number(l.create_at)).toISOString(),
      action: l.action,
      message: String(l.message || "").slice(0, 250),
      meta: l.meta,
    }),
  );
}
const prof = await pool.query(`SELECT accounts, betting_config FROM profiles WHERE id=$1`, [uid]);
const d8 = prof.rows[0].accounts.find(a => (a.accountId ?? a.AccountId) == 47);
console.log("D8F7 rateConfig", JSON.stringify(d8?.rateConfig ?? d8?.RateConfig));
console.log("makeUp", prof.rows[0].betting_config?.makeUp);
await pool.end();
