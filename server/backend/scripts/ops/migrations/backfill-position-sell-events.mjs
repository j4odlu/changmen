#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 回填历史 PM/PF 卖单 → 买单 raw.positionEvents.sells[]（仓位事件镜像）。
 *
 * - 只改买单 raw.positionEvents；不改 money / bet_money / status；不删卖单行。
 * - 按 sell order_id 幂等 upsert，可重跑。
 * - 默认 --dry-run。
 *
 *   node scripts/ops/migrations/backfill-position-sell-events.mjs --dry-run
 *   node scripts/ops/migrations/backfill-position-sell-events.mjs --user gb12 --days 90 --dry-run
 *   node scripts/ops/migrations/backfill-position-sell-events.mjs --days 365 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  readPositionSellEvents,
  sellDbRowToPositionEvent,
  upsertPositionSellEvents,
} from "../../../core/account/order/position_events.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = {
    dryRun: true,
    userName: "",
    days: 365,
    limit: 50000,
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
    else if (a === "--days")
      out.days = Math.max(1, Number(argv[++i]) || 365);
    else if (a === "--limit")
      out.limit = Math.max(1, Number(argv[++i]) || 50000);
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function eventsSignature(sells) {
  return JSON.stringify(
    (sells || []).map(e => ({
      id: String(e.id ?? "").toLowerCase(),
      at: Number(e.at) || 0,
      shares: Number(e.shares) || 0,
      proceeds: Number(e.proceeds) || 0,
      price: Number(e.price) || 0,
      pnl: Number(e.pnl) || 0,
    })),
  );
}

async function fetchSellRows(pool, { sinceMs, userName, limit }) {
  const params = [sinceMs];
  let sql = `
    SELECT o.order_id, o.user_id, o.player_id, o.provider, o.bet_money,
           o.create_at, o.raw, p.user_name
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles p ON p.id = o.user_id
    WHERE o.create_at >= $1
      AND (
        (o.provider = 'Polymarket' AND LOWER(COALESCE(o.raw->>'pmSide', '')) = 'sell')
        OR (o.provider = 'PredictFun' AND LOWER(COALESCE(o.raw->>'pfSide', '')) = 'sell')
      )
  `;
  if (userName) {
    params.push(userName);
    sql += ` AND LOWER(p.user_name) = LOWER($${params.length})`;
  }
  params.push(limit);
  sql += ` ORDER BY o.create_at DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows || [];
}

async function fetchBuyRow(pool, userId, buyOrderId) {
  const { rows } = await pool.query(
    `SELECT order_id, user_id, provider, raw
     FROM ${financialOrdersRelation()}
     WHERE user_id = $1
       AND lower(order_id) = lower($2)
     LIMIT 1`,
    [userId, buyOrderId],
  );
  return rows?.[0] ?? null;
}

async function writeBuyEvents(pool, dryRun, buyRow, nextSells) {
  if (dryRun)
    return;
  const raw = rawObj(buyRow);
  raw.positionEvents = {
    ...(raw.positionEvents && typeof raw.positionEvents === "object" && !Array.isArray(raw.positionEvents)
      ? raw.positionEvents
      : {}),
    sells: nextSells,
  };
  await pool.query(
    `UPDATE ${financialOrdersRelation()} SET raw = $1::jsonb WHERE user_id = $2 AND order_id = $3`,
    [JSON.stringify(raw), buyRow.user_id, buyRow.order_id],
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`用法:
  node scripts/ops/migrations/backfill-position-sell-events.mjs [选项]

选项:
  --dry-run          仅预览（默认）
  --execute          写入买单 raw.positionEvents.sells（不改 money、不删卖单）
  --user <登录名>     限定用户
  --days <N>         扫描近 N 天卖单（默认 365）
  --limit <N>        最多扫描卖单条数（默认 50000）
`);
    process.exit(0);
  }

  initDatabaseUrl();
  const pool = getPgPool();
  if (!pool) {
    console.error("No DATABASE_URL / pool");
    process.exit(1);
  }

  if (args.userName) {
    const profiles = await fetchProfiles();
    const hit = profiles.some(
      p => String(p.user_name ?? p.userName ?? "").toLowerCase() === args.userName.toLowerCase(),
    );
    if (!hit) {
      console.error(`user not found: ${args.userName}`);
      process.exit(1);
    }
  }

  const sinceMs = Date.now() - args.days * 86_400_000;
  const sells = await fetchSellRows(pool, {
    sinceMs,
    userName: args.userName,
    limit: args.limit,
  });
  console.log(`扫描卖单: ${sells.length}（days=${args.days} dryRun=${args.dryRun}）`);

  /** key = userId|lower(buyId) → { buyRow, incoming[] } */
  const byBuy = new Map();
  let orphan = 0;
  let skippedUnmapped = 0;

  for (const sell of sells) {
    const mapped = sellDbRowToPositionEvent(sell);
    if (!mapped) {
      skippedUnmapped += 1;
      continue;
    }
    const key = `${sell.user_id}|${mapped.buyId.toLowerCase()}`;
    let bag = byBuy.get(key);
    if (!bag) {
      const buyRow = await fetchBuyRow(pool, sell.user_id, mapped.buyId);
      if (!buyRow) {
        orphan += 1;
        continue;
      }
      bag = { buyRow, incoming: [], userName: sell.user_name || "" };
      byBuy.set(key, bag);
    }
    bag.incoming.push(mapped.event);
  }

  let alreadyOk = 0;
  let wouldUpdate = 0;
  let updated = 0;
  const samples = [];

  for (const bag of byBuy.values()) {
    const prev = readPositionSellEvents(bag.buyRow.raw);
    const next = upsertPositionSellEvents(prev, bag.incoming);
    if (eventsSignature(prev) === eventsSignature(next)) {
      alreadyOk += 1;
      continue;
    }
    wouldUpdate += 1;
    if (samples.length < 25) {
      samples.push({
        user: bag.userName,
        buyId: bag.buyRow.order_id,
        prev: prev.length,
        next: next.length,
        added: next.length - prev.length,
      });
    }
    await writeBuyEvents(pool, args.dryRun, bag.buyRow, next);
    if (!args.dryRun)
      updated += 1;
  }

  console.log("\n样本（最多 25）:");
  for (const s of samples)
    console.log(`  ${s.user} buy=${s.buyId} events ${s.prev} → ${s.next} (Δ${s.added})`);

  console.log(`\n买单需更新: ${wouldUpdate}`);
  console.log(`已一致跳过: ${alreadyOk}`);
  console.log(`孤儿卖单（无买单）: ${orphan}`);
  console.log(`无法映射: ${skippedUnmapped}`);
  if (!args.dryRun)
    console.log(`已写入: ${updated}`);

  if (args.dryRun) {
    console.log("\n确认后执行:");
    console.log("  node scripts/ops/migrations/backfill-position-sell-events.mjs --execute --days 365");
    if (args.userName)
      console.log(`  （可先 --user ${args.userName}）`);
  }
  else {
    console.log("\n已回填 positionEvents（money/卖单行未改）。");
  }

  await pool.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
