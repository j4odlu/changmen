#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 扫描 / 修复 PM 买单卖出盈亏双计：
 * - 0.99 纸面 win money + 卖出 PnL 累加 → money ≈ 2× 真实卖出盈亏
 * - 卖单仍保留 money 且买单也有 money（迁移双计风险）
 *
 *   node scripts/ops/incidents/scan-fix-pm-sell-pnl-double.mjs --dry-run
 *   node scripts/ops/incidents/scan-fix-pm-sell-pnl-double.mjs --execute
 *   node scripts/ops/incidents/scan-fix-pm-sell-pnl-double.mjs --match "SAW Youngsters" --execute
 *   node scripts/ops/incidents/scan-fix-pm-sell-pnl-double.mjs --user gb14 --dry-run
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

function parseArgs(argv) {
  const out = {
    dryRun: true,
    userName: "",
    match: "",
    help: false,
    /** 仅列出，不按「≈2×」自动改（仍可用 --match 点修） */
    scanOnly: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--scan-only")
      out.scanOnly = true;
    else if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--match")
      out.match = String(argv[++i] ?? "").trim();
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

/** 期望买单已实现盈亏 CNY：优先卖单 pmRealizedPnlUsdc 之和 */
function expectedBuyMoneyCny(sells, fx) {
  let fromPnl = 0;
  let fromProceedsCost = 0;
  let hasPnl = false;
  for (const s of sells) {
    const raw = rawObj(s);
    const pnlUsdc = num(raw.pmRealizedPnlUsdc);
    if (Math.abs(pnlUsdc) > 1e-9) {
      hasPnl = true;
      fromPnl += Math.round(pnlUsdc * fx);
    }
    const proceedsCny = num(s.bet_money);
    const costUsdc = num(raw.pmStakeUsdc);
    if (proceedsCny > 0 && costUsdc > 0)
      fromProceedsCost += Math.round(proceedsCny - costUsdc * fx);
  }
  if (hasPnl)
    return fromPnl;
  return fromProceedsCost;
}

function classifyIssue(buy, sells, fx) {
  const raw = rawObj(buy);
  const buyMoney = num(buy.money);
  const expected = expectedBuyMoneyCny(sells, fx);
  const sellMoneySum = sells.reduce((sum, s) => sum + num(s.money), 0);
  const state = String(raw.pmSellState ?? "").toLowerCase();
  const reasons = [];

  if (!(state === "closed" || state === "partial"))
    return null;
  if (!sells.length)
    return null;

  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  const absBuy = Math.abs(buyMoney);
  const absExp = Math.abs(expected);

  // 主问题：≈ 2× 卖出盈亏（纸面 + 卖出）
  if (absExp >= 5 && near(absBuy, absExp * 2) && !near(absBuy, absExp))
    reasons.push("money_approx_2x_sell_pnl");

  // 买单有盈亏且关联卖单仍非 0（旧模型残留 / 迁移双计）
  if (Math.abs(sellMoneySum) > 1 && absBuy > 1)
    reasons.push("buy_and_sell_both_have_money");

  // 买单 money 与卖单 pnl 差一整份 expected（且接近 sellMoneySum + expected）
  if (
    absExp >= 5
    && Math.abs(sellMoneySum) > 1
    && near(absBuy, absExp + Math.abs(sellMoneySum))
  ) {
    reasons.push("buy_money_equals_sell_money_plus_pnl");
  }

  // 期望可得但买单为 0（另一类：漏记）
  if (absExp >= 5 && absBuy <= 1)
    reasons.push("buy_money_zero_but_sell_pnl_nonzero");

  // 期望可得但偏差大（非 2×，供人工看）
  if (
    absExp >= 5
    && absBuy > 1
    && !near(absBuy, absExp)
    && !near(absBuy, absExp * 2)
    && Math.abs(absBuy - absExp) / absExp > 0.25
  ) {
    reasons.push("buy_money_far_from_sell_pnl");
  }

  if (!reasons.length)
    return null;

  return {
    orderId: buy.order_id,
    orderIdShort: shortId(buy.order_id),
    userId: buy.user_id,
    playerId: buy.player_id,
    match: buy.match,
    item: buy.item,
    bet: buy.bet,
    link: buy.link,
    createAtShanghai: shTime(buy.create_at),
    pmSellState: state,
    buyMoney,
    expectedMoneyCny: expected,
    suggestedMoneyCny: expected,
    sellMoneySum,
    sellCount: sells.length,
    sells: sells.map(s => ({
      orderId: shortId(s.order_id),
      money: num(s.money),
      betMoney: num(s.bet_money),
      pnlUsdc: num(rawObj(s).pmRealizedPnlUsdc),
      createAtShanghai: shTime(s.create_at),
    })),
    reasons,
    autoFixable: reasons.includes("money_approx_2x_sell_pnl")
      || reasons.includes("buy_money_zero_but_sell_pnl_nonzero"),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/incidents/scan-fix-pm-sell-pnl-double.mjs [--dry-run|--execute] [--user NAME] [--match SUBSTR]
`);
    process.exit(0);
  }

  initDatabaseUrl();
  const pool = getPgPool();

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

  const params = [];
  const filters = [`LOWER(TRIM(provider)) = 'polymarket'`];
  if (userIds) {
    params.push(userIds);
    filters.push(`user_id = ANY($${params.length}::text[])`);
  }
  if (args.match) {
    params.push(`%${args.match}%`);
    filters.push(`match ILIKE $${params.length}`);
  }

  const sql = `
    SELECT order_id, user_id, player_id, provider, link, match, bet, item,
           money, bet_money, status, create_at, raw
    FROM ${financialOrdersRelation()}
    WHERE ${filters.join(" AND ")}
    ORDER BY create_at DESC
  `;
  const { rows } = await pool.query(sql, params);
  const fx = getExchange(Currency.USDT);

  const buys = [];
  const sellsByBuy = new Map();
  for (const r of rows) {
    const side = String(rawObj(r).pmSide ?? "").toLowerCase();
    if (side === "sell") {
      const buyId = String(rawObj(r).pmBuyOrderId ?? "").trim().toLowerCase();
      if (!buyId)
        continue;
      if (!sellsByBuy.has(buyId))
        sellsByBuy.set(buyId, []);
      sellsByBuy.get(buyId).push(r);
      continue;
    }
    buys.push(r);
  }

  const issues = [];
  for (const buy of buys) {
    const id = String(buy.order_id).trim().toLowerCase();
    const sells = sellsByBuy.get(id) || [];
    const issue = classifyIssue(buy, sells, fx);
    if (issue)
      issues.push(issue);
  }

  const byReason = {};
  for (const iss of issues) {
    for (const r of iss.reasons) {
      byReason[r] = (byReason[r] || 0) + 1;
    }
  }

  const toFix = issues.filter((iss) => {
    if (args.match)
      return iss.autoFixable || iss.reasons.includes("money_approx_2x_sell_pnl");
    // 全库 execute：只自动修明确的 2× / 漏记
    return iss.autoFixable;
  });

  console.log(JSON.stringify({
    mode: args.dryRun ? "dry-run" : "execute",
    fx,
    scannedOrders: rows.length,
    buys: buys.length,
    issueCount: issues.length,
    byReason,
    issues,
    autoFixPlan: toFix.map(i => ({
      orderId: i.orderId,
      match: i.match,
      from: i.buyMoney,
      to: i.suggestedMoneyCny,
      reasons: i.reasons,
    })),
  }, null, 2));

  if (args.dryRun || args.scanOnly) {
    console.log(args.dryRun ? "[dry-run] no writes" : "[scan-only] no writes");
    process.exit(0);
  }

  if (!toFix.length) {
    console.log(JSON.stringify({ applied: false, updated: 0, note: "nothing auto-fixable" }, null, 2));
    process.exit(0);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const item of toFix) {
      const { rows: found } = await client.query(
        `SELECT order_id, money, raw FROM ${financialOrdersRelation()} WHERE order_id = $1 FOR UPDATE`,
        [item.orderId],
      );
      const row = found[0];
      if (!row)
        continue;
      const raw = rawObj(row);
      const prev = num(row.money);
      raw.money = item.suggestedMoneyCny;
      raw.pmMoneyFixedFromDoubleSellPnl = {
        prev,
        next: item.suggestedMoneyCny,
        expectedFromSellPnl: item.expectedMoneyCny,
        reasons: item.reasons,
        fixedAt: Date.now(),
      };
      if (Math.abs(num(raw.pmRealizedPnlUsdc)) < 1e-9 && item.sells?.length) {
        const pnlSum = item.sells.reduce((s, x) => s + num(x.pnlUsdc), 0);
        if (Math.abs(pnlSum) > 1e-9)
          raw.pmRealizedPnlUsdc = Math.round(pnlSum * 10000) / 10000;
      }
      await client.query(
        `UPDATE ${financialOrdersRelation()} SET money = $2, raw = $3::jsonb WHERE order_id = $1`,
        [item.orderId, item.suggestedMoneyCny, JSON.stringify(raw)],
      );
      updated += 1;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ applied: true, updated }, null, 2));
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
    await pool.end?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
