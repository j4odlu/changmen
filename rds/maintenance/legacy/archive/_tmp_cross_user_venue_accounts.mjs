#!/usr/bin/env node
/** 检查跨用户是否共用同一场馆操盘账号（venue_member_id / gateway+token） */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();

const byVenueMember = await pool.query(`
  SELECT pl.provider, pl.venue_member_id,
         COUNT(DISTINCT pl.owner_user_id)::int AS users,
         array_agg(DISTINCT u.user_name ORDER BY u.user_name) AS user_names,
         array_agg(pl.id ORDER BY pl.id) AS player_ids
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.deleted_at IS NULL
    AND pl.venue_member_id <> ''
    AND pl.provider <> ''
  GROUP BY pl.provider, pl.venue_member_id
  HAVING COUNT(DISTINCT pl.owner_user_id) > 1
  ORDER BY users DESC, pl.provider
  LIMIT 30
`);

console.log("=== 跨用户共用 venue_member_id ===");
console.log(`组数: ${byVenueMember.rows.length}`);
for (const r of byVenueMember.rows) {
  console.log(`${r.provider}\t${r.venue_member_id}\tusers=${r.user_names.join(",")}\tpids=${r.player_ids.join(",")}`);
}

const byGatewayToken = await pool.query(`
  SELECT pl.provider,
         pl.account_data->>'gateway' AS gateway,
         md5(COALESCE(pl.account_data->>'token', '')) AS token_hash,
         COUNT(DISTINCT pl.owner_user_id)::int AS users,
         array_agg(DISTINCT u.user_name ORDER BY u.user_name) AS user_names
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.deleted_at IS NULL
    AND COALESCE(pl.account_data->>'gateway', '') <> ''
    AND COALESCE(pl.account_data->>'token', '') <> ''
  GROUP BY pl.provider, pl.account_data->>'gateway', md5(COALESCE(pl.account_data->>'token', ''))
  HAVING COUNT(DISTINCT pl.owner_user_id) > 1
  ORDER BY users DESC
  LIMIT 20
`);

console.log("\n=== 跨用户相同 gateway+token ===");
console.log(`组数: ${byGatewayToken.rows.length}`);
for (const r of byGatewayToken.rows) {
  console.log(`${r.provider}\t${r.user_names.join(",")}\tgateway=${String(r.gateway).slice(0, 40)} token_hash=${r.token_hash.slice(0, 12)}…`);
}

await pool.end();
