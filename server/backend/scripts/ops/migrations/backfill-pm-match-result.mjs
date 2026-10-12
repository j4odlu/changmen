#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 回填 Polymarket **买单** raw.pmMatchResult（赛果 win/lose）。
 *
 * 说明：
 * - 赛果写在买单上，不是卖单；含中途卖光（closed）的买单。
 * - 只改 raw.pmMatchResult，绝不改 money / status / bet_money。
 * - 优先用已有 Status=Win/Lose；否则查 Gamma/CLOB 市场赢家。
 * - 勿用 poly:backfill-settlement 对卖光单回填——那个会改 money/status。
 *
 *   node scripts/ops/migrations/backfill-pm-match-result.mjs --dry-run
 *   node scripts/ops/migrations/backfill-pm-match-result.mjs --user gb12 --days 90 --dry-run
 *   node scripts/ops/migrations/backfill-pm-match-result.mjs --days 365 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import {
  fetchGammaMarketsByConditionIds,
  enrichMarketsFromClob,
  lookupGammaMarket,
  resolvePolymarketSettlement,
} from "../../../core/integrations/polymarket/settlement.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool, fetchProfiles } = await import("@changmen/db");

const MARKET_CHUNK = 80;

function parseArgs(argv) {
  const out = {
    dryRun: true,
    userName: "",
    days: 365,
    limit: 20000,
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
      out.limit = Math.max(1, Number(argv[++i]) || 20000);
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function rawObj(row) {
  const raw = row?.raw;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

function sideOf(row) {
  return String(rawObj(row).pmSide ?? "").trim().toLowerCase();
}

/** Status Win/Lose → win/lose */
function matchResultFromStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "win" || s === "lose")
    return s;
  return null;
}

/** @returns {'win'|'lose'|null} */
function matchResultFromMarket(raw, market) {
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved)
    return null;
  const held = String(raw.pmTokenId ?? "").trim();
  if (!held)
    return null;
  return held === resolved.winningAssetId ? "win" : "lose";
}

