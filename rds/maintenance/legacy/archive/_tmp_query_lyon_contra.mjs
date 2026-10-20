#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("RDS not configured");
  process.exit(1);
}

const t0 = Date.parse("2026-07-03T02:08:00.000Z");
const t1 = Date.parse("2026-07-03T02:15:00.000Z");

const { rows } = await pool.query(
  `SELECT o.id, p.user_name, o.player_id, o.provider, o.match, o.bet, o.item, o.odds,
          o.bet_money, o.money, o.link, o.create_at, o.status, o.raw
   FROM orders o
   JOIN profiles p ON p.id = o.user_id
   WHERE o.create_at >= $1 AND o.create_at <= $2
     AND o.provider = 'Polymarket'
     AND (o.match ILIKE '%LYON%' OR o.match ILIKE '%Contra%' OR o.item ILIKE '%Contra%')
   ORDER BY o.create_at`,
  [t0, t1],
);

for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id,
    user: r.user_name,
    playerId: r.player_id,
    provider: r.provider,
    item: r.item,
    bet: r.bet,
    odds: Number(r.odds),
    betMoney: Number(r.bet_money),
    money: Number(r.money),
    link: r.link,
    createAtLocal: new Date(Number(r.create_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    status: r.status,
    match: String(r.match).slice(0, 140),
    raw: r.raw,
  }, null, 2));
  console.log("---");
}
console.log("count", rows.length);
await pool.end();
