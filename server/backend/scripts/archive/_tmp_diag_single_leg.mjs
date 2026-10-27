import { getPgPool } from "@changmen/db";

import { loadChangmenEnv } from "@changmen/storage/load_env";
import { lookupOrderLogs } from "../core/admin_tools/user_log_lookup.js";

loadChangmenEnv();

const pool = getPgPool();
if (!pool) {
  console.error("无 DATABASE_URL");
  process.exit(2);
}

const userName = process.argv[2] || "gb12";
const betTimeStr = process.argv[3] || "2026-06-20T01:36:17+08:00";
const betTs = new Date(betTimeStr).getTime();

console.log("=== 查询参数 ===");
console.log({ userName, betTimeStr, betTs });

const { rows: users } = await pool.query(
  "SELECT id, user_name FROM users WHERE user_name = $1",
  [userName],
);
if (!users.length) {
  console.error("用户不存在:", userName);
  process.exit(1);
}
const userId = users[0].id;
console.log("user_id:", userId);

const { rows: orders } = await pool.query(
  `SELECT order_id, provider, player_id, link, create_at, bet_money, odds,
          match, bet, item, status
   FROM orders
   WHERE user_id = $1
     AND create_at >= $2::bigint - 3000
     AND create_at <= $2::bigint + 3000
   ORDER BY create_at, provider`,
  [userId, betTs],
);

console.log("\n=== 时间窗内订单 (±3s) ===");
for (const r of orders) {
  console.log({
    order_id: String(r.order_id),
    provider: r.provider,
    player_id: r.player_id,
    link: String(r.link),
    create_at: String(r.create_at),
    bet_money: r.bet_money,
    odds: r.odds,
    match: r.match,
    bet: r.bet,
    item: r.item,
    status: r.status,
  });
}

const obOrder = orders.find(
  r =>
    r.provider === "OB"
    && Number(r.bet_money) === 60
    && String(r.match || "").includes("Leviat"),
);

if (obOrder) {
  const link = Number(obOrder.link);
  console.log("\n=== 同 Link 全局订单 ===");
  const { rows: sameLink } = await pool.query(
    `SELECT o.order_id, o.user_id, u.user_name, o.provider, o.player_id,
            o.link, o.create_at, o.bet_money, o.odds, o.match, o.bet, o.item
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.link = $1::bigint
     ORDER BY o.provider, u.user_name`,
    [link],
  );
  for (const r of sameLink) {
    console.log({
      user_name: r.user_name,
      order_id: String(r.order_id),
      provider: r.provider,
      player_id: r.player_id,
      create_at: String(r.create_at),
      bet_money: r.bet_money,
      odds: r.odds,
      match: r.match,
      item: r.item,
    });
  }

  console.log("\n=== 日志 lookup (order) ===");
  const byOrder = await lookupOrderLogs({
    userName,
    orderId: String(obOrder.order_id),
  });
  console.log(byOrder.ok ? byOrder.summary : byOrder);

  console.log("\n=== 日志 lookup (link) ===");
  const byLink = await lookupOrderLogs({
    userName,
    link: String(link),
  });
  console.log(byLink.ok ? byLink.summary : byLink);
}
else {
  console.log("\n未精确匹配 OB 60@Leviatán，列出时间窗内全部订单");
}

// 扩展：±2min 内其他平台订单
const { rows: nearby } = await pool.query(
  `SELECT order_id, provider, player_id, link, create_at, bet_money, odds, match, bet, item
   FROM orders
   WHERE user_id = $1
     AND create_at >= $2::bigint - 120000
     AND create_at <= $2::bigint + 120000
   ORDER BY create_at, provider`,
  [userId, betTs],
);
console.log("\n=== ±2min 内 gb12 全部订单 ===");
for (const r of nearby) {
  console.log({
    order_id: String(r.order_id).slice(0, 22),
    provider: r.provider,
    link: String(r.link),
    create_at: String(r.create_at),
    bet_money: r.bet_money,
    odds: r.odds,
    match: (r.match || "").slice(0, 40),
    item: r.item,
  });
}

await pool.end();
