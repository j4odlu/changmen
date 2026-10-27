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

const ORDER_ID = "0xd19b3d3e451054d3167b0466023ef441473eeb0f3a843b033c67e9a71c4e9dbf";
const TOKEN_MICRO = 1_000_000;

function shareCount(sizeRaw) {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (size >= 10_000) return size / TOKEN_MICRO;
  return size;
}

function usdcStake(sizeRaw, price) {
  return shareCount(sizeRaw) * Number(price);
}

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT accounts FROM profiles WHERE user_name='River'`,
);
const acc = (rows[0]?.accounts ?? []).find(a => Number(a.accountId) === 47);
if (!acc?.token) {
  console.error("D8F7 token not found");
  process.exit(1);
}

const config = parsePolymarketTokenConfig(acc.token);
const gateway = acc.gateway || "https://clob.polymarket.com";
const afterSec = Math.floor((1783044656000 - 10 * 60 * 1000) / 1000);
const userAddresses = collectPolymarketUserAddresses(config);

const raw = await fetchPolymarketTradesSince({
  token: acc.token,
  gateway,
  afterSec,
  maxPages: 30,
});

const flat = flattenPolymarketTrades(raw, userAddresses);
const legs = flat.filter((t) => {
  const oid = String(t.taker_order_id ?? "").trim().toLowerCase();
  return oid === ORDER_ID.toLowerCase();
});

// raw rows that mention this order (taker or maker_orders)
const rawHits = [];
for (const t of raw) {
  const taker = String(t.taker_order_id ?? "").trim().toLowerCase();
  if (taker === ORDER_ID.toLowerCase()) {
    rawHits.push({ kind: "taker", trade: t });
  }
  if (Array.isArray(t.maker_orders)) {
    for (const mo of t.maker_orders) {
      if (String(mo.order_id ?? "").trim().toLowerCase() === ORDER_ID.toLowerCase()) {
        rawHits.push({ kind: "maker_leg", trade: t, maker_order: mo });
      }
    }
  }
}

console.log("orderId", ORDER_ID);
console.log("rawTradesFetched", raw.length);
console.log("flatLegsForOrder", legs.length);
console.log("rawHits", rawHits.length);

let totalUsdc = 0;
let totalShares = 0;

for (let i = 0; i < legs.length; i++) {
  const t = legs[i];
  const shares = shareCount(t.size);
  const price = Number(t.price);
  const usdc = usdcStake(t.size, price);
  totalUsdc += usdc;
  totalShares += shares;
  console.log(JSON.stringify({
    leg: i + 1,
    bucket_index: t.bucket_index,
    status: t.status,
    side: t.side,
    price,
    odds: price > 0 ? 1 / price : null,
    sizeRaw: t.size,
    shares: Math.round(shares * 10000) / 10000,
    usdc: Math.round(usdc * 10000) / 10000,
    match_time: t.match_time,
    trader_side: t.trader_side ?? t.type,
    trade_id: t.id,
  }));
}

if (totalShares > 0) {
  const vwap = totalUsdc / totalShares;
  console.log("summary", JSON.stringify({
    fillLegs: legs.length,
    totalShares: Math.round(totalShares * 10000) / 10000,
    totalUsdc: Math.round(totalUsdc * 10000) / 10000,
    vwapPrice: Math.round(vwap * 1000000) / 1000000,
    vwapOdds: Math.round((1 / vwap) * 10000) / 10000,
    multiplyDisplayBetMoney: Math.round(totalUsdc * 7 * 10000) / 10000,
  }, null, 2));
}

// GET /data/order/{id}
const orderPath = `/data/order/${ORDER_ID}`;
const headers = buildPolymarketL2HeadersFromToken(acc.token, "GET", orderPath);
if (headers) {
  const res = await fetch(`${gateway.replace(/\/+$/, "")}${orderPath}`, { headers });
  const body = res.ok ? await res.json() : { error: res.status, text: await res.text() };
  console.log("orderEndpoint", JSON.stringify({
    ok: res.ok,
    status: body?.status,
    price: body?.price,
    original_size: body?.original_size,
    size_matched: body?.size_matched,
    associate_trades: body?.associate_trades,
    order_type: body?.order_type,
  }, null, 2));
}

await pool.end();
