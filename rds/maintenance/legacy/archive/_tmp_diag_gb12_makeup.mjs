#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const profile = await pool.query(
  `SELECT user_name, betting_config, preferences FROM profiles WHERE user_name ILIKE 'GB12'`,
);
const p = profile.rows[0];
console.log("=== GB12 betting_config ===");
console.log(JSON.stringify({
  makeUp: p?.betting_config?.makeUp,
  makeUp_odds: p?.betting_config?.makeUp_odds,
  makeUp_defaultOdds: p?.betting_config?.makeUp_defaultOdds,
  betSorting: p?.betting_config?.betSorting,
  anyOdds: p?.betting_config?.anyOdds,
  minMoney: p?.betting_config?.minMoney,
  maxMoney: p?.betting_config?.maxMoney,
}, null, 2));

const from = Date.parse("2026-07-01T14:20:00.000Z");
const to = Date.parse("2026-07-01T15:10:00.000Z");
const userId = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB12'`)).rows[0]?.id;

const logs = await pool.query(
  `SELECT create_at, title, data FROM user_logs
   WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
     AND (title ILIKE '%ParadOx%' OR title ILIKE '%Spartans%' OR title ILIKE '%补单%' OR title ILIKE '%lose%'
          OR data::text ILIKE '%ParadOx%' OR data::text ILIKE '%补单%' OR data::text ILIKE '%makeUp%')
   ORDER BY create_at`,
  [userId, from, to],
);
console.log("\n=== ParadOx / 补单 logs ===", logs.rowCount);
for (const l of logs.rows) {
  let data = l.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { /* */ }
  }
  console.log(
    new Date(Number(l.create_at)).toISOString().replace("T", " ").slice(0, 19),
    l.title?.slice(0, 120),
    data?.loseOrder ? "[loseOrder]" : "",
    data?.message ? String(data.message).slice(0, 80) : "",
  );
}

const orders = await pool.query(
  `SELECT create_at, provider, match, bet, item, odds, bet_money, money, status, link
   FROM orders WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
     AND match ILIKE '%ParadOx%'
   ORDER BY create_at`,
  [userId, from, to],
);
console.log("\n=== ParadOx orders ===");
for (const o of orders.rows) {
  const peers = await pool.query(`SELECT provider, item, odds, bet_money, status FROM orders WHERE user_id = $1 AND link = $2`, [userId, o.link]);
  console.log({
    at: new Date(Number(o.create_at)).toISOString().slice(11, 19),
    link: o.link,
    linkPeers: peers.rowCount,
    provider: o.provider,
    item: o.item,
    odds: o.odds,
    bet_money: o.bet_money,
    money: o.money,
    status: o.status,
  });
}

const logs2 = await pool.query(
  `SELECT create_at, title, data FROM user_logs
   WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
   ORDER BY create_at`,
  [userId, Date.parse("2026-07-01T14:38:00.000Z"), Date.parse("2026-07-01T14:45:00.000Z")],
);
console.log("\n=== all logs 22:38-22:45 ===", logs2.rowCount);
for (const l of logs2.rows) {
  let data = l.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { /* */ }
  }
  const kind = data?.kind ?? "";
  const msg = data?.message ?? data?.checkError ?? "";
  if (kind === "bet" || kind === "check" || String(l.title).includes("补") || data?.loseOrder) {
    console.log(
      new Date(Number(l.create_at)).toISOString().slice(11, 19),
      kind,
      data?.provider ?? "",
      String(l.title).slice(0, 90),
      msg ? String(msg).slice(0, 60) : "",
      data?.loseOrder ? "[loseOrder]" : "",
    );
  }
}

const tpx = await pool.query(
  `SELECT create_at, provider, match, bet, item, odds, bet_money, money, status, link
   FROM orders WHERE user_id = $1 AND create_at BETWEEN $2 AND $3
     AND (match ILIKE '%TPX%' OR match ILIKE '%ParadOx%')
   ORDER BY create_at`,
  [userId, from, to],
);
console.log("\n=== all ParadOx/TPX orders ===");
for (const o of tpx.rows) {
  const peers = await pool.query(`SELECT COUNT(*)::int c FROM orders WHERE user_id = $1 AND link = $2`, [userId, o.link]);
  console.log({
    at: new Date(Number(o.create_at)).toISOString().slice(11, 19),
    link: o.link,
    peers: peers.rows[0].c,
    provider: o.provider,
    item: o.item,
    odds: o.odds,
    bet_money: o.bet_money,
    money: o.money,
    status: o.status,
  });
}

await pool.end();
