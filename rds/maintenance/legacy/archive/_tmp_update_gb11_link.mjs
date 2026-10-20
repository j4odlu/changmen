import { getPgPool } from "@changmen/db";

import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const pool = getPgPool();
if (!pool) {
  console.error("无 DATABASE_URL");
  process.exit(2);
}

const userName = "gb11";
const linkTs = new Date("2026-06-20T01:33:32+08:00").getTime();
const dryRun = process.argv.includes("--dry-run");

console.log("target link", linkTs, new Date(linkTs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));

const { rows: users } = await pool.query(
  "SELECT id, user_name FROM users WHERE user_name = $1",
  [userName],
);
if (!users.length) {
  console.error("用户不存在:", userName);
  process.exit(1);
}
const userId = users[0].id;

const { rows } = await pool.query(
  `SELECT o.order_id, o.provider, o.link, o.create_at, o.bet_money, o.odds,
          o.match, o.bet, o.item, o.player_id, o.status
   FROM orders o
   WHERE o.user_id = $1
     AND o.create_at >= $2 - 5000
     AND o.create_at <= $2 + 5000
   ORDER BY o.provider, o.order_id`,
  [userId, linkTs],
);

console.log("matched orders:", rows.length);
for (const r of rows) {
  console.log({
    order_id: String(r.order_id),
    provider: r.provider,
    link: String(r.link),
    create_at: String(r.create_at),
    bet_money: r.bet_money,
    odds: r.odds,
    match: r.match,
    bet: r.bet,
    item: r.item,
    player_id: r.player_id,
  });
}

if (!rows.length) {
  await pool.end();
  process.exit(1);
}

if (dryRun) {
  console.log("--dry-run: 未更新");
  await pool.end();
  process.exit(0);
}

const orderIds = rows.map(r => r.order_id);
const { rowCount } = await pool.query(
  `UPDATE orders SET link = $1 WHERE user_id = $2 AND order_id = ANY($3::text[])`,
  [linkTs, userId, orderIds],
);

console.log("updated rows:", rowCount);

const { rows: after } = await pool.query(
  `SELECT order_id, provider, link, create_at, bet_money, odds, match, bet
   FROM orders WHERE user_id = $1 AND order_id = ANY($2::text[])
   ORDER BY provider`,
  [userId, orderIds],
);
console.log("after update:");
for (const r of after) {
  console.log({
    order_id: String(r.order_id),
    provider: r.provider,
    link: String(r.link),
    create_at: String(r.create_at),
  });
}

await pool.end();
