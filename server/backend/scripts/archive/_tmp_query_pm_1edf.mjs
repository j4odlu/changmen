#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";
import {
  buildPolymarketL2HeadersFromToken,
  collectPolymarketUserAddresses,
  flattenPolymarketTrades,
  parsePolymarketTokenConfig,
  fetchPolymarketTradesSince,
} from "../core/integrations/polymarket/clob_l2.js";
import { playerRowToAccountRecord } from "../../db/player_account_record.js";

const ORDER_ID = "0x1edf04ac6797569439b2d1e02cf480727e472b327a1842509d96d575085da21e";
const TOKEN_MICRO = 1_000_000;

function shareCount(sizeRaw) {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (size >= 10_000) return size / TOKEN_MICRO;
  return size;
}

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: profRows } = await pool.query(
  `SELECT p.id AS user_id FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE 'River'`,
);
const userId = profRows[0]?.user_id;
const { rows: playerRows } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, provider, credit, total_balance, account_data, updated_at
   FROM players WHERE id = 47 AND owner_user_id = $1::uuid AND deleted_at IS NULL`,
  [userId],
);
const pr = playerRows[0];
const acc = playerRowToAccountRecord(pr
  ? {
      id: pr.id,
      platformId: pr.platform_id,
      platformName: pr.platform_name,
      playerName: pr.player_name,
      provider: pr.provider,
      credit: pr.credit,
      totalBalance: pr.total_balance,
      accountData: pr.account_data,
      updatedAt: pr.updated_at,
    }
  : null);
if (!acc?.token) {
  console.error("River pm/f43e token missing");
  process.exit(1);
}

const { rows: rds } = await pool.query(
  `SELECT order_id, link, bet_money, money, odds, status, create_at, match, bet, item, raw
   FROM orders
   WHERE order_id = $1
   ORDER BY create_at DESC
   LIMIT 5`,
  [ORDER_ID],
);
console.log("=== RDS ===");
console.log(JSON.stringify(rds.map(o => ({
  order_id: o.order_id,
  link: o.link,
  status: o.status,
  bet_money: o.bet_money,
  money: o.money,
  odds: o.odds,
  match: o.match,
  bet: o.bet,
  item: o.item,
  create_at: o.create_at,
  raw: o.raw,
})), null, 2));

const gateway = (acc.gateway || "https://clob.polymarket.com").replace(/\/+$/, "");
const orderPath = `/data/order/${ORDER_ID}`;
const headers = buildPolymarketL2HeadersFromToken(acc.token, "GET", orderPath);
const res = await fetch(`${gateway}${orderPath}`, { headers });
const body = res.ok ? await res.json() : { error: res.status, text: await res.text() };
console.log("=== CLOB /data/order ===");
console.log(JSON.stringify({
  httpOk: res.ok,
  status: body?.status,
  side: body?.side,
  price: body?.price,
  original_size: body?.original_size,
  size_matched: body?.size_matched,
  associate_trades: body?.associate_trades,
  order_type: body?.order_type,
  created_at: body?.created_at,
  error: body?.error,
  text: body?.text ? String(body.text).slice(0, 300) : undefined,
}, null, 2));

const createAt = rds[0]?.create_at ? Number(rds[0].create_at) : Date.now() - 2 * 60 * 60 * 1000;
const afterSec = Math.floor((createAt - 30 * 60 * 1000) / 1000);
const config = parsePolymarketTokenConfig(acc.token);
const userAddresses = collectPolymarketUserAddresses(config);
const raw = await fetchPolymarketTradesSince({
  token: acc.token,
  gateway,
  afterSec,
  maxPages: 20,
});
const flat = flattenPolymarketTrades(raw, userAddresses);
const legs = flat.filter(t =>
  String(t.taker_order_id ?? "").toLowerCase() === ORDER_ID.toLowerCase(),
);
const makerHits = [];
for (const t of raw) {
  if (!Array.isArray(t.maker_orders)) continue;
  for (const mo of t.maker_orders) {
    if (String(mo.order_id ?? "").toLowerCase() === ORDER_ID.toLowerCase()) {
      makerHits.push({
        trade_id: t.id,
        status: t.status,
        price: t.price,
        size: mo.matched_amount ?? mo.size,
        match_time: t.match_time,
      });
    }
  }
}

console.log("=== trades ===");
console.log(JSON.stringify({
  afterSec,
  rawTrades: raw.length,
  takerLegs: legs.length,
  makerHits: makerHits.length,
  legs: legs.map(t => ({
    status: t.status,
    side: t.side,
    price: Number(t.price),
    shares: Math.round(shareCount(t.size) * 10000) / 10000,
    usdc: Math.round(shareCount(t.size) * Number(t.price) * 10000) / 10000,
    match_time: t.match_time,
    trade_id: t.id,
  })),
  makerHits,
}, null, 2));

const matched = Number(body?.size_matched);
const filled = (Number.isFinite(matched) && matched > 0)
  || legs.length > 0
  || makerHits.length > 0;
console.log("=== VERDICT ===");
console.log(filled ? "FILLED" : "NOT_FILLED", JSON.stringify({
  clobStatus: body?.status ?? body?.error,
  size_matched: body?.size_matched,
  tradeLegs: legs.length + makerHits.length,
}));

await pool.end();
