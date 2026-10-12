import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * 回填：订单栏可见的 PM 买单 Money → 与 bet_money 含费口径对齐
 *
 * 输：money = -bet_money
 * 赢：money = shares*FX - bet_money；reward = shares*FX
 *
 * 排除：partial/closed 或已有卖出归因
 *
 *   node scripts/ops/migrations/align-pm-buy-money-to-bet.mjs --dry-run
 *   node scripts/ops/migrations/align-pm-buy-money-to-bet.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");

const dryRun = !process.argv.includes("--execute");
initDatabaseUrl();
const pool = getPgPool();
if (process.env.ORDERS_EXECUTION_COMPAT === "1") await prepareOrdersExecutionCompatibility(pool);
const FX = getExchange(Currency.USDT);

const { rows } = await pool.query(`
  SELECT
    o.id,
    o.order_id,
    o.status,
    o.bet_money::float8 AS bet,
    o.money::float8 AS money,
    o.raw,
    NULLIF(COALESCE(raw->>'pmShares', raw->>'PmShares'),'')::float8 AS shares,
    COALESCE(p.user_name, o.user_id::text) AS user_name,
    to_char(to_timestamp(o.create_at/1000.0) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day_cst
  FROM ${financialOrdersRelation("o")}
  LEFT JOIN profiles p ON p.id = o.user_id
  WHERE o.provider = 'Polymarket'
    AND COALESCE(raw->>'pmSide', raw->>'PmSide', 'buy') ILIKE 'buy'
    AND LOWER(o.status) IN ('win', 'lose', 'lost')
    AND COALESCE(o.bet_money, 0) > 0
    AND NULLIF(COALESCE(raw->>'pmShares', raw->>'PmShares'),'')::float8 > 0.0001
    AND COALESCE(raw->>'pmSellState', raw->>'PmSellState', '') NOT IN ('partial', 'closed')
    AND COALESCE(NULLIF(raw->>'pmAttributedSellShares', '')::float8, 0) <= 0.0001
`);

const plan = [];
for (const r of rows) {
  const st = String(r.status || "").toLowerCase();
  const bet = Number(r.bet) || 0;
  const money = Number(r.money) || 0;
  const shares = Number(r.shares) || 0;
  if (!(bet > 0) || !(shares > 0))
    continue;

  const fair = st === "win" ? shares * FX - bet : -bet;
  const visible = st === "win"
    ? Math.round(money) !== Math.round(shares * FX - bet)
    : Math.round(bet) !== Math.round(Math.abs(money));
  if (!visible)
    continue;

  const nextMoney = Math.round(fair * 10000) / 10000;
  const nextReward = st === "win" ? Math.round(shares * FX * 10000) / 10000 : 0;
  const delta = money - nextMoney;
  if (Math.abs(delta) < 0.005)
    continue;

  plan.push({
    id: r.id,
    order_id: r.order_id,
    user_name: r.user_name,
    day_cst: r.day_cst,
    status: st,
    bet,
    shares,
    oldMoney: money,
    nextMoney,
    nextReward,
    delta,
    raw: r.raw,
  });
}

const sumDelta = plan.reduce((s, p) => s + p.delta, 0);
const byUser = {};
const byDay = {};
for (const p of plan) {
  byUser[p.user_name] ??= { n: 0, reduce: 0 };
  byUser[p.user_name].n += 1;
  byUser[p.user_name].reduce += p.delta;
  byDay[p.day_cst] ??= { n: 0, reduce: 0 };
  byDay[p.day_cst].n += 1;
  byDay[p.day_cst].reduce += p.delta;
}

console.log(JSON.stringify({
  mode: dryRun ? "dry-run" : "execute",
  fx: FX,
  count: plan.length,
  totalReduceCny: Math.round(sumDelta * 100) / 100,
  byDay: Object.fromEntries(
    Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, { n: v.n, reduce: Math.round(v.reduce * 100) / 100 }]),
  ),
  byUser: Object.fromEntries(
    Object.entries(byUser)
      .map(([k, v]) => [k, { n: v.n, reduce: Math.round(v.reduce * 100) / 100 }])
      .sort((a, b) => b[1].reduce - a[1].reduce),
  ),
  sample: plan.slice(0, 3).map(p => ({
    user: p.user_name,
    st: p.status,
    bet: Math.round(p.bet),
    oldMoney: Math.round(p.oldMoney),
    nextMoney: Math.round(p.nextMoney),
  })),
}, null, 2));

if (dryRun) {
  console.log("[dry-run] no writes");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();

let updated = 0;
const BATCH = 50;
try {
  // 按 id 排序，缩短单事务，降低与线上写入死锁概率
  plan.sort((a, b) => Number(a.id) - Number(b.id));
  for (let i = 0; i < plan.length; i += BATCH) {
    const chunk = plan.slice(i, i + BATCH);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await client.query("BEGIN");
        for (const item of chunk) {
          const raw = item.raw && typeof item.raw === "object" && !Array.isArray(item.raw)
            ? { ...item.raw }
            : {};
          raw.money = item.nextMoney;
          if (item.status === "win")
            raw.reward = item.nextReward;
          raw.pmMoneyAlignedToBetAt = Date.now();
          raw.pmMoneyAlignedFrom = item.oldMoney;

          const oldRealized = Number(raw.pmRealizedPnlUsdc ?? raw.PmRealizedPnlUsdc);
          if (Number.isFinite(oldRealized) && Math.abs(oldRealized) > 1e-9)
            raw.pmRealizedPnlUsdc = Math.round((item.nextMoney / FX) * 10000) / 10000;

          const res = await client.query(
            `UPDATE ${financialOrdersRelation()}
             SET money = $2,
                 raw = $3::jsonb
             WHERE id = $1
               AND provider = 'Polymarket'
               AND COALESCE(raw->>'pmSide', raw->>'PmSide', 'buy') ILIKE 'buy'
               AND ABS(COALESCE(money, 0) - $4) < 0.01`,
            [item.id, item.nextMoney, JSON.stringify(raw), item.oldMoney],
          );
          if (res.rowCount === 1)
            updated += 1;
        }
        await client.query("COMMIT");
        break;
      }
      catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err && err.code === "40P01" && attempt < 3) {
          console.warn(`deadlock batch@${i} attempt ${attempt}, retry…`);
          await new Promise(r => setTimeout(r, 200 * attempt));
          continue;
        }
        throw err;
      }
    }
    process.stdout.write(`\rupdated ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }
  console.log("\n" + JSON.stringify({ applied: true, updated, planned: plan.length }, null, 2));
}
catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
}
finally {
  client.release();
  await pool.end();
}
