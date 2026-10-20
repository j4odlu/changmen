#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("no pool");
  process.exit(1);
}

const sinceMs = Date.now() - 2 * 60 * 60 * 1000; // 2h
const patterns = ["%PB%", "%pb%", "%限%", "%限红%", "%peter%", "%game%"];

const r = await pool.query(
  `SELECT ul.id, ul.create_at, p.user_name, ul.title,
          LEFT(ul.data::text, 800) AS data_snip
   FROM user_logs ul
   JOIN profiles p ON p.id = ul.user_id
   WHERE ul.create_at > $1
     AND (
       ul.title ILIKE '%[PB]%'
       OR ul.title ILIKE '%限%'
       OR ul.data::text ILIKE '%限红%'
       OR ul.data::text ILIKE '%限注%'
       OR ul.data::text ILIKE '%max%bet%'
       OR ul.data::text ILIKE '%maximum%'
     )
   ORDER BY ul.create_at DESC
   LIMIT 40`,
  [sinceMs],
);

console.log(`PB / 限红 related logs (last 2h): ${r.rowCount}`);
for (const row of r.rows) {
  const ts = new Date(Number(row.create_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  console.log("\n---");
  console.log(ts, row.user_name, row.title);
  if (row.data_snip)
    console.log(row.data_snip.slice(0, 600));
}

await pool.end();