async function fetchCandidateBuys(pool, { sinceMs, userName, limit }) {
  const params = [sinceMs];
  let sql = `
    SELECT o.order_id, o.user_id, o.player_id, o.status, o.bet_money, o.money,
           o.odds, o.create_at, o.raw, p.user_name
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles p ON p.id = o.user_id
    WHERE o.provider = 'Polymarket'
      AND o.create_at >= $1
      AND LOWER(COALESCE(o.raw->>'pmSide', 'buy')) IS DISTINCT FROM 'sell'
      AND (
        o.raw->>'pmMatchResult' IS NULL
        OR TRIM(COALESCE(o.raw->>'pmMatchResult', '')) = ''
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

async function writeMatchResult(pool, dryRun, row, result, via) {
  if (dryRun)
    return;
  await pool.query(
    `UPDATE ${financialOrdersRelation()}
     SET raw = jsonb_set(
       COALESCE(raw, '{}'::jsonb),
       '{pmMatchResult}',
       to_jsonb($1::text),
       true
     )
     WHERE user_id = $2 AND order_id = $3`,
    [result, row.user_id, row.order_id],
  );
}

async function loadMarketsForRows(rows) {
  const conditionIds = [];
  const tokenIds = [];
  for (const row of rows) {
    const raw = rawObj(row);
    if (raw.pmConditionId)
      conditionIds.push(String(raw.pmConditionId));
    if (raw.pmTokenId)
      tokenIds.push(String(raw.pmTokenId));
  }
  const marketMap = await fetchGammaMarketsByConditionIds(conditionIds, tokenIds);
  await enrichMarketsFromClob(marketMap, conditionIds);
  return marketMap;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`用法:
  node scripts/ops/migrations/backfill-pm-match-result.mjs [选项]

选项:
  --dry-run          仅预览（默认）
  --execute          写入 RDS（只写 raw.pmMatchResult）
  --user <登录名>     限定用户
  --days <N>         扫描近 N 天买单（默认 365）
  --limit <N>        最多处理条数（默认 20000）
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
  const rows = (await fetchCandidateBuys(pool, {
    sinceMs,
    userName: args.userName,
    limit: args.limit,
  })).filter(r => sideOf(r) !== "sell");

  console.log(`模式: ${args.dryRun ? "dry-run" : "execute"}`);
  console.log(`候选买单（无 pmMatchResult）: ${rows.length}（近 ${args.days} 天）`);

  let fromStatus = 0;
  let fromMarket = 0;
  let skippedNoToken = 0;
  let skippedNoMarket = 0;
  let skippedUnresolved = 0;
  const samples = [];
  const needMarket = [];

  // 1) Status 已是 Win/Lose → 直接当赛果（持有到期结算过的单）
  for (const row of rows) {
    const fromSt = matchResultFromStatus(row.status);
    if (fromSt) {
      fromStatus += 1;
      if (samples.length < 20) {
        samples.push({
          user: row.user_name || "",
          orderId: row.order_id,
          sellState: rawObj(row).pmSellState || "",
          status: row.status,
          matchResult: fromSt,
          via: "status",
          money: Number(row.money) || 0,
        });
      }
      await writeMatchResult(pool, args.dryRun, row, fromSt, "status");
      continue;
    }
    needMarket.push(row);
  }

  // 2) 其余（多为 closed + None）分批查市场
  for (let i = 0; i < needMarket.length; i += MARKET_CHUNK) {
    const chunk = needMarket.slice(i, i + MARKET_CHUNK);
    let marketMap;
    try {
      marketMap = await loadMarketsForRows(chunk);
    }
    catch (err) {
      console.warn(`市场查询失败 chunk@${i}:`, err.message);
      skippedUnresolved += chunk.length;
      continue;
    }

    for (const row of chunk) {
      const raw = rawObj(row);
      const tokenId = String(raw.pmTokenId ?? "").trim();
      if (!tokenId) {
        skippedNoToken += 1;
        continue;
      }
      const market = lookupGammaMarket(marketMap, {
        market: raw.pmConditionId,
        asset_id: tokenId,
      });
      if (!market) {
        skippedNoMarket += 1;
        continue;
      }
      const result = matchResultFromMarket(raw, market);
      if (!result) {
        skippedUnresolved += 1;
        continue;
      }
      fromMarket += 1;
      if (samples.length < 20) {
        samples.push({
          user: row.user_name || "",
          orderId: row.order_id,
          sellState: raw.pmSellState || "",
          status: row.status,
          matchResult: result,
          via: "market",
          money: Number(row.money) || 0,
        });
      }
      await writeMatchResult(pool, args.dryRun, row, result, "market");
    }
    if (needMarket.length > MARKET_CHUNK)
      console.log(`  市场批次 ${Math.min(i + MARKET_CHUNK, needMarket.length)}/${needMarket.length}`);
  }

  const written = fromStatus + fromMarket;
  console.log("\n样本（最多 20）:");
  for (const s of samples)
    console.log(`  ${s.user} ${s.orderId} sellState=${s.sellState || "-"} status=${s.status} → ${s.matchResult} via=${s.via} (money=${s.money} 不变)`);

  console.log(`\n写入赛果: ${written}（status 回填 ${fromStatus} + 市场 ${fromMarket}）`);
  console.log(`跳过无 token: ${skippedNoToken}`);
  console.log(`跳过无市场: ${skippedNoMarket}`);
  console.log(`跳过未 resolve: ${skippedUnresolved}`);

  if (args.dryRun) {
    console.log("\n确认后执行:");
    console.log("  node scripts/ops/migrations/backfill-pm-match-result.mjs --execute --days 365");
  }
  else {
    console.log("\n已写入 pmMatchResult（money/status 未改）。");
  }

  await pool.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
