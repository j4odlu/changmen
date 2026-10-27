#!/usr/bin/env node
/**
 * Live-probe one GB14 OB account balance via its gateway+token (read-only).
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const { rows } = await pool.query(
  `SELECT id, platform_name, player_name,
          account_data->>'gateway' AS gateway,
          account_data->>'token' AS token,
          account_data->>'referer' AS referer,
          venue_member_id
   FROM players
   WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
  [[180, 182, 184, 191, 193, 195, 235]],
);

await pool.end();

async function probe(row) {
  const url = `${String(row.gateway).replace(/\/$/, "")}/game/balance`;
  const headers = {
    Accept: "application/json, text/plain, */*",
    token: row.token,
    "request-code": cryptoRandom(),
  };
  if (row.referer) {
    headers.Referer = row.referer;
    try {
      headers.Origin = new URL(row.referer).origin;
    } catch { /* ignore */ }
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    console.log(`#${row.id} ${row.platform_name}/${row.player_name} HTTP ${res.status} ${Date.now() - t0}ms`);
    console.log(" ", typeof body === "object"
      ? { status: body.status, balance: body.data?.balance, uid: body.data?.uid, msg: body.data ?? body.msg ?? body.message }
      : body);
  } catch (e) {
    console.log(`#${row.id} ${row.platform_name}/${row.player_name} ERROR ${e.message}`);
  }
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

for (const row of rows)
  await probe(row);
