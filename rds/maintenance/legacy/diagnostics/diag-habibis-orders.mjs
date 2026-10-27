#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
if (!pool) process.exit(1);

const userId = "6ae8c38e-c4a2-4b2d-9896-733196115322";
const orders = await pool.query(
  `SELECT id, order_id, bet_money, odds, link, status, create_at, changmen_bet, raw
   FROM ${financialOrdersRelation()}
   WHERE user_id = $1 AND player_id = 47 AND match ILIKE '%Game 2 Winner%Ilbirs%Habibis%'
   ORDER BY create_at, bet_money DESC`,
  [userId],
);
console.log("=== Game 2 orders ===", orders.rowCount);
for (const o of orders.rows) {
  console.log(JSON.stringify({
    id: o.id,
    order_id: o.order_id,
    bet_money: o.bet_money,
    odds: o.odds,
    item: o.raw?.item,
    link: o.link,
    status: o.status,
    create_at: new Date(Number(o.create_at)).toISOString(),
    changmen_bet: o.changmen_bet,
    raw_orderId: o.raw?.orderId,
  }, null, 0));
}

const t0 = 1782822351999 - 60000;
const t1 = 1782822351999 + 60000;
const logs = await pool.query(
  `SELECT create_at, level, message FROM user_logs
   WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
   ORDER BY create_at`,
  [userId, t0, t1],
);
console.log("\n=== user_logs around link ===", logs.rowCount);
for (const l of logs.rows) {
  const msg = String(l.message ?? "").slice(0, 300);
  console.log(new Date(Number(l.create_at)).toISOString(), l.level, msg);
}

await pool.end();
