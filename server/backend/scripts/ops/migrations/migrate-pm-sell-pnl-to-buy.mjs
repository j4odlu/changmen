#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * 一次性：把 Polymarket 卖单 money 累加到对应买单，卖单 money 置 0。
 *
 * 决策：盈亏记买单；卖单只保留回款（bet_money）。日归因仍按买单 create_at。
 *
 *   node scripts/ops/migrations/migrate-pm-sell-pnl-to-buy.mjs --dry-run
 *   node scripts/ops/migrations/migrate-pm-sell-pnl-to-buy.mjs --user gb12 --dry-run
 *   node scripts/ops/migrations/migrate-pm-sell-pnl-to-buy.mjs --execute
 *   node scripts/ops/migrations/migrate-pm-sell-pnl-to-buy.mjs --user gb12 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = {
    dryRun: true,
    userName: "",
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function isPolymarket(provider) {
  return String(provider ?? "").trim().toLowerCase() === "polymarket";
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function sideOf(row) {
  return String(rawObj(row).pmSide ?? "").trim().toLowerCase();
}

function buyIdOf(row) {
  return String(rawObj(row).pmBuyOrderId ?? "").trim().toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/migrations/migrate-pm-sell-pnl-to-buy.mjs [--dry-run|--execute] [--user NAME]
`);
    process.exit(0);
  }

  initDatabaseUrl();
  const pool = getPgPool();
if (process.env.ORDERS_EXECUTION_COMPAT === "1") await prepareOrdersExecutionCompatibility(pool);
  if (!pool) {
    console.error("No DATABASE_URL / pool");
    process.exit(1);
  }

  let userIds = null;
  if (args.userName) {
    const profiles = await fetchProfiles();
    const want = args.userName.toLowerCase();
    userIds = profiles
      .filter(p => String(p.user_name ?? p.userName ?? "").toLowerCase() === want)
      .map(p => String(p.id ?? p.user_id ?? ""));
    if (!userIds.length) {
      console.error(`user not found: ${args.userName}`);
      process.exit(1);
    }
  }

  const sql = `
    SELECT order_id, user_id, player_id, provider, money, bet_money, create_at, raw
    FROM ${financialOrdersRelation()}
    WHERE LOWER(TRIM(provider)) = 'polymarket'
      ${userIds ? "AND user_id = ANY($1::text[])" : ""}
    ORDER BY create_at ASC
  `;
  const { rows } = userIds
    ? await pool.query(sql, [userIds])
    : await pool.query(sql);

  const byId = new Map();
  for (const r of rows)
    byId.set(String(r.order_id).trim().toLowerCase(), r);

  /** buyId -> { addMoney, sellIds: [] } */
  const buyAcc = new Map();
  const orphans = [];
  const sellZero = [];

  for (const sell of rows) {
    if (sideOf(sell) !== "sell")
      continue;
    const sellMoney = Number(sell.money) || 0;
    if (sellMoney === 0)
      continue;

    const buyId = buyIdOf(sell);
    if (!buyId || !byId.has(buyId)) {
      orphans.push({
        sellId: sell.order_id,
        buyId: buyId || null,
        money: sellMoney,
        userId: sell.user_id,
        playerId: sell.player_id,
      });
      continue;
    }

    const cur = buyAcc.get(buyId) || { addMoney: 0, sellIds: [] };
    cur.addMoney += sellMoney;
    cur.sellIds.push(String(sell.order_id));
    buyAcc.set(buyId, cur);
    sellZero.push(sell);
  }

  const report = {
    mode: args.dryRun ? "dry-run" : "execute",
    userFilter: args.userName || null,
    sellRowsToZero: sellZero.length,
    buysToUpdate: buyAcc.size,
    orphanSells: orphans.length,
    sampleBuys: [],
    orphans: orphans.slice(0, 30),
  };

  for (const [buyId, acc] of [...buyAcc.entries()].slice(0, 20)) {
    const buy = byId.get(buyId);
    report.sampleBuys.push({
      buyId: buy?.order_id ?? buyId,
      prevMoney: Number(buy?.money) || 0,
      addMoney: acc.addMoney,
      nextMoney: (Number(buy?.money) || 0) + acc.addMoney,
      sellCount: acc.sellIds.length,
      betMoney: Number(buy?.bet_money) || 0,
    });
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.dryRun) {
    console.log("\n[dry-run] no writes. Re-run with --execute to apply.");
    process.exit(0);
  }

  const client = await pool.connect();

  let updatedBuys = 0;
  let updatedSells = 0;
  try {
    await client.query("BEGIN");

    for (const [buyId, acc] of buyAcc) {
      const buy = byId.get(buyId);
      if (!buy)
        continue;
      const prevMoney = Number(buy.money) || 0;
      const nextMoney = prevMoney + acc.addMoney;
      const raw = rawObj(buy);
      raw.money = nextMoney;
      await client.query(
        `UPDATE ${financialOrdersRelation()} SET money = $2, raw = $3::jsonb WHERE order_id = $1`,
        [buy.order_id, nextMoney, JSON.stringify(raw)],
      );
      updatedBuys += 1;
    }

    for (const sell of sellZero) {
      const raw = rawObj(sell);
      const sellMoneyCny = Number(sell.money) || 0;
      if (sellMoneyCny !== 0) {
        raw.pmRealizedPnlMigratedFromSellMoneyCny = sellMoneyCny;
        if (raw.pmRealizedPnlUsdc == null)
          raw.pmRealizedPnlUsdc = 0;
      }
      raw.money = 0;
      await client.query(
        `UPDATE ${financialOrdersRelation()} SET money = 0, raw = $2::jsonb WHERE order_id = $1`,
        [sell.order_id, JSON.stringify(raw)],
      );
      updatedSells += 1;
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

  console.log(JSON.stringify({
    applied: true,
    updatedBuys,
    updatedSells,
    orphanSells: orphans.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
