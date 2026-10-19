#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0].id;

const dupGroups = await pool.query(
  `SELECT o.provider, o.order_id,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT o.player_id)::int AS players,
          array_agg(o.player_id ORDER BY o.player_id) AS player_ids,
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
  const extra = g.rows - 1;
  totalExtraRows += extra;
  if (hasActive && soft.every(s => !s))
    activeActive += 1;
  else if (hasActive && hasSoft)
    softActive += 1;
  else if (hasSoft && !hasActive)
    softSoft += 1;
}

console.log(`GB13 重复 order_id 组: ${dupGroups.rows.length}`);
console.log(`多余行(可删副本): ${totalExtraRows}`);
console.log(`  活跃↔活跃: ${activeActive}`);
console.log(`  软删↔活跃: ${softActive}`);
console.log(`  软删↔软删: ${softSoft}`);

if (dupGroups.rows.length) {
  console.log("\n明细:");
  for (const g of dupGroups.rows) {
    const tags = g.soft_flags.map((s, i) => `${g.player_ids[i]}${s ? "S" : "A"}`).join(",");
    console.log(`${g.provider}\t${g.order_id}\trows=${g.rows}\t${tags}`);
  }
}

// OB-specific count (19-digit ids)
const obDup = dupGroups.rows.filter(g => g.provider === "OB");
console.log(`\nOB 重复组: ${obDup.length}`);

await pool.end();
