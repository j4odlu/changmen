#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0].id;

const migrateTargets = [
  [78, 118], [106, 118], [80, 111], [84, 119], [107, 111],
];

for (const [from, to] of migrateTargets) {
  const { rows } = await pool.query(
    `SELECT o.order_id FROM orders o
     WHERE o.user_id=$1 AND o.player_id=$2
       AND NOT EXISTS (SELECT 1 FROM orders k WHERE k.user_id=$1 AND k.player_id=$3 AND k.order_id=o.order_id AND k.provider=o.provider)
       AND NOT EXISTS (
         SELECT 1 FROM orders d JOIN players pl ON pl.id=d.player_id
         WHERE d.user_id=$1 AND d.order_id=o.order_id AND d.provider=o.provider
           AND pl.deleted_at IS NOT NULL AND d.player_id <> $2
       )`,
    [uid, from, to],
  );
  console.log(`${from}->${to} 可安全迁移(无冲突): ${rows.length} 条`);
}

// player 77 uncertain - check links
const u77 = await pool.query(
  `SELECT o.order_id, o.link, o.match FROM orders o WHERE user_id=$1 AND player_id=77`,
  [uid],
);
console.log("\n=== player 77 订单及对腿 ===");
for (const o of u77.rows) {
  const legs = await pool.query(
    `SELECT player_id, provider, link FROM orders WHERE user_id=$1 AND link=$2 AND player_id<>77`,
    [uid, o.link],
  );
  console.log(o.order_id, o.match?.slice(0, 40), "legs:", legs.rows);
}

// any active milan-like player?
const milan = await pool.query(
  `SELECT id, platform_name, player_name FROM players WHERE owner_user_id=$1 AND deleted_at IS NULL AND platform_name ILIKE '%米兰%'`,
  [uid],
);
console.log("\n活跃米兰线:", milan.rows);

await pool.end();
