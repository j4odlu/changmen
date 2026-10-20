#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("no db");
  process.exit(1);
}

// 2026-07-01 22:39:29 CST = 14:39:29 UTC
const center = Date.parse("2026-07-01T14:39:29.000Z");
const from = center - 30 * 60_000;
const to = center + 30 * 60_000;

const orders = await pool.query(
  `SELECT o.id, p.user_name, o.player_id, o.order_id, o.provider, o.match, o.bet, o.item,
          o.odds, o.bet_money, o.money, o.status, o.create_at, o.link, o.changmen_bet, o.raw
   FROM orders o
   JOIN profiles p ON p.id = o.user_id
   WHERE o.create_at BETWEEN $1 AND $2
     AND (o.match ILIKE '%ParadOx%' OR o.match ILIKE '%Spartans%' OR o.bet ILIKE '%地图2%')
   ORDER BY o.create_at`,
  [from, to],
);
console.log("=== orders ParadOx / map2 window ===");
console.log("count:", orders.rowCount);
for (const o of orders.rows) {
  const acc = await pool.query(
    `SELECT accounts FROM profiles WHERE id = (SELECT user_id FROM orders WHERE id = $1)`,
    [o.id],
  );
  const accounts = acc.rows[0]?.accounts || [];
  const pa = accounts.find(a => String(a.accountId ?? a.AccountId) === String(o.player_id));
  console.log(JSON.stringify({
    user: o.user_name,
    player_id: o.player_id,
    playerName: pa?.playerName ?? pa?.PlayerName,
    provider: o.provider,
    match: o.match,
    bet: o.bet,
    item: o.item,
    odds: o.odds,
    bet_money: o.bet_money,
    money: o.money,
    status: o.status,
    link: o.link,
    linkType: Number(o.link) < 0 ? "单边" : "套利",
    at: new Date(Number(o.create_at)).toISOString(),
    changmen_bet: o.changmen_bet,
  }, null, 2));
}

const pb12Acc = await pool.query(
  `SELECT user_name, accounts FROM profiles WHERE user_name ILIKE 'GB12' OR accounts::text ILIKE '%PB12%'`,
);
console.log("\n=== GB12 / PB12 accounts ===");
for (const r of pb12Acc.rows) {
  for (const a of r.accounts || []) {
    console.log(JSON.stringify({
      user: r.user_name,
      id: a.accountId ?? a.AccountId,
      name: a.playerName ?? a.PlayerName,
      type: a.provider ?? a.Type,
      rateConfig: a.rateConfig,
      multiply: a.multiply ?? a.Multiply,
    }));
  }
}

const linkOrders = await pool.query(
  `SELECT o.player_id, p.user_name, o.provider, o.match, o.bet, o.item, o.odds, o.bet_money, o.money, o.status, o.link, o.create_at, o.raw
   FROM orders o JOIN profiles p ON p.id = o.user_id
   WHERE o.link IN ('1782916768325', '1782915963815', '1782916570999')
   ORDER BY o.link, o.create_at`,
);
console.log("\n=== orders by link ===");
for (const o of linkOrders.rows) {
  console.log(JSON.stringify({
    link: o.link,
    user: o.user_name,
    player: o.player_id,
    provider: o.provider,
    item: o.item,
    odds: o.odds,
    bet_money: o.bet_money,
    money: o.money,
    status: o.status,
    at: new Date(Number(o.create_at)).toISOString(),
    rawErr: o.raw?.error ?? o.raw?.msg ?? o.raw?.message,
  }));
}

if (orders.rows.length) {
  const userId = (await pool.query(`SELECT user_id FROM orders WHERE id = $1`, [orders.rows.find(o => o.odds == 1.452)?.id ?? orders.rows[0].id])).rows[0].user_id;
  const logs = await pool.query(
    `SELECT create_at, action, message, meta FROM user_logs
     WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
       AND (message ILIKE '%ParadOx%' OR message ILIKE '%Spartans%' OR message ILIKE '%地图2%' OR meta::text ILIKE '%ParadOx%' OR meta::text ILIKE '%1782916768325%')
     ORDER BY create_at LIMIT 50`,
    [userId, from, to],
  );
  console.log("\n=== user_logs ===");
  for (const l of logs.rows) {
    console.log(new Date(Number(l.create_at)).toISOString(), l.action, String(l.message || "").slice(0, 400));
    if (l.meta)
      console.log("  meta:", JSON.stringify(l.meta).slice(0, 500));
  }
}

await pool.end();
