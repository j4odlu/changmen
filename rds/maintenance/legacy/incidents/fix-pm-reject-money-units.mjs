#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 回填 PM Reject 金额单位错误：
 * - bug：persist 把 checkBetting 后的 USDC 写进 bet_money，再被 ÷汇率当成 pmStakeUsdc
 * - 正确：pmStakeUsdc = 真实 U，bet_money = U × 汇率（CNY）；reward/money 拒单应为 0
 *
 * 幂等：写入 raw.pmRejectMoneyFixedAt；已标记的跳过。
 * 识别：把 bet 当 U 得到的份额≈正常 FOK（20–120），而 stake×odds 明显偏小。
 *
 *   node scripts/ops/incidents/fix-pm-reject-money-units.mjs --dry-run
 *   node scripts/ops/incidents/fix-pm-reject-money-units.mjs --user GB18 --dry-run
 *   node scripts/ops/incidents/fix-pm-reject-money-units.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { Currency, getExchange } from "@changmen/shared/currency";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

const FX = getExchange(Currency.USDT);

function parseArgs(argv) {
  const out = { dryRun: true, userName: "", help: false, limit: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--limit")
      out.limit = Math.max(0, Number(argv[++i]) || 0);
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

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * bet_money 被误存为 USDC：bet×odds ≈ 真实份额；pmStakeUsdc 被误写成 bet/fx。
 * 已修好：stake×odds ≈ 真实份额，bet×odds 会大一截（CNY×odds）。
 *
 * 另有半修复：bet 已乘汇率成 CNY，但 stake 仍是「U/汇率」→ bet/stake ≈ fx²。
 */
export function classifyPmRejectMoneyBug(row) {
  const raw = rawObj(row);
  if (String(raw.pmRejectMoneyFixedAt ?? "").trim())
    return null;
  if (String(raw.pmOrigin ?? "").toLowerCase() !== "changmen")
    return null;
  if (String(raw.pmSide ?? "buy").toLowerCase() === "sell")
    return null;
  const bet = num(row.bet_money);
  const stake = num(raw.pmStakeUsdc);
  const odds = num(row.odds);
  // 无 stake 不猜：CNY 小单 × odds 可落入份额带，易误判 inverted
  if (!(bet > 0) || !(stake > 0) || !(odds > 1))
    return null;

  // 半修复：CNY 已对，stake 仍小一档（bet/stake ≈ fx²）
  const ratio = bet / stake;
  if (Math.abs(ratio - FX * FX) <= FX * FX * 0.03) {
    return {
      kind: "half_fixed",
      newStake: round4(bet / FX),
      newBet: round4(bet),
    };
  }

  const sharesIfBetUsdc = bet * odds;
  if (sharesIfBetUsdc < 15 || sharesIfBetUsdc > 200)
    return null;
  const sharesIfStakeUsdc = stake * odds;
  if (!(sharesIfStakeUsdc < sharesIfBetUsdc / 3))
    return null;
  // 旧 sync：pmStakeUsdc ≈ bet_money(U) / fx
  if (Math.abs(stake * FX - bet) > Math.max(0.05, bet * 0.02))
    return null;
  return {
    kind: "inverted",
    newStake: round4(bet),
    newBet: round4(bet * FX),
  };
}

/** @deprecated 兼容旧调用名 */
export function isInvertedPmRejectMoney(row) {
  return Boolean(classifyPmRejectMoneyBug(row));
}

function planFix(row) {
  const raw = rawObj(row);
  const classified = classifyPmRejectMoneyBug(row);
  if (!classified)
    return null;
  const oldBet = num(row.bet_money);
  const oldStake = num(raw.pmStakeUsdc);
  return {
    orderId: String(row.order_id),
    userId: String(row.user_id),
    kind: classified.kind,
    oldBet,
    oldStake,
    newBet: classified.newBet,
    newStake: classified.newStake,
    odds: num(row.odds),
    oldReward: num(raw.reward),
    nextRaw: {
      ...raw,
      betMoney: classified.newBet,
      pmStakeUsdc: classified.newStake,
      reward: 0,
      money: 0,
      status: "reject",
      pmSide: "buy",
      pmOrigin: "changmen",
      pmRejectMoneyFixedAt: Date.now(),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/incidents/fix-pm-reject-money-units.mjs [--user NAME] [--limit N] [--dry-run|--execute]
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

  const wantUser = args.userName.toLowerCase();
  const { rows } = await pool.query(`
    SELECT id, user_id, order_id, bet_money, money, odds, status, raw, create_at
    FROM ${financialOrdersRelation()}
    WHERE provider = 'Polymarket'
      AND lower(status) = 'reject'
    ORDER BY create_at
  `);

  const candidates = [];
  for (const row of rows) {
    const uname = nameById.get(String(row.user_id)) || String(row.user_id);
    if (wantUser && uname.toLowerCase() !== wantUser)
      continue;
    const planned = planFix(row);
    if (!planned)
      continue;
    candidates.push({ ...planned, userName: uname, createAt: row.create_at, id: row.id });
  }

  const list = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;
  const byKind = list.reduce((m, c) => {
    m[c.kind] = (m[c.kind] || 0) + 1;
    return m;
  }, {});
  console.log(`[scan] reject rows=${rows.length} fixable=${candidates.length} apply=${list.length} kinds=${JSON.stringify(byKind)} fx=${FX} mode=${args.dryRun ? "dry-run" : "execute"}`);
  for (const c of list.slice(0, 30)) {
    console.log({
      user: c.userName,
      kind: c.kind,
      order: c.orderId.slice(0, 18),
      bet: `${c.oldBet} → ${c.newBet}`,
      stake: `${c.oldStake} → ${c.newStake}`,
      odds: c.odds,
      reward: `${c.oldReward} → 0`,
    });
  }
  if (list.length > 30)
    console.log(`… +${list.length - 30} more`);

  if (args.dryRun) {
    console.log("[dry-run] no writes");
    await pool.end?.();
    process.exit(0);
  }

  let updated = 0;
  for (const c of list) {
    const r = await pool.query(
      `UPDATE ${financialOrdersRelation()}
       SET bet_money = $1,
           money = 0,
           raw = $2::jsonb
       WHERE id = $3
         AND lower(status) = 'reject'
         AND coalesce(raw->>'pmRejectMoneyFixedAt', '') = ''
       RETURNING id`,
      [c.newBet, JSON.stringify(c.nextRaw), c.id],
    );
    if (r.rowCount)
      updated += 1;
  }
  console.log(`[execute] updated ${updated} rows`);
  await pool.end?.();
}

const isDirectRun = process.argv[1]
  && String(process.argv[1]).endsWith("fix-pm-reject-money-units.mjs");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
