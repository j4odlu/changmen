import { financialOrdersRelation } from "@changmen/db";
/**
 * 一次性：查 RIVER 今日 PredictFun 订单，从官方 GET /v1/account/activity
 * 的 MATCH_SUCCESS.fee 匹配手续费并写回 orders.raw
 *
 * 用法（在 VPS server/backend 目录）：
 *   node scripts/ops/incidents/backfill-river-pf-fees-today.mjs
 *   node scripts/ops/incidents/backfill-river-pf-fees-today.mjs --apply
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { fetchPredictFunHouseOrderJwt } from "../../../core/integrations/predictfun/pf_house_session.js";
import { predictFunGetAuth } from "../../../core/integrations/predictfun/pf_api.js";

loadChangmenEnv();

const APPLY = process.argv.includes("--apply");
const USER_NAMES = ["River", "RIVER", "river"];

function weiToUsdt(amountWei, type) {
  if (String(type ?? "").toUpperCase() === "SHARES")
    return undefined;
  const s = String(amountWei ?? "").trim();
  if (!s || !/^\d+$/.test(s))
    return undefined;
  try {
    const n = Number(BigInt(s)) / 1e18;
    if (!Number.isFinite(n) || n < 0)
      return undefined;
    return Math.round(n * 1e6) / 1e6;
  }
  catch {
    return undefined;
  }
}

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
    `SELECT id, order_id, player_id, create_at, bet_money, money, status, match, bet, item, odds, raw
     FROM ${financialOrdersRelation()}
     WHERE user_id = $1
       AND provider = 'PredictFun'
       AND create_at >= $2 AND create_at < $3
     ORDER BY create_at ASC`,
    [String(userId), start, end],
  );
  return rows || [];
}

async function fetchAllActivity(jwt, { maxPages = 30 } = {}) {
  const events = [];
  let cursor = "";
  for (let i = 0; i < maxPages; i += 1) {
    const qs = new URLSearchParams({ first: "50" });
    if (cursor)
      qs.set("after", cursor);
    const res = await predictFunGetAuth(`/v1/account/activity?${qs}`, jwt);
    const batch = Array.isArray(res?.data) ? res.data : [];
    events.push(...batch);
    const next = String(res?.cursor ?? "").trim();
    if (!next || !batch.length)
      break;
    cursor = next;
  }
  return events;
}

function activityCreatedMs(ev) {
  const t = Date.parse(String(ev?.createdAt ?? ""));
  return Number.isFinite(t) ? t : 0;
}

function feeFromActivity(ev) {
  const fee = ev?.order?.fee;
  if (!fee || typeof fee !== "object")
    return null;
  const amountWei = String(fee.amount ?? fee.amountWei ?? "").trim();
  if (!amountWei || !/^\d+$/.test(amountWei))
    return null;
  const type = String(fee.type ?? "").toUpperCase() === "SHARES" ? "SHARES" : "COLLATERAL";
  const usdt = weiToUsdt(amountWei, type);
  return { amountWei, type, usdt };
}

function marketIdOf(ev) {
  return String(ev?.market?.id ?? ev?.marketId ?? "").trim();
}

function orderHashOf(row) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return String(raw.pfOrderHash || row.order_id || "").trim().toLowerCase();
}

function pfMarketIdOf(row) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return String(raw.pfMarketId || "").trim();
}

function matchFees(orders, activities) {
  const matches = [];
  const usedActivity = new Set();
  const success = activities.filter(ev => String(ev?.name ?? "") === "MATCH_SUCCESS" && feeFromActivity(ev));

  for (const row of orders) {
    const hash = orderHashOf(row);
    const mid = pfMarketIdOf(row);
    const at = Number(row.create_at) || 0;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < success.length; i += 1) {
      if (usedActivity.has(i))
        continue;
      const ev = success[i];
      const evMid = marketIdOf(ev);
      if (mid && evMid && mid !== evMid)
        continue;
      const evAt = activityCreatedMs(ev);
      const dt = Math.abs(evAt - at);
      if (dt > 30 * 60_000)
        continue;
      if (dt < bestScore) {
        bestScore = dt;
        best = { i, ev, fee: feeFromActivity(ev), dt };
      }
    }
    if (best) {
      usedActivity.add(best.i);
      matches.push({
        row,
        hash,
        fee: best.fee,
        dtMs: best.dt,
        activityCreatedAt: best.ev.createdAt,
        activityTx: best.ev.transactionHash || null,
        marketId: marketIdOf(best.ev) || mid,
      });
    }
    else {
      matches.push({
        row,
        hash,
        fee: null,
        dtMs: null,
        activityCreatedAt: null,
        activityTx: null,
        marketId: mid,
      });
    }
  }
  return matches;
}

async function applyFee(pool, row, fee) {
  const prev = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {};
  const next = {
    ...prev,
    pfFeeAmountWei: fee.amountWei,
    pfFeeType: fee.type,
    ...(fee.usdt != null ? { pfFeeUsdt: fee.usdt } : {}),
  };
  await pool.query(
    `UPDATE ${financialOrdersRelation()} SET raw = $2::jsonb WHERE id = $1`,
    [row.id, JSON.stringify(next)],
  );
}

async function main() {
  const dateKey = process.env.DATE || todayKeyShanghai();
  console.log(`[backfill] date=${dateKey} apply=${APPLY}`);

  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("无 PG pool");

  const user = await resolveRiverUserId(pool);
  const orders = await fetchRiverPfOrdersToday(pool, user.id, dateKey);
  console.log(`[orders] ${orders.length} PF rows for ${user.user_name}`);
  if (!orders.length) {
    await pool.end?.();
    return;
  }

  for (const o of orders) {
    const raw = o.raw || {};
    console.log(
      `  #${o.id} ${new Date(Number(o.create_at)).toLocaleString("zh-CN")} `
      + `stake=${o.bet_money} status=${o.status} `
      + `hash=${String(raw.pfOrderHash || o.order_id).slice(0, 18)}… `
      + `feeUsdt=${raw.pfFeeUsdt ?? "—"} market=${raw.pfMarketId || "—"}`,
    );
  }

  console.log("[jwt] fetching house JWT…");
  const { jwt } = await fetchPredictFunHouseOrderJwt();
  console.log("[activity] fetching…");
  const activities = await fetchAllActivity(jwt);
  const matchSuccess = activities.filter(a => String(a?.name) === "MATCH_SUCCESS");
  console.log(`[activity] total=${activities.length} MATCH_SUCCESS=${matchSuccess.length}`);

  const withFee = matchSuccess.filter(a => feeFromActivity(a));
  console.log(`[activity] MATCH_SUCCESS with fee=${withFee.length}`);
  for (const ev of withFee.slice(0, 20)) {
    const fee = feeFromActivity(ev);
    console.log(
      `  act ${ev.createdAt} market=${marketIdOf(ev)} `
      + `fee=${fee?.usdt ?? fee?.amountWei} ${fee?.type}`,
    );
  }

  // 只给已成交（非 Reject）写费；Reject 一般无 MATCH_SUCCESS
  const fillable = orders.filter(o => String(o.status || "").toLowerCase() !== "reject");
  const matched = matchFees(fillable, activities);
  console.log("\n[match]");
  let write = 0;
  for (const m of matched) {
    const label = `${m.row.match || ""} / ${m.row.item || ""}`.trim();
    if (!m.fee) {
      console.log(`  MISS #${m.row.id} status=${m.row.status} ${label}`);
      continue;
    }
    console.log(
      `  HIT  #${m.row.id} status=${m.row.status} ${label} → feeUsdt=${m.fee.usdt ?? "—"} `
      + `type=${m.fee.type} wei=${m.fee.amountWei} dt=${Math.round(m.dtMs / 1000)}s`,
    );
    if (APPLY) {
      await applyFee(pool, m.row, m.fee);
      write += 1;
    }
  }

  if (APPLY)
    console.log(`[done] updated ${write} rows`);
  else
    console.log(`[dry-run] 加 --apply 才会写库`);

  await pool.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
