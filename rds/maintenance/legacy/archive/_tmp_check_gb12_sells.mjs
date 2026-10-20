#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();
if (!pool) {
  console.error("NO_POOL");
  process.exit(1);
}

const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE $1`,
  ["%GB12%"],
);
console.log("users:", users);

for (const u of users) {
  const { rows: sellCnt } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE user_id = $1 AND provider = 'Polymarket' AND raw->>'pmSide' = 'sell'`,
    [u.id],
  );
  const { rows: sells } = await pool.query(
    `SELECT id, order_id, player_id, item, raw->>'pmSide' AS pm_side, create_at
     FROM orders
     WHERE user_id = $1 AND provider = 'Polymarket' AND raw->>'pmSide' = 'sell'
     ORDER BY create_at DESC`,
    [u.id],
  );
  console.log(`user ${u.user_name}: sell count = ${sellCnt[0]?.n}`);
  for (const s of sells)
    console.log(`  id=${s.id} player=${s.player_id} order_id=${s.order_id} item=${s.item}`);
}

const { rows: prof } = await pool.query(
  `SELECT p.id, p.user_name, a.elem
   FROM profiles p,
   LATERAL jsonb_array_elements(COALESCE(p.accounts, '[]'::jsonb)) AS a(elem)
   WHERE a.elem->>'playerName' ILIKE $1
      OR a.elem->>'userName' ILIKE $1
      OR p.user_name ILIKE $1`,
  ["%GB12%"],
);
console.log("account matches:", prof.length);
for (const p of prof) {
  const playerId = Number(p.elem?.accountId);
  if (!Number.isFinite(playerId) || playerId <= 0)
    continue;
  const { rows: sells } = await pool.query(
    `SELECT id, order_id, player_id, item, raw->>'pmSide' AS pm_side, create_at
     FROM orders
     WHERE player_id = $1 AND provider = 'Polymarket' AND raw->>'pmSide' = 'sell'`,
    [playerId],
  );
  console.log(`player ${playerId} (${p.elem?.playerName}): ${sells.length} sells`);
  for (const s of sells)
    console.log(`  id=${s.id} order_id=${s.order_id} item=${s.item}`);
}

// 平仓 item 但 pmSide 缺失的兜底
const { rows: ambiguous } = await pool.query(
  `SELECT o.id, o.order_id, o.player_id, o.item, o.raw->>'pmSide' AS pm_side, p.user_name
   FROM orders o
   LEFT JOIN profiles p ON p.id = o.user_id
   WHERE o.provider = 'Polymarket'
     AND (o.item LIKE '平仓%' OR o.item LIKE '平仓 %')
     AND COALESCE(o.raw->>'pmSide', '') != 'buy'
   ORDER BY o.create_at DESC
   LIMIT 20`,
);
console.log("ambiguous 平仓 rows (pmSide != buy):", ambiguous.length);
for (const a of ambiguous)
  console.log(`  id=${a.id} user=${a.user_name} player=${a.player_id} pm_side=${a.pm_side} item=${a.item}`);

await pool.end();
