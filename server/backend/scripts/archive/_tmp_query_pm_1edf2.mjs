#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";
import {
  buildPolymarketL2HeadersFromToken,
  parsePolymarketTokenConfig,
  fetchPolymarketTradesSince,
  flattenPolymarketTrades,
  collectPolymarketUserAddresses,
} from "../core/integrations/polymarket/clob_l2.js";
import { playerRowToAccountRecord } from "../../db/player_account_record.js";

const ORDER_ID = "0x1edf04ac6797569439b2d1e02cf480727e472b327a1842509d96d575085da21e";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: byId } = await pool.query(
  `SELECT order_id, player_id, status, match, bet, item, create_at, bet_money, odds, money, raw
   FROM orders WHERE order_id = $1`,
  [ORDER_ID],
);
console.log("=== RDS exact order_id ===", byId.length ? byId : "NOT FOUND");

const { rows: map3 } = await pool.query(
  `SELECT order_id, player_id, status, match, bet, item, create_at, bet_money, odds, money, raw
   FROM orders
   WHERE player_id = 47
     AND create_at > $1
   ORDER BY create_at DESC
   LIMIT 15`,
  [Date.now() - 12 * 60 * 60 * 1000],
);
console.log("=== RDS player47 recent ===");
for (const o of map3) {
  console.log(JSON.stringify({
    order_id: o.order_id,
    status: o.status,
    match: o.match,
    bet: o.bet,
    item: o.item,
    bet_money: o.bet_money,
    odds: o.odds,
    create_iso: new Date(Number(o.create_at)).toISOString(),
    pmShares: o.raw?.pmShares,
  }));
}

const { rows: prof } = await pool.query(
  `SELECT p.id FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE 'River'`,
);
const uid = prof[0]?.id;
const { rows: pms } = await pool.query(
  `SELECT id, player_name, platform_name, account_data
   FROM players
   WHERE owner_user_id = $1::uuid AND provider ILIKE 'Polymarket' AND deleted_at IS NULL`,
  [uid],
);
console.log("=== River PM accounts ===", pms.map(p => ({ id: p.id, name: p.player_name })));

for (const p of pms) {
  const acc = playerRowToAccountRecord({
    id: p.id,
    platformId: null,
    platformName: p.platform_name,
    playerName: p.player_name,
    provider: "Polymarket",
    credit: 0,
    totalBalance: 0,
    accountData: p.account_data,
    updatedAt: null,
  });
  const token = acc?.token;
  if (!token) {
    console.log(p.id, "no token");
    continue;
  }
  const gateway = (acc.gateway || "https://clob.polymarket.com").replace(/\/+$/, "");
  const path = `/data/order/${ORDER_ID}`;
  const headers = buildPolymarketL2HeadersFromToken(token, "GET", path);
  const res = await fetch(`${gateway}${path}`, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  }
  catch {
    body = { raw: text.slice(0, 300) };
  }
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  console.log(`=== CLOB /data/order via ${p.id} ${p.player_name} ===`);
  console.log(JSON.stringify({
    http: res.status,
    keys,
    status: body?.status,
    side: body?.side,
    price: body?.price,
    original_size: body?.original_size,
    size_matched: body?.size_matched,
    associate_trades: body?.associate_trades,
    order_type: body?.order_type,
    created_at: body?.created_at,
    error: body?.error,
    rawPreview: keys.length === 0 ? text.slice(0, 200) : undefined,
  }, null, 2));

  const afterSec = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);
  const cfg = parsePolymarketTokenConfig(token);
  const addrs = collectPolymarketUserAddresses(cfg);
  const raw = await fetchPolymarketTradesSince({
    token,
    gateway,
    afterSec,
    maxPages: 30,
  });
  const flat = flattenPolymarketTrades(raw, addrs);
  const hits = flat.filter(t =>
    String(t.taker_order_id ?? "").toLowerCase() === ORDER_ID.toLowerCase(),
  );
  let maker = 0;
  for (const t of raw) {
    for (const mo of t.maker_orders || []) {
      if (String(mo.order_id ?? "").toLowerCase() === ORDER_ID.toLowerCase())
        maker += 1;
    }
  }
  console.log(`trades via ${p.id}: raw=${raw.length} takerHits=${hits.length} makerHits=${maker}`);
  if (hits.length)
    console.log(JSON.stringify(hits, null, 2));
}

await pool.end();
