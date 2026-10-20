#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const since = new Date("2026-07-08T13:55:00Z").getTime();
const until = new Date("2026-07-08T14:05:00Z").getTime();

const orders = await pool.query(
  `SELECT o.order_id, o.link, o.provider, o.bet_money, o.odds, o.status, o.create_at,
          o.match, o.bet, o.item, p.user_name
   FROM orders o
   JOIN profiles p ON p.id = o.user_id
   WHERE o.create_at BETWEEN $1 AND $2
     AND (o.match ILIKE '%Patins%' OR o.match ILIKE '%Fluxo%')
   ORDER BY o.create_at ASC`,
  [since, until],
);
console.log("=== orders ===", orders.rowCount);
for (const row of orders.rows) {
  const ts = new Date(Number(row.create_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  console.log(ts, row.user_name, row.provider, row.status, row.bet_money, row.odds, row.item_name, "link", row.link);
}

const links = [...new Set(orders.rows.map(r => r.link).filter(Boolean))];
for (const link of links) {
  const logs = await pool.query(
    `SELECT ul.create_at, ul.title, LEFT(ul.data::text, 500) AS data_snip
     FROM user_logs ul
     JOIN profiles p ON p.id = ul.user_id
     JOIN orders o ON o.user_id = ul.user_id AND o.link = $1
     WHERE p.user_name = (SELECT user_name FROM orders o2 JOIN profiles p2 ON p2.id=o2.user_id WHERE o2.link=$1 LIMIT 1)
       AND ul.create_at BETWEEN $2 AND $3
       AND (ul.title ILIKE '%Patins%' OR ul.title ILIKE '%Fluxo%' OR ul.title ILIKE '%Polymarket%' OR ul.title ILIKE '%RAY%'
            OR ul.data::text ILIKE '%Patins%' OR ul.data::text ILIKE '%Fluxo%')
     ORDER BY ul.create_at ASC
     LIMIT 60`,
    [link, since - 60000, until + 60000],
  );
  console.log("\n=== logs link", link, "count", logs.rowCount, "===");
  for (const row of logs.rows) {
    const ts = new Date(Number(row.create_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    console.log(ts, row.title);
    if (row.data_snip?.includes("checkError") || row.data_snip?.includes("reject") || row.data_snip?.includes("delayed"))
      console.log(" ", row.data_snip.slice(0, 400));
  }
}

await pool.end();
