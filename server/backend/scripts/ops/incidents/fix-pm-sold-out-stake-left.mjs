#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 清 PM 卖光买单残留 pmStakeUsdc（巡检 pm_sold_out_but_stake_left）
 *
 * 仅改 raw.pmStakeUsdc → 0；不动 money / bet_money / pmSellState。
 *
 *   node scripts/ops/incidents/fix-pm-sold-out-stake-left.mjs --dry-run
 *   node scripts/ops/incidents/fix-pm-sold-out-stake-left.mjs --user River --dry-run
 *   node scripts/ops/incidents/fix-pm-sold-out-stake-left.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

const PM_SHARE_DUST = 0.01;

function parseArgs(argv) {
  const out = { dryRun: true, userName: "", help: false };
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

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 14 ? `${s.slice(0, 10)}…` : s;
}

function shTime(ms) {
  const t = Number(ms) || 0;
  if (!t)
    return "";
  return new Date(t).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/ops/incidents/fix-pm-sold-out-stake-left.mjs [--user NAME] [--dry-run|--execute]
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
    SELECT id, user_id, player_id, order_id, match, item, money, bet_money, status, create_at, raw
    FROM ${financialOrdersRelation()}
    WHERE LOWER(COALESCE(provider, '')) = 'polymarket'
      AND LOWER(COALESCE(raw->>'pmSide', 'buy')) <> 'sell'
  `);

  const issues = [];
  for (const row of rows) {
    const userName = nameById.get(String(row.user_id ?? "")) || String(row.user_id ?? "");
    if (wantUser && userName.toLowerCase() !== wantUser)
      continue;

    const raw = rawObj(row);
    const fill = num(raw.pmShares);
    const attr = num(raw.pmAttributedSellShares);
    const rem = Math.round(Math.max(0, fill - attr) * 10000) / 10000;
    const remEff = rem <= PM_SHARE_DUST ? 0 : rem;
    const stake = num(raw.pmStakeUsdc);
    const state = String(raw.pmSellState ?? "").toLowerCase();

    if (remEff !== 0)
      continue;
    if (!(attr > 0 || state === "closed" || state === "settled" || state === "partial"))
      continue;
    if (!(stake > 0.05))
      continue;

    issues.push({
      id: row.id,
      user: userName,
      playerId: row.player_id,
      orderId: String(row.order_id),
      match: row.match,
      item: row.item,
      money: num(row.money),
      betMoney: num(row.bet_money),
      status: row.status,
      createAtShanghai: shTime(row.create_at),
      fill,
      attr,
      stake,
      state,
      raw,
    });
  }

  console.log(JSON.stringify({
    mode: args.dryRun ? "dry-run" : "execute",
    userFilter: args.userName || null,
    issueCount: issues.length,
    issues: issues.map(i => ({
      user: i.user,
      playerId: i.playerId,
      orderId: shortId(i.orderId),
      match: i.match,
      item: i.item,
      money: i.money,
      betMoney: i.betMoney,
      status: i.status,
      createAtShanghai: i.createAtShanghai,
      fill: i.fill,
      attr: i.attr,
      stake: i.stake,
      state: i.state,
    })),
  }, null, 2));

  if (args.dryRun) {
    console.log("[dry-run] no writes");
    process.exit(0);
  }

  let updated = 0;
  for (const i of issues) {
    const nextRaw = { ...i.raw, pmStakeUsdc: 0 };
    await pool.query(
      `UPDATE ${financialOrdersRelation()} SET raw = $2::jsonb WHERE id = $1`,
      [i.id, JSON.stringify(nextRaw)],
    );
    updated += 1;
  }
  console.log(`[execute] updated ${updated} rows (pmStakeUsdc → 0)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
