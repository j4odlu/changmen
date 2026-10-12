#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * Phase 0 — 仓位双写覆盖率只读巡检（不写库）
 *
 * 度量：
 * - PM/PF 独立卖单行数量
 * - 仓位（买单）含 positionEvents.sells 的数量
 * - 卖单 id 已在父仓位事件中 / 缺失
 * - 仓位有减仓状态但无事件、或有事件但无对应卖单行
 *
 *   node scripts/ops/diagnostics/audit-position-dual-write.mjs
 *   node scripts/ops/diagnostics/audit-position-dual-write.mjs --days 30
 *   node scripts/ops/diagnostics/audit-position-dual-write.mjs --user GB13 --limit 20
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = { userName: "", days: 30, limit: 20, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--days")
      out.days = Math.max(1, Number(argv[++i]) || 30);
    else if (a === "--limit")
      out.limit = Math.max(5, Number(argv[++i]) || 20);
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function sideOf(row) {
  const raw = rawObj(row);
  const p = String(row.provider || "").trim();
  if (p === "Polymarket")
    return String(raw.pmSide || "").toLowerCase() === "sell" ? "sell" : "buy";
  if (p === "PredictFun")
    return String(raw.pfSide || "").toLowerCase() === "sell" ? "sell" : "buy";
  return "";
}

function parentBuyId(row) {
  const raw = rawObj(row);
  const p = String(row.provider || "").trim();
  if (p === "Polymarket")
    return String(raw.pmBuyOrderId || "").trim().toLowerCase();
  if (p === "PredictFun")
    return String(raw.pfBuyOrderId || "").trim().toLowerCase();
  return "";
}

function eventIds(row) {
  const raw = rawObj(row);
  const pe = raw.positionEvents && typeof raw.positionEvents === "object" ? raw.positionEvents : {};
  const sells = Array.isArray(pe.sells) ? pe.sells : (Array.isArray(raw.sells) ? raw.sells : []);
  const ids = new Set();
  for (const ev of sells) {
    const id = String(ev?.id ?? ev?.orderId ?? "").trim().toLowerCase();
    if (id)
      ids.add(id);
  }
  return ids;
}

function sellState(row) {
  const raw = rawObj(row);
  const p = String(row.provider || "").trim();
  if (p === "Polymarket")
    return String(raw.pmSellState || "").toLowerCase();
  if (p === "PredictFun")
    return String(raw.pfSellState || "").toLowerCase();
  return "";
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 18 ? `${s.slice(0, 12)}…` : s;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/diagnostics/audit-position-dual-write.mjs [--user NAME] [--days N] [--limit N]
`);
    process.exit(0);
  }

  initDatabaseUrl();
  const pool = getPgPool();
  if (!pool) {
    console.error("No DATABASE_URL / pool");
    process.exit(1);
  }

  const profiles = await fetchProfiles();
  const nameById = new Map();
  let filterUserId = null;
  for (const p of profiles) {
    const id = String(p.id ?? p.user_id ?? "");
    const name = String(p.user_name ?? p.userName ?? id).trim();
    nameById.set(id, name);
    if (args.userName && name.toLowerCase() === args.userName.toLowerCase())
      filterUserId = id;
  }
  if (args.userName && !filterUserId) {
    console.error(`user not found: ${args.userName}`);
    process.exit(1);
  }

  const since = Date.now() - args.days * 86400_000;
  const params = [since];
  let userClause = "";
  if (filterUserId) {
    params.push(filterUserId);
    userClause = ` AND user_id = $${params.length}::uuid`;
  }

  const { rows } = await pool.query(
    `SELECT id, user_id, player_id, order_id, provider, money, bet_money, create_at, raw
     FROM ${financialOrdersRelation()}
     WHERE create_at >= $1
       AND provider IN ('Polymarket', 'PredictFun')
       ${userClause}
     ORDER BY create_at DESC`,
    params,
  );

  const buys = [];
  const sells = [];
  for (const row of rows) {
    const side = sideOf(row);
    if (side === "sell")
      sells.push(row);
    else if (side === "buy")
      buys.push(row);
  }

  const buyByKey = new Map();
  for (const b of buys) {
    const key = `${b.user_id}|${String(b.order_id).trim().toLowerCase()}`;
    buyByKey.set(key, b);
  }

  let sellsWithParent = 0;
  let sellsParentMissing = 0;
  let sellsEventPresent = 0;
  let sellsEventMissing = 0;
  const eventMissingSamples = [];
  const parentMissingSamples = [];

  for (const s of sells) {
    const buyId = parentBuyId(s);
    if (!buyId) {
      sellsParentMissing += 1;
      if (parentMissingSamples.length < args.limit) {
        parentMissingSamples.push({
          user: nameById.get(String(s.user_id)) || s.user_id,
          provider: s.provider,
          sellId: shortId(s.order_id),
          reason: "no_buy_id",
        });
      }
      continue;
    }
    sellsWithParent += 1;
    const parent = buyByKey.get(`${s.user_id}|${buyId}`);
    if (!parent) {
      // 父仓位可能在窗口外：再查一次全库该 order_id（只读）
      const { rows: found } = await pool.query(
        `SELECT order_id, raw FROM ${financialOrdersRelation()}
         WHERE user_id = $1::uuid AND provider = $2
           AND lower(order_id) = $3
         LIMIT 1`,
        [s.user_id, s.provider, buyId],
      );
      if (!found[0]) {
        sellsParentMissing += 1;
        if (parentMissingSamples.length < args.limit) {
          parentMissingSamples.push({
            user: nameById.get(String(s.user_id)) || s.user_id,
            provider: s.provider,
            sellId: shortId(s.order_id),
            buyId: shortId(buyId),
            reason: "buy_row_absent",
          });
        }
        continue;
      }
      const ids = eventIds(found[0]);
      if (ids.has(String(s.order_id).trim().toLowerCase()))
        sellsEventPresent += 1;
      else {
        sellsEventMissing += 1;
        if (eventMissingSamples.length < args.limit) {
          eventMissingSamples.push({
            user: nameById.get(String(s.user_id)) || s.user_id,
            provider: s.provider,
            sellId: shortId(s.order_id),
            buyId: shortId(buyId),
          });
        }
      }
      continue;
    }
    const ids = eventIds(parent);
    if (ids.has(String(s.order_id).trim().toLowerCase()))
      sellsEventPresent += 1;
    else {
      sellsEventMissing += 1;
      if (eventMissingSamples.length < args.limit) {
        eventMissingSamples.push({
          user: nameById.get(String(s.user_id)) || s.user_id,
          provider: s.provider,
          sellId: shortId(s.order_id),
          buyId: shortId(buyId),
        });
      }
    }
  }

  let buysWithEvents = 0;
  let buysReducedNoEvents = 0;
  let buysMarketSettled = 0;
  let buysEventsNoSellRows = 0;
  const reducedNoEventSamples = [];
  const eventsNoSellSamples = [];

  const sellIdsByUser = new Map();
  for (const s of sells) {
    const uid = String(s.user_id);
    if (!sellIdsByUser.has(uid))
      sellIdsByUser.set(uid, new Set());
    sellIdsByUser.get(uid).add(String(s.order_id).trim().toLowerCase());
  }

  for (const b of buys) {
    const ids = eventIds(b);
    if (ids.size > 0)
      buysWithEvents += 1;
    const st = sellState(b);
    // partial/closed/closing = 手动减仓；settled = 赛果结算（非卖出流水，不应要求 positionEvents.sells）
    const manuallyReduced = st === "partial" || st === "closed" || st === "closing";
    if (st === "settled")
      buysMarketSettled += 1;
    if (manuallyReduced && ids.size === 0) {
      buysReducedNoEvents += 1;
      if (reducedNoEventSamples.length < args.limit) {
        reducedNoEventSamples.push({
          user: nameById.get(String(b.user_id)) || b.user_id,
          provider: b.provider,
          buyId: shortId(b.order_id),
          sellState: st || "(empty)",
        });
      }
    }
    if (ids.size > 0) {
      const knownSells = sellIdsByUser.get(String(b.user_id)) || new Set();
      let orphanEvents = 0;
      for (const id of ids) {
        if (!knownSells.has(id))
          orphanEvents += 1;
      }
      // 窗口内无对应卖单行的事件（可能卖单在窗口外或已单写）
      if (orphanEvents === ids.size) {
        buysEventsNoSellRows += 1;
        if (eventsNoSellSamples.length < args.limit) {
          eventsNoSellSamples.push({
            user: nameById.get(String(b.user_id)) || b.user_id,
            provider: b.provider,
            buyId: shortId(b.order_id),
            eventCount: ids.size,
          });
        }
      }
    }
  }

  const byProv = { Polymarket: { buy: 0, sell: 0 }, PredictFun: { buy: 0, sell: 0 } };
  for (const b of buys) {
    if (byProv[b.provider])
      byProv[b.provider].buy += 1;
  }
  for (const s of sells) {
    if (byProv[s.provider])
      byProv[s.provider].sell += 1;
  }

  console.log(`== audit-position-dual-write days=${args.days}${args.userName ? ` user=${args.userName}` : ""} ==`);
  console.log(`rows_in_window: ${rows.length}  buys: ${buys.length}  sells: ${sells.length}`);
  console.table([
    { provider: "Polymarket", buys: byProv.Polymarket.buy, sells: byProv.Polymarket.sell },
    { provider: "PredictFun", buys: byProv.PredictFun.buy, sells: byProv.PredictFun.sell },
  ]);
  console.log("\n-- sell rows vs parent events --");
  console.log(JSON.stringify({
    sells_total: sells.length,
    sells_with_parent_id: sellsWithParent,
    sells_parent_missing: sellsParentMissing,
    sells_event_present_on_buy: sellsEventPresent,
    sells_event_missing_on_buy: sellsEventMissing,
    coverage_pct: sells.length
      ? Math.round((1000 * sellsEventPresent) / Math.max(1, sellsWithParent || sells.length)) / 10
      : 100,
  }, null, 2));
  console.log("\n-- buy (position) health --");
  console.log(JSON.stringify({
    buys_total: buys.length,
    buys_with_position_events: buysWithEvents,
    buys_manually_reduced_but_no_events: buysReducedNoEvents,
    buys_market_settled: buysMarketSettled,
    buys_events_without_window_sell_rows: buysEventsNoSellRows,
  }, null, 2));

  if (eventMissingSamples.length) {
    console.log("\n-- samples: sell row missing on parent positionEvents --");
    console.table(eventMissingSamples);
  }
  if (parentMissingSamples.length) {
    console.log("\n-- samples: sell without resolvable parent buy --");
    console.table(parentMissingSamples);
  }
  if (reducedNoEventSamples.length) {
    console.log("\n-- samples: reduced position but no events --");
    console.table(reducedNoEventSamples);
  }
  if (eventsNoSellSamples.length) {
    console.log("\n-- samples: position events with no sell rows in window --");
    console.table(eventsNoSellSamples);
  }

  console.log("\nOK  read-only baseline complete (no writes)");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
