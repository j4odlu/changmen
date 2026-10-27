#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 修复：closed 买单 money=0，但关联卖单 raw.pmRealizedPnlUsdc 非 0。
 *   node scripts/ops/migrations/restore-pm-buy-money-from-sell-pnl.mjs --dry-run
 *   node scripts/ops/migrations/restore-pm-buy-money-from-sell-pnl.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");

const dryRun = !process.argv.includes("--execute");
initDatabaseUrl();
const pool = getPgPool();


const { rows } = await pool.query(`
  SELECT b.order_id AS buy_id, b.money AS buy_money, b.raw AS buy_raw,
         s.order_id AS sell_id, s.raw AS sell_raw
  FROM ${financialOrdersRelation("b")}
  JOIN ${financialOrdersRelation("s")}
    ON LOWER(s.raw->>'pmBuyOrderId') = LOWER(b.order_id)
   AND s.raw->>'pmSide' = 'sell'
   AND LOWER(TRIM(s.provider)) = 'polymarket'
  WHERE LOWER(TRIM(b.provider)) = 'polymarket'
    AND b.raw->>'pmSide' = 'buy'
    AND COALESCE(b.raw->>'pmSellState', '') IN ('closed', 'partial')
    AND ABS(COALESCE(b.money, 0)) <= 0.01
    AND ABS(COALESCE(NULLIF(s.raw->>'pmRealizedPnlUsdc', ''), '0')::float) > 1e-9
`);

const fx = getExchange(Currency.USDT);
const plan = [];
for (const r of rows) {
  const pnlUsdc = Number(r.sell_raw?.pmRealizedPnlUsdc) || 0;
  const moneyCny = Math.round(pnlUsdc * fx);
  if (moneyCny === 0)
    continue;
  plan.push({
    buyId: r.buy_id,
    sellId: r.sell_id,
    pnlUsdc,
    restoreMoney: moneyCny,
  });
}

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "execute", count: plan.length, plan }, null, 2));
if (dryRun) {
  console.log("[dry-run] no writes");
  process.exit(0);
}

const client = await pool.connect();

try {
  await client.query("BEGIN");
  for (const item of plan) {
    const { rows: buys } = await client.query(
      `SELECT order_id, money, raw FROM ${financialOrdersRelation()} WHERE order_id = $1 FOR UPDATE`,
      [item.buyId],
    );
    const buy = buys[0];
    if (!buy)
      continue;
    const raw = buy.raw && typeof buy.raw === "object" ? { ...buy.raw } : {};
    raw.money = item.restoreMoney;
    raw.pmBuyMoneyRestoredFromSellPnlUsdc = item.pnlUsdc;
    await client.query(
      `UPDATE ${financialOrdersRelation()} SET money = $2, raw = $3::jsonb WHERE order_id = $1`,
      [item.buyId, item.restoreMoney, JSON.stringify(raw)],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ applied: true, updated: plan.length }, null, 2));
}
catch (err) {
  await client.query("ROLLBACK");
  throw err;
}
finally {
  client.release();
}
