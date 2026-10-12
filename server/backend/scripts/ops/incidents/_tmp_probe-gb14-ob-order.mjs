#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const { rows } = await pool.query(
  `SELECT id, user_id::text, player_id, order_id, link, create_at, money, bet_money, odds, status, provider, raw
   FROM ${financialOrdersRelation()}
   WHERE link = $1 OR (player_id = 182 AND create_at >= $2)
   ORDER BY create_at DESC`,
  ["1789663764785", 1789660000000],
);

for (const r of rows) {
  console.log({
    id: r.id,
    player_id: r.player_id,
    link: r.link,
    status: r.status,
    bet_money: r.bet_money,
    odds: r.odds,
    provider: r.provider,
    created: new Date(Number(r.create_at)).toISOString(),
    order_id: r.order_id,
  });
  const raw = r.raw;
  console.log("raw keys", raw && typeof raw === "object" ? Object.keys(raw) : typeof raw);
  console.log("raw sample", JSON.stringify(raw).slice(0, 800));
}

// Also: how often was OB on the other side of GB14 arbs historically before transfer?
const { rows: hist } = await pool.query(
  `SELECT date_trunc('day', to_timestamp(o.create_at/1000.0)) AS day,
          UPPER(pl.provider) AS prov,
          COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND o.create_at >= $2
   GROUP BY 1, 2
   ORDER BY 1 DESC, n DESC`,
  ["4dd10501-4adf-4be9-9c7e-4b82fae727f7", Date.parse("2026-09-10T00:00:00Z")],
);
console.log("\nGB14 orders by day/provider last week:");
for (const r of hist) console.log(r);

await pool.end();
