#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/** 诊断指定用户/账号/比赛的 orders + user_logs */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();

const userName = process.argv[2] || "River";
const accountHint = process.argv[3] || "D8F7";
const matchHint = process.argv[4] || "Karmine Corp";
const allAccounts = process.argv.includes("--all");

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无 DATABASE_URL");
  process.exit(1);
}

const profile = await pool.query(
  `SELECT id, user_name, accounts FROM profiles WHERE user_name ILIKE $1 LIMIT 1`,
  [userName],
);
if (!profile.rows[0]) {
  console.error("用户不存在:", userName);
  process.exit(1);
}
const userId = profile.rows[0].id;
const accounts = Array.isArray(profile.rows[0].accounts) ? profile.rows[0].accounts : [];
console.log("=== user ===");
console.log({ userId, userName: profile.rows[0].user_name });

const matchedAccounts = accounts.filter((a) => {
  const name = String(a.playerName ?? a.PlayerName ?? "").toUpperCase();
  const id = String(a.accountId ?? a.AccountId ?? "");
  return name.includes(accountHint.toUpperCase()) || id === accountHint;
});
console.log("\n=== accounts matching", accountHint, "===");
for (const a of matchedAccounts) {
  console.log(JSON.stringify({
    accountId: a.accountId ?? a.AccountId,
    playerId: a.playerId ?? a.PlayerId ?? a.accountId ?? a.AccountId,
    type: a.provider ?? a.Type,
    name: a.playerName ?? a.PlayerName,
    multiply: a.multiply ?? a.Multiply,
  }));
}

const playerIds = allAccounts
  ? null
  : matchedAccounts
    .map(a => Number(a.accountId ?? a.AccountId ?? a.playerId ?? a.PlayerId))
    .filter(n => Number.isFinite(n));

if (!allAccounts && !playerIds.length) {
  console.log("未找到 player_id");
  await pool.end();
  process.exit(0);
}

const orders = await pool.query(
  allAccounts
    ? `SELECT id, player_id, order_id, provider, match, bet, item,
              odds, bet_money, money, status, create_at, link,
              changmen_bet, raw
       FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND match ILIKE $2
       ORDER BY create_at ASC`
    : `SELECT id, player_id, order_id, provider, match, bet, item,
              odds, bet_money, money, status, create_at, link,
              changmen_bet, raw
       FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND player_id = ANY($2::bigint[]) AND match ILIKE $3
       ORDER BY create_at ASC`,
  allAccounts ? [userId, `%${matchHint}%`] : [userId, playerIds, `%${matchHint}%`],
);
console.log("\n=== orders ===");
console.log("count:", orders.rowCount);
for (const o of orders.rows) {
  const ts = new Date(Number(o.create_at)).toISOString();
  console.log(JSON.stringify({
    id: o.id,
    player_id: o.player_id,
    order_id: String(o.order_id).slice(0, 20) + "…",
    provider: o.provider,
    match: o.match,
    bet: o.bet,
    item: o.item,
    odds: o.odds,
    bet_money: o.bet_money,
    money: o.money,
    status: o.status,
    create_at: ts,
    link: o.link,
    changmen_bet: o.changmen_bet,
  }, null, 2));
  const raw = o.raw && typeof o.raw === "object" ? o.raw : {};
  if (raw.orderId || raw.provider)
    console.log("  raw keys:", Object.keys(raw).join(", "));
}

try {
  const logs = await pool.query(
    `SELECT id, created_at, action, message, meta
     FROM user_logs
     WHERE user_id = $1
       AND created_at >= $2
       AND (message ILIKE $3 OR meta::text ILIKE $3)
     ORDER BY created_at ASC
     LIMIT 30`,
    [
      userId,
      orders.rows[0]?.create_at ? Number(orders.rows[0].create_at) - 300_000 : Date.now() - 86400000,
      `%${matchHint}%`,
    ],
  );
  console.log("\n=== user_logs (around match) ===");
  console.log("count:", logs.rowCount);
  for (const l of logs.rows) {
    console.log(JSON.stringify({
      at: new Date(Number(l.created_at)).toISOString(),
      action: l.action,
      message: String(l.message || "").slice(0, 200),
      meta: l.meta,
    }));
  }
}
catch (err) {
  console.log("\nuser_logs skip:", err.message);
}

await pool.end();
