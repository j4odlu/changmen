#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();

const userName = process.argv.find(a => a.startsWith("--user="))?.slice(7) || "GB14";
const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE $1 LIMIT 1`,
  [userName],
);
const uid = users[0]?.id;
if (!uid) {
  console.error(`用户 ${userName} 不存在`);
  process.exit(1);
}

const dupGroups = await pool.query(
  `SELECT o.provider, o.order_id,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT o.player_id)::int AS players,
          array_agg(o.player_id ORDER BY o.player_id) AS player_ids,
          array_agg(pl.platform_name ORDER BY o.player_id) AS platforms,
          array_agg(pl.player_name ORDER BY o.player_id) AS names,
          array_agg(pl.deleted_at IS NOT NULL ORDER BY o.player_id) AS soft_flags
   FROM orders o
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
   GROUP BY o.provider, o.order_id
   HAVING COUNT(*) > 1
   ORDER BY o.provider, o.order_id`,
  [uid],
);

let activeActive = 0;
let softActive = 0;
let softSoft = 0;
let totalExtraRows = 0;

for (const g of dupGroups.rows) {
  const soft = g.soft_flags;
  const hasActive = soft.some(s => !s);
  const hasSoft = soft.some(s => s);
  totalExtraRows += g.rows - 1;
  if (hasActive && soft.every(s => !s))
    activeActive += 1;
  else if (hasActive && hasSoft)
    softActive += 1;
  else if (hasSoft && !hasActive)
    softSoft += 1;
}

const activeCount = await pool.query(
  `SELECT COUNT(*)::int AS n FROM players WHERE owner_user_id = $1::uuid AND deleted_at IS NULL`,
  [uid],
);
const softCount = await pool.query(
  `SELECT COUNT(*)::int AS n FROM players WHERE owner_user_id = $1::uuid AND deleted_at IS NOT NULL`,
  [uid],
);
const softWithOrders = await pool.query(
  `SELECT pl.id, pl.platform_name, pl.player_name, COUNT(o.id)::int AS n
   FROM players pl
   JOIN orders o ON o.player_id = pl.id AND o.user_id = $1::uuid
   WHERE pl.owner_user_id = $1::uuid AND pl.deleted_at IS NOT NULL
   GROUP BY pl.id, pl.platform_name, pl.player_name
   ORDER BY n DESC, pl.id`,
  [uid],
);

console.log(`user=${users[0].user_name} (${uid})`);
console.log(`活跃 player: ${activeCount.rows[0].n}  软删 player: ${softCount.rows[0].n}`);
console.log(`重复 order_id 组: ${dupGroups.rows.length}`);
console.log(`多余行(可删副本): ${totalExtraRows}`);
console.log(`  活跃↔活跃: ${activeActive}`);
console.log(`  软删↔活跃: ${softActive}`);
console.log(`  软删↔软删: ${softSoft}`);

const byProvider = {};
for (const g of dupGroups.rows) {
  byProvider[g.provider] = (byProvider[g.provider] ?? 0) + 1;
}
if (Object.keys(byProvider).length)
  console.log("按平台:", byProvider);

if (dupGroups.rows.length) {
  console.log("\n明细:");
  for (const g of dupGroups.rows) {
    const tags = g.player_ids.map((id, i) =>
      `${id}${g.soft_flags[i] ? "S" : "A"}(${g.platforms[i]}/${g.names[i]})`,
    ).join(" vs ");
    console.log(`${g.provider}\t${g.order_id}\t${tags}`);
  }
}

if (softWithOrders.rows.length) {
  console.log("\n软删仍有订单:");
  for (const r of softWithOrders.rows)
    console.log(`  ${r.id}\t${r.platform_name}/${r.player_name}\t${r.n} 条`);
}

await pool.end();
