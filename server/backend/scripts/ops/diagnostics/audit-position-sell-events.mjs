#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * changmen 仓位双写一致性巡检（只读，不写库）
 *
 * 扫描 PM/PF 卖单行，检查对应买单 raw.positionEvents.sells 是否含同 id。
 * - PM：仅 pmOrigin=changmen（external 官网 sync 故意不管）
 * - PF：有 pfBuyOrderId 的站内卖（house 代卖）
 *
 *   node scripts/ops/diagnostics/audit-position-sell-events.mjs
 *   node scripts/ops/diagnostics/audit-position-sell-events.mjs --days 90
 *   node scripts/ops/diagnostics/audit-position-sell-events.mjs --user gb12 --days 30
 *   node scripts/ops/diagnostics/audit-position-sell-events.mjs --days 365 --samples 40
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { readPositionSellEvents } from "../../../core/account/order/position_events.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = {
    userName: "",
    days: 365,
    limit: 50000,
    samples: 30,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--days")
      out.days = Math.max(1, Number(argv[++i]) || 365);
    else if (a === "--limit")
      out.limit = Math.max(1, Number(argv[++i]) || 50000);
    else if (a === "--samples")
      out.samples = Math.max(0, Number(argv[++i]) || 30);
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function orderIdKey(id) {
  return String(id ?? "").trim().toLowerCase();
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 18 ? `${s.slice(0, 12)}…` : s;
}

/**
 * @returns {{ kind: 'changmen'|'external'|'skip', buyId?: string, reason?: string }}
 */
function classifySell(row) {
  const raw = rawObj(row);
  const provider = String(row.provider ?? "").trim();

  if (provider === "Polymarket" && String(raw.pmSide ?? "").toLowerCase() === "sell") {
    const origin = String(raw.pmOrigin ?? "").trim().toLowerCase();
    if (origin === "external")
      return { kind: "external", reason: "pmOrigin=external" };
    // changmen 或未标 origin 的历史站内卖（回填/双写路径）
    const buyId = String(raw.pmBuyOrderId ?? "").trim();
    if (!buyId)
      return { kind: "skip", reason: "pm_no_buy_id" };
    if (origin && origin !== "changmen")
      return { kind: "skip", reason: `pmOrigin=${origin}` };
    return { kind: "changmen", buyId };
  }

  if (provider === "PredictFun" && String(raw.pfSide ?? "").toLowerCase() === "sell") {
    const buyId = String(raw.pfBuyOrderId ?? "").trim();
    if (!buyId)
      return { kind: "skip", reason: "pf_no_buy_id" };
    return { kind: "changmen", buyId };
  }

  return { kind: "skip", reason: "not_sell" };
}

async function fetchSellRows(pool, { sinceMs, userName, limit }) {
  const params = [sinceMs];
  let sql = `
    SELECT o.order_id, o.user_id, o.player_id, o.provider, o.create_at, o.raw,
           p.user_name
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
     WHERE user_id = $1 AND lower(order_id) = lower($2)
     LIMIT 1`,
    [userId, buyOrderId],
  );
  return rows?.[0] ?? null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`用法:
  node scripts/ops/diagnostics/audit-position-sell-events.mjs [选项]

选项:
  --user <登录名>   限定用户
  --days <N>       扫描近 N 天卖单（默认 365）
  --limit <N>      最多扫描卖单条数（默认 50000）
  --samples <N>    各类样本最多打印条数（默认 30）
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
  console.log(`扫描卖单行: ${sells.length}（days=${args.days}${args.userName ? ` user=${args.userName}` : ""}）`);

  let skippedExternal = 0;
  let skippedOther = 0;
  let ok = 0;
  let missingEvent = 0;
  let orphanSell = 0;

  /** @type {object[]} */
  const missingSamples = [];
  /** @type {object[]} */
  const orphanSamples = [];
  /** @type {Record<string, number>} */
  const skipReasons = {};

  /** cache: userId|lower(buyId) → buyRow | null */
  const buyCache = new Map();

  for (const sell of sells) {
    const cls = classifySell(sell);
    if (cls.kind === "external") {
      skippedExternal += 1;
      continue;
    }
    if (cls.kind !== "changmen") {
      skippedOther += 1;
      const r = cls.reason || "other";
      skipReasons[r] = (skipReasons[r] || 0) + 1;
      continue;
    }

    const buyKey = `${sell.user_id}|${orderIdKey(cls.buyId)}`;
    let buyRow;
    if (buyCache.has(buyKey)) {
      buyRow = buyCache.get(buyKey);
    }
    else {
      buyRow = await fetchBuyRow(pool, sell.user_id, cls.buyId);
      buyCache.set(buyKey, buyRow);
    }

    if (!buyRow) {
      orphanSell += 1;
      if (orphanSamples.length < args.samples) {
        orphanSamples.push({
          user: sell.user_name || "",
          provider: sell.provider,
          sellId: sell.order_id,
          buyId: cls.buyId,
        });
      }
      continue;
    }

    const events = readPositionSellEvents(buyRow.raw);
    const sellKey = orderIdKey(sell.order_id);
    const hit = events.some(e => orderIdKey(e.id) === sellKey);
    if (hit) {
      ok += 1;
      continue;
    }

    missingEvent += 1;
    if (missingSamples.length < args.samples) {
      missingSamples.push({
        user: sell.user_name || "",
        provider: sell.provider,
        sellId: sell.order_id,
        buyId: buyRow.order_id,
        buyEvents: events.length,
      });
    }
  }

  console.log("\n=== 基线汇总（仅 changmen） ===");
  console.log(`ok（事件已含卖单 id）: ${ok}`);
  console.log(`missing_event（有买单缺事件）: ${missingEvent}`);
  console.log(`orphan_sell（无父买单）: ${orphanSell}`);
  console.log(`skipped_external（pmOrigin=external）: ${skippedExternal}`);
  console.log(`skipped_other: ${skippedOther}`);
  if (Object.keys(skipReasons).length) {
    console.log("  skip 原因:");
    for (const [k, n] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1]))
      console.log(`    ${k}: ${n}`);
  }

  if (missingSamples.length) {
    console.log(`\nmissing_event 样本（${missingSamples.length}）:`);
    for (const s of missingSamples) {
      console.log(
        `  ${s.user} ${s.provider} sell=${shortId(s.sellId)} buy=${shortId(s.buyId)} buyEvents=${s.buyEvents}`,
      );
    }
  }
  if (orphanSamples.length) {
    console.log(`\norphan_sell 样本（${orphanSamples.length}）:`);
    for (const s of orphanSamples) {
      console.log(
        `  ${s.user} ${s.provider} sell=${shortId(s.sellId)} buyId=${shortId(s.buyId)}`,
      );
    }
  }

  const changmenTotal = ok + missingEvent + orphanSell;
  console.log(`\nchangmen 卖单合计: ${changmenTotal}`);
  if (missingEvent === 0 && orphanSell === 0)
    console.log("结论: 基线干净（无 missing_event / orphan_sell）");
  else if (missingEvent === 0)
    console.log("结论: 无缺事件；存在孤儿卖单（买单已删或 id 错）");
  else
    console.log("结论: 存在缺事件 — 可用 backfill-position-sell-events.mjs 补，或查写路径回归");

  const exitCode = missingEvent > 0 ? 2 : 0;
  await pool.end?.();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
