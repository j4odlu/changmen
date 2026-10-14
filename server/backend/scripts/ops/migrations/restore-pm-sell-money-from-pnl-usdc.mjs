#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 恢复被 sync 清零的 PM 卖单 money（从 raw.pmRealizedPnlUsdc × 汇率还原 CNY）。
 *
 *   node scripts/ops/migrations/restore-pm-sell-money-from-pnl-usdc.mjs --dry-run
 *   node scripts/ops/migrations/restore-pm-sell-money-from-pnl-usdc.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool } = await import("@changmen/db");

function parseArgs(argv) {
  const out = { dryRun: true, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function pnlUsdcToMoneyCny(pnlUsdc) {
  // 对齐手动卖出：Math.round(usdc * FX)
  return Math.round((Number(pnlUsdc) || 0) * getExchange(Currency.USDT));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: restore-pm-sell-money-from-pnl-usdc.mjs [--dry-run|--execute]");
    process.exit(0);
  }

  initDatabaseUrl();
  const pool = getPgPool();

  if (!pool) {
    console.error("No pool");
    process.exit(1);
  }

  const { rows: sells } = await pool.query(`
    SELECT s.order_id, s.money, s.raw,
           b.order_id AS buy_id, b.money AS buy_money
    FROM ${financialOrdersRelation("s")}
    LEFT JOIN ${financialOrdersRelation("b")}
      ON LOWER(b.order_id) = LOWER(COALESCE(s.raw->>'pmBuyOrderId', ''))
     AND LOWER(TRIM(b.provider)) = 'polymarket'
    WHERE LOWER(TRIM(s.provider)) = 'polymarket'
      AND s.raw->>'pmSide' = 'sell'
      AND ABS(COALESCE(s.money, 0)) <= 0.01
      AND COALESCE(s.raw->>'pmBuyOrderId', '') <> ''
      AND ABS(COALESCE(NULLIF(s.raw->>'pmRealizedPnlUsdc', ''), '0')::float) > 1e-9
      AND ABS(COALESCE(b.money, 0)) <= 0.01
  `);

  const plan = [];
  for (const s of sells) {
    const raw = rawObj(s);
    const pnlUsdc = Number(raw.pmRealizedPnlUsdc) || 0;
    const moneyCny = pnlUsdcToMoneyCny(pnlUsdc);
    if (moneyCny === 0)
      continue;
    plan.push({
      sellId: s.order_id,
      buyId: s.buy_id,
      pnlUsdc,
      restoreMoney: moneyCny,
    });
  }

  console.log(JSON.stringify({
    mode: args.dryRun ? "dry-run" : "execute",
    restoreCount: plan.length,
    sample: plan.slice(0, 15),
  }, null, 2));

  if (args.dryRun) {
    console.log("\n[dry-run] no writes");
    process.exit(0);
  }

  const client = await pool.connect();

  let n = 0;
  try {
    await client.query("BEGIN");
    for (const item of plan) {
      const { rows } = await client.query(
        `SELECT order_id, money, raw FROM ${financialOrdersRelation()} WHERE order_id = $1 FOR UPDATE`,
        [item.sellId],
      );
      const row = rows[0];
      if (!row)
        continue;
      const raw = rawObj(row);
      raw.money = item.restoreMoney;
      raw.pmSellMoneyRestoredFromPnlUsdc = item.pnlUsdc;
      await client.query(
        `UPDATE ${financialOrdersRelation()} SET money = $2, raw = $3::jsonb WHERE order_id = $1`,
        [item.sellId, item.restoreMoney, JSON.stringify(raw)],
      );
      n += 1;
    }
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }

  console.log(JSON.stringify({ applied: true, updated: n }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
