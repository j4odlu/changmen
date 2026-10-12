#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 为指定用户补绑近 N 天未关联的套利订单（SaveOrderBind 失败后的运维脚本）
 *
 *   node scripts/auto-rebind-arb-orders.mjs --user gb12 --days 5 --dry-run
 *   node scripts/auto-rebind-arb-orders.mjs --user gb12 --days 5 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const {
  getPgPool,
  updateOrderBind,
  isArbBindLink,
  isCreateAtPlaceholderLink,
  isHashLink,
  isInsertTimePlaceholderLink,
  ARB_LINK_MIN,
  ARB_LINK_CREATE_AT_TOLERANCE_MS,
} = await import("@changmen/db");

function parseArgs(argv) {
  const out = { userName: "", days: 5, dryRun: true };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--user")
      out.userName = argv[++i] ?? "";
    else if (a === "--days")
      out.days = Number(argv[++i]) || 5;
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function normMatch(m) {
  return String(m || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*vs\s*-?\s*/gi, " vs ")
    .replace(/\s*vs\s*/gi, " vs ")
    .trim();
}

function parseLogData(raw) {
  try {
    return JSON.parse(String(raw));
  }
  catch {
    return null;
  }
}

function matchFromCheckLog(row) {
  const p = parseLogData(row.data);
  return normMatch(p?.options?.match || "");
}

function providerFromTitle(title) {
  const m = String(title || "").match(/^\[([^\]]+)\]/);
  return m?.[1] || "";
}

/**
 * 未成功成组的订单（需补绑）。
 * 直写 attempt linkId 后：单腿已是 arb link、对侧仍占位时，两侧都可能需要进组；
 * 已是 arb link 且与 create_at 偏差在容差内 → 视为已绑，跳过（避免误改直写 Link）。
 */
function isUnboundOrder(row) {
  const link = Number(row.link);
  const ca = Number(row.create_at);
  if (!Number.isFinite(link) || link === 0)
    return true;
  if (!Number.isFinite(ca) || ca <= 0)
    return isHashLink(link) || !isArbBindLink(link);
  if (link === ca - 1)
    return true;
  if (isCreateAtPlaceholderLink(link, ca))
    return true;
  if (isHashLink(link))
    return true;
  if (isInsertTimePlaceholderLink(link, ca))
    return true;
  // 已是套利 Link：与场馆时间接近 → 直写/Bind 成功，勿再改
  if (isArbBindLink(link) && Math.abs(link - ca) <= ARB_LINK_CREATE_AT_TOLERANCE_MS)
    return false;
  if (isArbBindLink(link))
    return false;
  return link >= ARB_LINK_MIN && link > ca;
}

function buildAttemptsFromLogs(logs) {
  const checks = [];
  for (const row of logs) {
    if (!String(row.title).includes("请求盘口数据"))
      continue;
    const match = matchFromCheckLog(row);
    if (!match)
      continue;
    checks.push({
      at: Number(row.create_at),
      provider: providerFromTitle(row.title),
      match,
    });
  }

  const attempts = [];
  const used = new Set();
  for (let i = 0; i < checks.length; i += 1) {
    if (used.has(i))
      continue;
    const seed = checks[i];
    const group = [seed];
    used.add(i);
    for (let j = i + 1; j < checks.length; j += 1) {
      if (used.has(j))
        continue;
      const other = checks[j];
      if (other.match !== seed.match)
        continue;
      if (Math.abs(other.at - seed.at) > 5000)
        continue;
      if (group.some(g => g.provider === other.provider))
        continue;
      group.push(other);
      used.add(j);
    }
    if (group.length < 2)
      continue;
    const linkId = Math.min(...group.map(g => g.at));
    attempts.push({
      linkId,
      match: seed.match,
      providers: new Set(group.map(g => g.provider)),
    });
  }
  return attempts;
}

function pickOrdersForAttempt(attempt, orders, usedOrderIds) {
  const windowStart = attempt.linkId - 10_000;
  const windowEnd = attempt.linkId + 180_000;
  const byProvider = new Map();

  for (const row of orders) {
    if (usedOrderIds.has(String(row.order_id)))
      continue;
    if (!isUnboundOrder(row))
      continue;
    if (!attempt.providers.has(String(row.provider)))
      continue;
    if (normMatch(row.match) !== attempt.match)
      continue;
    const ca = Number(row.create_at);
    if (ca < windowStart || ca > windowEnd)
      continue;

    const prev = byProvider.get(row.provider);
    if (!prev || Math.abs(ca - attempt.linkId) < Math.abs(Number(prev.create_at) - attempt.linkId)) {
      byProvider.set(row.provider, row);
    }
  }
  return [...byProvider.values()];
}

