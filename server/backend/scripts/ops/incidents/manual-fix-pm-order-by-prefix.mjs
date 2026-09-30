#!/usr/bin/env node
/**
 * 按 order_id 前缀手动补结算单笔 PM 订单（Gamma raw 路径，无需 CLOB trade）
 *
 *   node scripts/manual-fix-pm-order-by-prefix.mjs --order-prefix 0x4a8d25e298ab95e84e --dry-run
 *   node scripts/manual-fix-pm-order-by-prefix.mjs --order-prefix 0x4a8d25e298ab95e84e --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { Currency, getExchange, scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import {
  fetchGammaMarketsByConditionIds,
  computePolymarketSettlementFromOrderRaw,
  lookupGammaMarket,
  mapDbStatus,
  enrichMarketsFromClob,
} from "../../../core/integrations/polymarket/settlement.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles, upsertOrders } = await import("@changmen/db");

function parseArgs(argv) {
  const out = { dryRun: true, orderPrefix: "", playerId: 0, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--order-prefix")
      out.orderPrefix = String(argv[++i] ?? "").trim().toLowerCase();
    else if (a === "--player-id")
      out.playerId = Number(argv[++i]) || 0;
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function stakeUsdcFromRow(row) {
  const raw = rawFromRow(row);
  const fromRaw = Number(raw.pmStakeUsdc);
  if (Number.isFinite(fromRaw) && fromRaw > 0)
    return fromRaw;
  const betCny = Number(row.bet_money) || 0;
  const fx = getExchange(Currency.USDT);
  if (betCny > 0 && fx > 0)
    return Math.round((betCny / fx) * 10000) / 10000;
  return 0;
}

/** 与 client / backfill 一致：卖光后勿 Gamma 纸面结算 */
function soldOutBlocksGammaSettlement(raw) {
  const fill = Number(raw.pmShares) || 0;
  const attr = Number(raw.pmAttributedSellShares) || 0;
  const rem = Math.round(Math.max(0, fill - attr) * 10000) / 10000;
  const remaining = rem <= 0.01 ? 0 : rem;
  if (remaining > 0.0001)
    return false;
  const state = String(raw.pmSellState ?? "").toLowerCase();
  if (state === "open" && attr > 0)
    return false;
  return attr > 0 || state === "closed";
}

function rawFromRow(row) {
  return typeof row.raw === "object" && row.raw && !Array.isArray(row.raw) ? row.raw : {};
}

const args = parseArgs(process.argv);
if (args.help || !args.orderPrefix) {
  console.log(`用法:
  node scripts/ops/incidents/manual-fix-pm-order-by-prefix.mjs --order-prefix <0x...> [--player-id N] [--dry-run|--execute]`);
  process.exit(args.help ? 0 : 1);
}

await initDatabaseUrl();
const pool = getPgPool();
if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const params = [`${args.orderPrefix}%`];
let sql = `
  SELECT o.*, p.user_name, p.accounts
  FROM orders o
  JOIN profiles p ON p.id = o.user_id
  WHERE LOWER(o.provider) = 'polymarket'
    AND LOWER(o.order_id) LIKE $1
`;
if (args.playerId > 0) {
  params.push(args.playerId);
  sql += ` AND o.player_id = $${params.length}`;
}
sql += " LIMIT 5";

const { rows } = await pool.query(sql, params);
if (!rows.length) {
  console.log("未找到匹配订单");
  process.exit(0);
}

const row = rows[0];
const raw = rawFromRow(row);
if (!raw.pmConditionId || !raw.pmTokenId) {
  console.error("订单 raw 缺少 pmConditionId / pmTokenId，无法 Gamma 结算");
  process.exit(1);
}
if (soldOutBlocksGammaSettlement(raw)) {
  console.error("该买单已卖光（或 closed），跳过 Gamma 补结算；盈亏应已在卖出路径");
  process.exit(1);
}

const accounts = Array.isArray(row.accounts) ? row.accounts : [];
const acc = accounts.find(a => Number(a.accountId ?? a.playerId) === Number(row.player_id));

const marketMap = await fetchGammaMarketsByConditionIds(
  [String(raw.pmConditionId)],
  [String(raw.pmTokenId)],
);
await enrichMarketsFromClob(marketMap, [String(raw.pmConditionId)]);

const market = lookupGammaMarket(marketMap, {
  market: raw.pmConditionId,
  asset_id: raw.pmTokenId,
});
if (!market) {
  console.error("Gamma 未找到市场");
  process.exit(1);
}

const stakeUsdc = stakeUsdcFromRow(row);
const computed = computePolymarketSettlementFromOrderRaw(raw, market, stakeUsdc);
if (!computed || computed.status === "none") {
  console.error("市场尚未可结算", computed);
  process.exit(1);
}

const nextMoney = scaleUsdtToCnyDisplay(computed.money);
const nextStatus = mapDbStatus(computed.status);

console.log(JSON.stringify({
  mode: args.dryRun ? "dry-run" : "execute",
  orderId: row.order_id,
  playerId: row.player_id,
  user: row.user_name,
  from: { status: row.status, money: row.money },
  to: { status: nextStatus, money: nextMoney },
  usdc: computed,
  pmSellState: "settled",
}, null, 2));

if (!args.dryRun) {
  await upsertOrders([{
    user_id: String(row.user_id),
    player_id: Number(row.player_id),
    order_id: String(row.order_id),
    link: row.link,
    provider: row.provider || "Polymarket",
    match: row.match || "",
    bet: row.bet || "",
    item: row.item || "",
    odds: Number(row.odds) || 0,
    bet_money: Number(row.bet_money) || 0,
    money: nextMoney,
    status: nextStatus,
    create_at: Number(row.create_at) || Date.now(),
    raw: {
      ...raw,
      status: computed.status,
      pmSellState: "settled",
      manualSettlement: { at: Date.now(), reason: "manual-fix-pm-order-by-prefix" },
    },
  }]);
  console.log("已写入 RDS");
}

await pool.end();
