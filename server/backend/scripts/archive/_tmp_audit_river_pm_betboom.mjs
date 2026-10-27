#!/usr/bin/env node
/**
 * River pm/f43e：BetBoom vs Team Neme 买单+卖单 RDS vs Polymarket CLOB 对照
 */
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

const TOKEN_MICRO = 1_000_000;
const USDT_CNY = 7;

function shareCount(sizeRaw) {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (size >= 10_000) return size / TOKEN_MICRO;
  return size;
}

function usdcNotional(sizeRaw, price) {
  return Math.round(shareCount(sizeRaw) * Number(price) * 10000) / 10000;
}

function parsePostFill(side, makingAmount, takingAmount) {
  const making = Number(makingAmount);
  const taking = Number(takingAmount);
  const micro = (v) => (v >= 10_000 ? v / TOKEN_MICRO : v);
  if (side === "BUY") {
    return { stakeUsdc: micro(making), shares: shareCount(taking) };
  }
  return { proceedsUsdc: micro(taking), sharesSold: shareCount(making) };
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
const acc = playerRowToAccountRecord(playerRows[0]
  ? {
      id: playerRows[0].id,
      platformId: playerRows[0].platform_id,
      platformName: playerRows[0].platform_name,
      playerName: playerRows[0].player_name,
      provider: playerRows[0].provider,
      credit: playerRows[0].credit,
      totalBalance: playerRows[0].total_balance,
      accountData: playerRows[0].account_data,
      updatedAt: playerRows[0].updated_at,
    }
  : null);
if (!acc?.token) {
  console.error("River pm/f43e (accountId 47) token not found in players.account_data");
  process.exit(1);
}

const { rows: orders } = await pool.query(
  `SELECT order_id, link, bet_money, money, odds, status, create_at, raw
   FROM orders
   WHERE user_id = $1::uuid AND player_id = 47
     AND match ILIKE '%BetBoom%Neme%'
   ORDER BY create_at`,
  [userId],
);

console.log("=== RDS orders (BetBoom vs Team Neme) ===");
console.log("count", orders.length);
for (const o of orders) {
  const raw = o.raw && typeof o.raw === "object" ? o.raw : {};
  console.log(JSON.stringify({
    orderId: o.order_id?.slice(0, 18) + "…",
    orderIdFull: o.order_id,
    link: Number(o.link),
    side: raw.pmSide ?? "buy",
    betMoneyCny: Number(o.bet_money),
    moneyCny: Number(o.money),
    odds: Number(o.odds),
    status: o.status,
    createAt: o.create_at,
    pmShares: raw.pmShares,
    pmStakeUsdc: raw.pmStakeUsdc,
    pmBuyOrderId: raw.pmBuyOrderId ? String(raw.pmBuyOrderId).slice(0, 18) + "…" : undefined,
    pmOrigin: raw.pmOrigin,
    pmSellState: raw.pmSellState,
  }, null, 2));
}

const orderIds = orders.map(o => String(o.order_id).trim()).filter(Boolean);
const minCreate = orders.reduce((m, o) => Math.min(m, Number(o.create_at) || Infinity), Infinity);
const afterSec = Math.floor((minCreate - 24 * 60 * 60 * 1000) / 1000);

const config = parsePolymarketTokenConfig(acc.token);
const gateway = acc.gateway || "https://clob.polymarket.com";
const userAddresses = collectPolymarketUserAddresses(config);

const rawTrades = await fetchPolymarketTradesSince({
  token: acc.token,
  gateway,
  afterSec,
  maxPages: 30,
});
const flat = flattenPolymarketTrades(rawTrades, userAddresses);

console.log("\n=== Polymarket /data/trades (matched orderIds) ===");
for (const id of orderIds) {
  const legs = flat.filter(t => String(t.taker_order_id ?? "").trim().toLowerCase() === id.toLowerCase());
  let totalUsdc = 0;
  let totalShares = 0;
  console.log("\n--- orderId", id, "legs", legs.length, "---");
  for (const t of legs) {
    const shares = shareCount(t.size);
    const usdc = usdcNotional(t.size, t.price);
    totalUsdc += usdc;
    totalShares += shares;
    console.log(JSON.stringify({
      side: t.side,
      status: t.status,
      price: Number(t.price),
      odds: Number(t.price) > 0 ? Math.round((1 / Number(t.price)) * 10000) / 10000 : null,
      sizeRaw: t.size,
      shares,
      usdc,
      displayCny: Math.round(usdc * USDT_CNY),
      match_time: t.match_time,
    }));
  }
  if (legs.length) {
    console.log("tradeSummary", {
      totalShares: Math.round(totalShares * 10000) / 10000,
      totalUsdc: Math.round(totalUsdc * 10000) / 10000,
      displayBetMoneyCny: Math.round(totalUsdc * USDT_CNY),
    });
  }

  const orderPath = `/data/order/${id}`;
  const headers = buildPolymarketL2HeadersFromToken(acc.token, "GET", orderPath);
  if (headers) {
    const res = await fetch(`${gateway.replace(/\/+$/, "")}${orderPath}`, { headers });
    if (res.ok) {
      const body = await res.json();
      console.log("orderEndpoint", {
        status: body?.status,
        side: body?.side,
        price: body?.price,
        original_size: body?.original_size,
        size_matched: body?.size_matched,
        makingAmount: body?.makingAmount,
        takingAmount: body?.takingAmount,
      });
      if (body?.makingAmount != null || body?.takingAmount != null) {
        const side = String(body?.side ?? legs[0]?.side ?? "BUY").toUpperCase();
        const fill = parsePostFill(side, body.makingAmount, body.takingAmount);
        console.log("parsedPostFill", fill, "displayCny", {
          stakeOrProceeds: Math.round((fill.stakeUsdc ?? fill.proceedsUsdc ?? 0) * USDT_CNY),
          shares: fill.shares ?? fill.sharesSold,
        });
      }
    }
    else {
      console.log("orderEndpoint HTTP", res.status);
    }
  }
}

console.log("\n=== Diagnosis summary ===");
const buys = orders.filter(o => (o.raw?.pmSide ?? "buy") !== "sell");
const sells = orders.filter(o => o.raw?.pmSide === "sell");
const rdsBuyCost = buys.reduce((s, o) => s + Number(o.bet_money), 0);
const rdsSellProceeds = sells.reduce((s, o) => s + Number(o.bet_money), 0);
console.log({
  rdsBuyRows: buys.length,
  rdsSellRows: sells.length,
  rdsBuyCostCny: rdsBuyCost,
  rdsSellProceedsCny: rdsSellProceeds,
  rdsImpliedProfitCny: rdsSellProceeds - rdsBuyCost,
  rdsBuyMoneySum: buys.reduce((s, o) => s + Number(o.money), 0),
});

console.log("\n=== Share-count matching (sell → buy by pmShares) ===");
for (const s of sells) {
  const raw = s.raw && typeof s.raw === "object" ? s.raw : {};
  const sellShares = Number(raw.pmShares) || 0;
  const linkedBuy = buys.find(b => String(b.order_id).toLowerCase() === String(raw.pmBuyOrderId ?? "").toLowerCase());
  const bestBuy = buys.find(b => Math.abs(Number(b.raw?.pmShares ?? 0) - sellShares) < 0.01
    || Math.abs(Number(b.raw?.pmShares ?? 0) - sellShares) < 0.5);
  console.log({
    sellOrderId: String(s.order_id).slice(0, 18) + "…",
    sellShares,
    sellProceedsCny: Number(s.bet_money),
    pmBuyOrderId: raw.pmBuyOrderId ? String(raw.pmBuyOrderId).slice(0, 18) + "…" : null,
    linkedBuyShares: linkedBuy ? Number(linkedBuy.raw?.pmShares) : null,
    linkedBuyCostCny: linkedBuy ? Number(linkedBuy.bet_money) : null,
    bestMatchBuyId: bestBuy ? String(bestBuy.order_id).slice(0, 18) + "…" : null,
    bestMatchBuyCostCny: bestBuy ? Number(bestBuy.bet_money) : null,
    pmTokenId: raw.pmTokenId ? String(raw.pmTokenId).slice(0, 24) + "…" : null,
    misattributed: linkedBuy && Math.abs(Number(linkedBuy.raw?.pmShares ?? 0) - sellShares) > 0.5
      && bestBuy && String(bestBuy.order_id) !== String(linkedBuy.order_id),
  });
}

for (const b of buys) {
  const raw = b.raw && typeof b.raw === "object" ? b.raw : {};
  console.log("buy", {
    orderId: String(b.order_id).slice(0, 18) + "…",
    costCny: Number(b.bet_money),
    pmShares: raw.pmShares,
    pmTokenId: raw.pmTokenId ? String(raw.pmTokenId).slice(0, 24) + "…" : null,
    status: b.status,
    pmSellState: raw.pmSellState,
  });
}

await pool.end();