function heuristicPairs(orders, usedOrderIds) {
  const remaining = orders
    .filter(o => !usedOrderIds.has(String(o.order_id)) && isUnboundOrder(o))
    .sort((a, b) => Number(a.create_at) - Number(b.create_at));

  const pairs = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const a = remaining[i];
    if (usedOrderIds.has(String(a.order_id)))
      continue;

    let best = null;
    let bestDelta = Infinity;
    for (let j = i + 1; j < remaining.length; j += 1) {
      const b = remaining[j];
      if (usedOrderIds.has(String(b.order_id)))
        continue;
      if (String(a.provider) === String(b.provider))
        continue;
      if (normMatch(a.match) !== normMatch(b.match))
        continue;
      const delta = Math.abs(Number(a.create_at) - Number(b.create_at));
      if (delta > 90_000)
        break;
      if (delta > 60_000)
        continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = b;
      }
    }
    if (!best)
      continue;

    const linkId = Math.min(Number(a.create_at), Number(best.create_at)) - 400;
    pairs.push({
      linkId,
      match: normMatch(a.match),
      orders: [a, best],
    });
    usedOrderIds.add(String(a.order_id));
    usedOrderIds.add(String(best.order_id));
  }
  return pairs;
}

const args = parseArgs(process.argv);
if (args.help || !args.userName) {
  console.log(`用法:
  node scripts/auto-rebind-arb-orders.mjs --user <登录名> [--days 5] [--dry-run|--execute]
`);
  process.exit(args.help ? 0 : 1);
}

const pool = getPgPool();
if (!pool) {
  console.error("无 DATABASE_URL / PG pool");
  process.exit(2);
}

const since = Date.now() - args.days * 24 * 60 * 60 * 1000;

const { rows: users } = await pool.query(
  "SELECT id, user_name FROM users WHERE user_name = $1",
  [args.userName],
);
if (!users.length) {
  console.error("用户不存在:", args.userName);
  process.exit(1);
}
const userId = String(users[0].id);
const userName = users[0].user_name;

const [{ rows: orders }, { rows: logs }] = await Promise.all([
  pool.query(
    `SELECT order_id, provider, link, create_at, match, bet, item, player_id, bet_money, odds
     FROM ${financialOrdersRelation()} WHERE user_id = $1 AND create_at >= $2
     ORDER BY create_at`,
    [userId, since],
  ),
  pool.query(
    `SELECT title, data, create_at FROM user_logs
     WHERE user_id = $1::uuid AND create_at >= $2 AND title LIKE '%请求盘口数据%'
     ORDER BY create_at`,
    [userId, since],
  ),
]);

const usedOrderIds = new Set();
const groups = [];

for (const attempt of buildAttemptsFromLogs(logs)) {
  const picked = pickOrdersForAttempt(attempt, orders, usedOrderIds);
  if (picked.length < 2)
    continue;
  for (const row of picked) usedOrderIds.add(String(row.order_id));
  groups.push({ source: "log", linkId: attempt.linkId, match: attempt.match, orders: picked });
}

for (const pair of heuristicPairs(orders, usedOrderIds)) {
  groups.push({ source: "heuristic", linkId: pair.linkId, match: pair.match, orders: pair.orders });
}

console.log(`--- ${userName} 近 ${args.days} 天补绑 ${args.dryRun ? "(dry-run)" : "(execute)"} ---`);
console.log({
  totalOrders: orders.length,
  unboundOrders: orders.filter(isUnboundOrder).length,
  groups: groups.length,
  ordersToBind: groups.reduce((n, g) => n + g.orders.length, 0),
});

for (const g of groups) {
  console.log(
    `\n[${g.source}] linkId=${g.linkId} match=${g.match}`,
  );
  for (const o of g.orders) {
    console.log(
      `  ${o.provider} ${o.order_id} create_at=${o.create_at} ${o.bet} / ${o.item} @${o.odds} $${o.bet_money}`,
    );
  }
}

if (args.dryRun) {
  console.log("\n--dry-run: 未写入 RDS");
  await pool.end();
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const g of groups) {
  for (const o of g.orders) {
    const bound = await updateOrderBind(String(o.order_id), userId, g.linkId, {
      provider: String(o.provider),
    });
    if (bound) {
      ok += 1;
    }
    else {
      fail += 1;
      console.warn("绑单失败:", o.provider, o.order_id, g.linkId);
    }
  }
}

console.log("\n完成:", { ok, fail });
await pool.end();
process.exit(fail > 0 ? 1 : 0);
