#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, fetchUserLogsInRange, getPgPool } from "@changmen/db";

loadChangmenEnv();
const uid = "6ae8c38e-c4a2-4b2d-9896-733196115322";
const from = new Date("2026-06-30T08:00:00Z").getTime();
const to = new Date("2026-06-30T08:30:00Z").getTime();

await ensurePgPoolReady();
const logs = await fetchUserLogsInRange(uid, from, to, 300);
console.log("logs:", logs.length);
for (const row of logs) {
  const t = String(row.title || "");
  if (!/Polymarket|下注|补单|Karmine|Liquid|pm/i.test(t + row.data))
    continue;
  console.log(JSON.stringify({
    at: new Date(Number(row.create_at)).toISOString(),
    title: t.slice(0, 120),
    data: String(row.data || "").slice(0, 400),
  }));
}

const pool = getPgPool();
const orders = await pool.query(
  `SELECT order_id, item, bet_money, status, create_at, link, changmen_bet
   FROM ${financialOrdersRelation()} WHERE user_id=$1 AND player_id=47 AND match ILIKE $2 ORDER BY create_at`,
  [uid, "%Karmine Corp%Game 1%"],
);
console.log("\nfull order_ids:");
for (const o of orders.rows)
  console.log(o.order_id, o.item, o.bet_money, new Date(Number(o.create_at)).toISOString());

await pool.end();
