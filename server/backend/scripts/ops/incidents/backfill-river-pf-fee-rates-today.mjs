import { financialOrdersRelation } from "@changmen/db";
/**
 * 一次性：RIVER 今日 PredictFun 订单，按 pfMarketId 拉官方 feeRateBps 写回 orders.raw
 *
 * 用法（在 VPS server/backend 目录）：
 *   node scripts/ops/incidents/backfill-river-pf-fee-rates-today.mjs
 *   node scripts/ops/incidents/backfill-river-pf-fee-rates-today.mjs --apply
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { fetchPredictMarket } from "../../../core/integrations/predictfun/pf_api.js";

loadChangmenEnv();

const APPLY = process.argv.includes("--apply");
const USER_NAMES = ["River", "RIVER", "river"];

function localDayBounds(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

function todayKeyShanghai() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

async function resolveRiverUserId(pool) {
  const { rows } = await pool.query(
    `SELECT id, user_name FROM profiles
     WHERE lower(user_name) = ANY($1::text[])
     ORDER BY user_name
     LIMIT 5`,
    [USER_NAMES.map(s => s.toLowerCase())],
  );
  if (!rows.length)
    throw new Error("找不到用户 River/RIVER");
  console.log("[users]", rows.map(r => `${r.user_name}=${r.id}`).join(", "));
  return rows[0];
}

async function fetchRiverPfOrdersToday(pool, userId, dateKey) {
  const { start, end } = localDayBounds(dateKey);
  const { rows } = await pool.query(
    `SELECT id, order_id, create_at, status, match, raw
     FROM ${financialOrdersRelation()}
     WHERE user_id = $1
       AND provider = 'PredictFun'
       AND create_at >= $2 AND create_at < $3
     ORDER BY create_at ASC`,
    [String(userId), start, end],
  );
  return rows || [];
}

async function main() {
  const dateKey = process.env.DATE || todayKeyShanghai();
  console.log(`[backfill-rate] date=${dateKey} apply=${APPLY}`);

  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("无 PG pool");

  const user = await resolveRiverUserId(pool);
  const orders = await fetchRiverPfOrdersToday(pool, user.id, dateKey);
  console.log(`[orders] ${orders.length} PF rows`);

  const marketIds = [...new Set(
    orders
      .map(o => String(o.raw?.pfMarketId || "").trim())
      .filter(Boolean),
  )];
  console.log(`[markets] ${marketIds.length}: ${marketIds.join(", ") || "—"}`);

  /** @type {Map<string, number>} */
  const rateByMarket = new Map();
  for (const mid of marketIds) {
    try {
      const market = await fetchPredictMarket(mid);
      const bps = Number(market?.feeRateBps);
      if (Number.isFinite(bps) && bps >= 0) {
        rateByMarket.set(mid, bps);
        console.log(`  market ${mid} feeRateBps=${bps} (${bps / 100}%)`);
      }
      else {
        console.log(`  market ${mid} feeRateBps missing`);
      }
    }
    catch (e) {
      console.warn(`  market ${mid} fetch fail:`, e instanceof Error ? e.message : e);
    }
  }

  let updated = 0;
  for (const row of orders) {
    const raw = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {};
    const mid = String(raw.pfMarketId || "").trim();
    const bps = mid ? rateByMarket.get(mid) : undefined;
    const prev = Number(raw.pfFeeRateBps);
    if (bps == null) {
      console.log(`  SKIP #${row.id} no rate market=${mid || "—"}`);
      continue;
    }
    if (Number.isFinite(prev) && prev === bps) {
      console.log(`  OK   #${row.id} already ${bps}`);
      continue;
    }
    console.log(`  SET  #${row.id} pfFeeRateBps ${prev ?? "—"} → ${bps}`);
    if (APPLY) {
      const next = { ...raw, pfFeeRateBps: bps };
      await pool.query(`UPDATE ${financialOrdersRelation()} SET raw = $2::jsonb WHERE id = $1`, [
        row.id,
        JSON.stringify(next),
      ]);
      updated += 1;
    }
  }

  console.log(`[done] ${APPLY ? `updated ${updated}` : "dry-run"} rows`);
  await pool.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
