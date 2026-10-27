#!/usr/bin/env node
/**
 * Polymarket Builder 成交 + changmen Polymarket 订单对照（CLI）
 *
 * 用法（在 server/backend 目录）：
 *   node scripts/ops/diagnostics/polymarket-builder-trades.mjs
 *   node scripts/ops/diagnostics/polymarket-builder-trades.mjs --date 2026-06-29
 *   node scripts/ops/diagnostics/polymarket-builder-trades.mjs --days 7
 *   node scripts/ops/diagnostics/polymarket-builder-trades.mjs --json
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { initDatabaseUrl } from "@changmen/db";
import { getPolymarketBuilderDashboard } from "../../../core/integrations/polymarket/builder_dashboard.js";

loadChangmenEnv();

function parseArgs(argv) {
  const out = { json: false, days: 1, date: null, maxPages: 5 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json")
      out.json = true;
    else if (arg === "--days" && argv[i + 1])
      out.days = Number(argv[++i]) || 1;
    else if (arg === "--date" && argv[i + 1])
      out.date = argv[++i];
    else if (arg === "--max-pages" && argv[i + 1])
      out.maxPages = Number(argv[++i]) || 5;
  }
  return out;
}

function rangeFromArgs(args) {
  if (args.date)
    return { date: args.date, maxPages: args.maxPages };
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, args.days));
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    maxPages: args.maxPages,
  };
}

const args = parseArgs(process.argv);
await initDatabaseUrl();
const data = await getPolymarketBuilderDashboard(rangeFromArgs(args));

if (args.json) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const poly = data.polymarket.summary;
const cm = data.changmen.summary;
console.log("=== Polymarket Builder ===");
console.log(`Builder Code: ${data.builderCode}`);
console.log(`Range: ${new Date(data.startMs).toISOString()} .. ${new Date(data.endMs).toISOString()}`);
console.log("");
console.log("[Polymarket 归因成交]");
console.log(`  成交笔数: ${poly.tradeCount}${data.polymarket.hasMore ? " (可能还有更多，增大 --max-pages)" : ""}`);
console.log(`  成交量 USDC: ${poly.volumeUsdc.toFixed(2)}`);
console.log(`  feeUsdc: ${poly.feeUsdc.toFixed(4)} (买 ${Number(poly.buyFeeUsdc || 0).toFixed(4)} / 卖 ${Number(poly.sellFeeUsdc || 0).toFixed(4)})`);
console.log(`  builderFee: ${Number(poly.builderFeeUsdc || 0).toFixed(4)} (买 ${Number(poly.buyBuilderFeeUsdc || 0).toFixed(4)} / 卖 ${Number(poly.sellBuilderFeeUsdc || 0).toFixed(4)})`);
console.log(`  BUY/SELL: ${poly.buyCount}/${poly.sellCount}`);
console.log("");
console.log("[changmen Polymarket 订单]");
console.log(`  订单数: ${cm.orderCount}`);
console.log(`  下注额: ${cm.totalBet.toFixed(2)}  盈亏: ${cm.totalProfit.toFixed(2)}`);
console.log(`  Win/Lose/Reject/Pending: ${cm.wins}/${cm.losses}/${cm.rejects}/${cm.pending}`);
console.log("");
if (data.polymarket.trades.length) {
  console.log("最近 Polymarket 成交:");
  for (const t of data.polymarket.trades.slice(0, 10)) {
    console.log(
      `  ${t.matchTimeIso || "-"} ${t.side} ${t.sizeUsdc.toFixed(2)} USDC feeUsdc=${Number(t.feeUsdc).toFixed(4)} builderFee=${Number(t.builderFeeUsdc || 0).toFixed(4)} @ ${t.price} user=${t.makerUserName || "-"} maker=${t.maker.slice(0, 10)}… tx=${t.transactionHash.slice(0, 12)}…`,
    );
  }
}
if (data.changmen.orders.length) {
  console.log("");
  console.log("最近 changmen 订单:");
  for (const o of data.changmen.orders.slice(0, 10)) {
    console.log(
      `  ${new Date(o.createAt).toISOString()} ${o.userName || o.userId} ${o.status} bet=${o.betMoney} ${o.matchTitle || o.item}`,
    );
  }
}
