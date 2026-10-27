#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 订单栏相关 RDS 只读全面巡检（不写库）
 *
 *   node scripts/ops/diagnostics/audit-order-sidebar-health.mjs
 *   node scripts/ops/diagnostics/audit-order-sidebar-health.mjs --user gb14
 *   node scripts/ops/diagnostics/audit-order-sidebar-health.mjs --days 14
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = { userName: "", days: 30, limit: 30, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--days")
      out.days = Math.max(1, Number(argv[++i]) || 30);
    else if (a === "--limit")
      out.limit = Math.max(5, Number(argv[++i]) || 30);
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function shTime(ms) {
  const t = Number(ms) || 0;
  if (!t)
    return "";
  return new Date(t).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 14 ? `${s.slice(0, 10)}…` : s;
}

function near(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/diagnostics/audit-order-sidebar-health.mjs [--user NAME] [--days N] [--limit N]
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
  for (const p of profiles) {
    const id = String(p.id ?? p.user_id ?? "");
    nameById.set(id, String(p.user_name ?? p.userName ?? id).trim());
  }

  let userIds = null;
  if (args.userName) {
    const want = args.userName.toLowerCase();
    userIds = profiles
      .filter(p => String(p.user_name ?? p.userName ?? "").toLowerCase() === want)
      .map(p => String(p.id ?? p.user_id ?? ""));
    if (!userIds.length) {
      console.error(`user not found: ${args.userName}`);
      process.exit(1);
    }
  }

  const sinceMs = Date.now() - args.days * 24 * 3600 * 1000;
  const params = [sinceMs];
  const filters = ["create_at >= $1"];
  if (userIds) {
    params.push(userIds);
    filters.push(`user_id = ANY($${params.length}::text[])`);
  }

  const { rows } = await pool.query(`
    SELECT order_id, user_id, player_id, provider, link, match, bet, item,
           money, bet_money, status, create_at, raw
    FROM ${financialOrdersRelation()}
    WHERE ${filters.join(" AND ")}
    ORDER BY create_at DESC
  `, params);

  const fx = getExchange(Currency.USDT);
  const byId = new Map();
  const pmBuys = [];
  const pmSells = [];
  const pfBuys = [];
  const pfSells = [];
  const other = [];

  for (const r of rows) {
    byId.set(String(r.order_id).trim().toLowerCase(), r);
    const prov = String(r.provider ?? "").trim().toLowerCase();
    const raw = rawObj(r);
    const side = String(raw.pmSide ?? raw.pfSide ?? "").toLowerCase();
    if (prov === "polymarket") {
      if (side === "sell")
        pmSells.push(r);
      else
        pmBuys.push(r);
    }
    else if (prov === "predictfun") {
      if (side === "sell" || String(raw.pfSide ?? "").toLowerCase() === "sell")
        pfSells.push(r);
      else
        pfBuys.push(r);
    }
    else {
      other.push(r);
    }
  }

  const sellsByBuy = new Map();
  for (const s of pmSells) {
    const buyId = String(rawObj(s).pmBuyOrderId ?? "").trim().toLowerCase();
    if (!buyId)
      continue;
    if (!sellsByBuy.has(buyId))
      sellsByBuy.set(buyId, []);
    sellsByBuy.get(buyId).push(s);
  }

  const pfSellsByBuy = new Map();
  for (const s of pfSells) {
    const buyId = String(rawObj(s).pfBuyOrderId ?? rawObj(s).pmBuyOrderId ?? "").trim().toLowerCase();
    if (!buyId)
      continue;
    if (!pfSellsByBuy.has(buyId))
      pfSellsByBuy.set(buyId, []);
    pfSellsByBuy.get(buyId).push(s);
  }

  const buckets = {
    pm_money_2x_sell_pnl: [],
    pm_buy_and_sell_both_money: [],
    pm_closed_money_mismatch: [],
    pm_attr_full_but_state_open: [],
    pm_sold_out_but_stake_left: [],
    pm_orphan_sell_no_buy: [],
    pm_sell_link_mismatch: [],
    pm_sell_missing_buy_id: [],
    pf_buy_and_sell_both_money: [],
    pf_closed_money_mismatch: [],
    pf_orphan_sell: [],
    pf_money_looks_already_cny: [],
    link_placeholder_only: [],
    status_win_lose_but_pm_manual_sold: [],
  };

  function sample(item) {
    return {
      user: nameById.get(String(item.user_id)) || item.user_id,
      playerId: item.player_id,
      orderId: shortId(item.order_id),
      match: item.match,
      item: item.item,
      money: num(item.money),
      betMoney: num(item.bet_money),
      status: item.status,
      link: item.link,
      createAtShanghai: shTime(item.create_at),
      ...item._extra,
    };
  }

  function push(bucket, row, extra = {}) {
    buckets[bucket].push(sample({ ...row, _extra: extra }));
  }

  // --- PM buys ---
  for (const buy of pmBuys) {
    const raw = rawObj(buy);
    const id = String(buy.order_id).trim().toLowerCase();
    const sells = sellsByBuy.get(id) || [];
    const state = String(raw.pmSellState ?? "").toLowerCase();
    const fill = num(raw.pmShares);
    const attr = num(raw.pmAttributedSellShares);
    const rem = Math.max(0, Math.round((fill - attr) * 10000) / 10000);
    const remEff = rem <= 0.01 ? 0 : rem;
    const stake = num(raw.pmStakeUsdc);
    const buyMoney = num(buy.money);
    const sellMoneySum = sells.reduce((s, x) => s + num(x.money), 0);

    let expected = 0;
    let hasPnl = false;
    for (const s of sells) {
      const pnl = num(rawObj(s).pmRealizedPnlUsdc);
      if (Math.abs(pnl) > 1e-9) {
        hasPnl = true;
        expected += Math.round(pnl * fx);
      }
    }
    if (!hasPnl) {
      for (const s of sells) {
        const proceeds = num(s.bet_money);
        const cost = num(rawObj(s).pmStakeUsdc);
        if (proceeds > 0 && cost > 0)
          expected += Math.round(proceeds - cost * fx);
      }
    }

    if (sells.length && Math.abs(expected) >= 5 && near(Math.abs(buyMoney), Math.abs(expected) * 2) && !near(Math.abs(buyMoney), Math.abs(expected)))
      push("pm_money_2x_sell_pnl", buy, { expected, sellCount: sells.length, state });

    if (sells.length && Math.abs(buyMoney) > 1 && Math.abs(sellMoneySum) > 1)
      push("pm_buy_and_sell_both_money", buy, { sellMoneySum, expected, state });

    if ((state === "closed" || state === "partial") && sells.length && Math.abs(expected) >= 5) {
      if (!near(Math.abs(buyMoney), Math.abs(expected), 3) && !near(Math.abs(buyMoney), Math.abs(expected) * 2, 3))
        push("pm_closed_money_mismatch", buy, { expected, state, sellCount: sells.length, delta: Math.round(buyMoney - expected) });
    }

    if (attr > 0.01 && state === "open")
      push("pm_attr_full_but_state_open", buy, { fill, attr, remEff, stake });

    if (remEff === 0 && (attr > 0 || sells.length) && stake > 0.05)
      push("pm_sold_out_but_stake_left", buy, { fill, attr, stake, state });

    const st = String(buy.status ?? "").toLowerCase();
    if ((st === "win" || st === "lose") && (state === "closed" || state === "partial") && sells.length)
      push("status_win_lose_but_pm_manual_sold", buy, { status: buy.status, state });
  }

  // --- PM sells ---
  for (const sell of pmSells) {
    const raw = rawObj(sell);
    const buyId = String(raw.pmBuyOrderId ?? "").trim().toLowerCase();
    if (!buyId) {
      push("pm_sell_missing_buy_id", sell, { origin: raw.pmOrigin });
      continue;
    }
    const buy = byId.get(buyId);
    if (!buy)
      push("pm_orphan_sell_no_buy", sell, { buyId: shortId(buyId), origin: raw.pmOrigin });
    else if (String(sell.link ?? "") !== String(buy.link ?? "") && Number(sell.link) && Number(buy.link))
      push("pm_sell_link_mismatch", sell, {
        sellLink: sell.link,
        buyLink: buy.link,
        buyId: shortId(buyId),
      });
  }

  // --- PF ---
  for (const buy of pfBuys) {
    const raw = rawObj(buy);
    const id = String(buy.order_id).trim().toLowerCase();
    const sells = pfSellsByBuy.get(id) || [];
    const state = String(raw.pfSellState ?? "").toLowerCase();
    const buyMoney = num(buy.money);
    const sellMoneySum = sells.reduce((s, x) => s + num(x.money), 0);
    const bet = num(buy.bet_money);

    // 库内应为 USDT；若 money 很大且像已×6.7（相对 bet），标可疑
    if (Math.abs(buyMoney) > 50 && Math.abs(bet) > 0 && Math.abs(buyMoney / bet) > 4)
      push("pf_money_looks_already_cny", buy, { ratio: Math.round((buyMoney / bet) * 100) / 100, state });

    if (sells.length && Math.abs(buyMoney) > 0.01 && Math.abs(sellMoneySum) > 0.01)
      push("pf_buy_and_sell_both_money", buy, { sellMoneySum, state });

    if (state === "closed" && sells.length) {
      const proceeds = sells.reduce((s, x) => s + num(x.bet_money), 0);
      const expected = Math.round((proceeds - bet) * 100) / 100;
      if (Math.abs(expected) >= 0.5 && !near(buyMoney, expected, 0.5) && !near(buyMoney, expected * fx, 2))
        push("pf_closed_money_mismatch", buy, { expectedUsdt: expected, buyMoney, state });
    }
  }

  for (const sell of pfSells) {
    const raw = rawObj(sell);
    const buyId = String(raw.pfBuyOrderId ?? raw.pmBuyOrderId ?? "").trim().toLowerCase();
    if (!buyId || !byId.get(buyId))
      push("pf_orphan_sell", sell, { buyId: shortId(buyId || "(missing)") });
  }

  // placeholder-only groups: link==create_at and no peers? skip heavy; count links with single reject?
  const summary = {
    scannedAtShanghai: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    windowDays: args.days,
    sinceShanghai: shTime(sinceMs),
    fx,
    totals: {
      orders: rows.length,
      pmBuys: pmBuys.length,
      pmSells: pmSells.length,
      pfBuys: pfBuys.length,
      pfSells: pfSells.length,
      other: other.length,
    },
    issueCounts: {},
    issues: {},
  };

  for (const [k, list] of Object.entries(buckets)) {
    summary.issueCounts[k] = list.length;
    summary.issues[k] = list.slice(0, args.limit);
  }

  const severity = {
    critical: ["pm_money_2x_sell_pnl", "pm_buy_and_sell_both_money"],
    high: [
      "pm_closed_money_mismatch",
      "pm_attr_full_but_state_open",
      "pm_sold_out_but_stake_left",
      "pm_orphan_sell_no_buy",
      "pf_buy_and_sell_both_money",
      "pf_closed_money_mismatch",
    ],
    medium: [
      "pm_sell_link_mismatch",
      "pm_sell_missing_buy_id",
      "pf_orphan_sell",
      "pf_money_looks_already_cny",
      "status_win_lose_but_pm_manual_sold",
    ],
  };

  const scored = { critical: 0, high: 0, medium: 0 };
  for (const [sev, keys] of Object.entries(severity)) {
    for (const k of keys)
      scored[sev] += summary.issueCounts[k] || 0;
  }
  summary.severityTotals = scored;

  console.log(JSON.stringify(summary, null, 2));
  await pool.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
