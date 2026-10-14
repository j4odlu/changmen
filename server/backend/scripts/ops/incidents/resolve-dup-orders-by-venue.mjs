#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 用场馆 API 判定重复 order_id 的真实归属 player，仅删除重复组内的多余副本。
 * 非重复 order_id 的订单一律不碰。
 *
 *   node scripts/resolve-dup-orders-by-venue.mjs --user GB14 --dry-run
 *   node scripts/resolve-dup-orders-by-venue.mjs --user GB14 --execute
 *   node scripts/resolve-dup-orders-by-venue.mjs --user GB13 --month 2026-07 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { playerRowToAccountRecord } from "../../../../db/player_account_record.js";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");

function parseArgs(argv) {
  const out = { dryRun: true, userName: "", month: "", provider: "OB", help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute")
      out.dryRun = false;
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "--user")
      out.userName = String(argv[++i] ?? "").trim();
    else if (a === "--month")
      out.month = String(argv[++i] ?? "").trim();
    else if (a === "--provider")
      out.provider = String(argv[++i] ?? "OB").trim();
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function obHeaders(account) {
  const mobile = Boolean(account.userAgent && /mobile/i.test(account.userAgent));
  const h = {
    device: mobile ? "2" : "1",
    lang: "cn",
    token: account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
  if (account.userAgent)
    h["User-Agent"] = account.userAgent;
  if (account.referer)
    h.Referer = account.referer;
  return h;
}

function obTimeChunks(startMs, endMs) {
  const chunks = [];
  const start = new Date(startMs);
  const end = new Date(endMs);
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    if (chunkEnd > end)
      chunkEnd.setTime(end.getTime());
    chunks.push({
      begin: `${formatDateKey(cur)} 00:00:00`,
      end: `${formatDateKey(chunkEnd)} 23:59:59`,
    });
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1);
  }
  return chunks;
}

async function fetchObOrderIds(account, beginTime, endTime) {
  const ids = new Set();
  for (const status of [1, 2]) {
    let page = 1;
    for (;;) {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: "100",
        begin_time: beginTime,
        end_time: endTime,
        status: String(status),
      });
      const url = `${String(account.gateway).replace(/\/$/, "")}/game/orderList?${qs}`;
      const res = await fetch(url, { method: "GET", headers: obHeaders(account) });
      const text = await res.text();
      if (res.status >= 400)
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      const data = JSON.parse(text);
      if (!data || data.status !== "true")
        break;
      const bets = data.data?.bet ?? [];
      for (const row of bets) {
        const id = String(row.id ?? "");
        if (id)
          ids.add(id);
      }
      if (bets.length < 100)
        break;
      page += 1;
      await sleep(200);
    }
    await sleep(200);
  }
  return ids;
}

async function fetchObPlayerIndex(account, startMs, endMs) {
  const all = new Set();
  for (const chunk of obTimeChunks(startMs, endMs)) {
    const part = await fetchObOrderIds(account, chunk.begin, chunk.end);
    for (const id of part)
      all.add(id);
    await sleep(400);
  }
  return all;
}

function backupTableName(userName) {
  const slug = userName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `orders_dup_venue_resolve_backup_${slug}_20260712`;
}

function printHelp() {
  console.log(`
用法:
  node scripts/resolve-dup-orders-by-venue.mjs --user GB14 --dry-run
  node scripts/resolve-dup-orders-by-venue.mjs --user GB14 --execute

仅处理 RDS 内重复 order_id 组（同 user + provider + order_id 多 player）。
场馆 API 判定真实 owner；只删组内非 owner 副本。非重复单绝不删除。
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.userName) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  await initDatabaseUrl();
  const pool = getPgPool();

  if (!pool) {
    console.error("DATABASE_URL 未配置");
    process.exit(1);
  }

  const { rows: users } = await pool.query(
    `SELECT id, user_name FROM users WHERE user_name ILIKE $1 LIMIT 1`,
    [args.userName],
  );
  const userId = users[0]?.id;
  if (!userId) {
    console.error(`用户 ${args.userName} 不存在`);
    process.exit(1);
  }

  const provider = args.provider;

  const dupGroups = await pool.query(
    `SELECT o.provider, o.order_id,
            COUNT(*)::int AS rows,
            array_agg(o.id ORDER BY o.player_id) AS order_row_ids,
            array_agg(o.player_id ORDER BY o.player_id) AS player_ids,
            MIN(o.create_at)::bigint AS min_create_at,
            MAX(o.create_at)::bigint AS max_create_at
     FROM ${financialOrdersRelation("o")}
     WHERE o.user_id = $1::uuid AND o.provider = $2
     GROUP BY o.provider, o.order_id
     HAVING COUNT(*) > 1
     ORDER BY o.order_id`,
    [userId, provider],
  );

  if (!dupGroups.rows.length) {
    console.log(`${args.userName} 无 ${provider} 重复 order_id`);
    await pool.end();
    return;
  }

  console.log(`${args.userName} ${provider} 重复组: ${dupGroups.rows.length}`);

  let startMs = Math.min(...dupGroups.rows.map(g => Number(g.min_create_at)));
  let endMs = Math.max(...dupGroups.rows.map(g => Number(g.max_create_at)));
  if (args.month) {
    const m = args.month.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      startMs = new Date(y, mo - 1, 1).getTime();
      endMs = new Date(y, mo, 0, 23, 59, 59, 999).getTime();
    }
  }
  // 前后各扩 1 天
  startMs -= 86400000;
  endMs += 86400000;

  const { rows: playerRows } = await pool.query(
    `SELECT pl.*
     FROM players pl
     WHERE pl.owner_user_id = $1::uuid
       AND pl.deleted_at IS NULL
       AND pl.provider = $2
     ORDER BY pl.id`,
    [userId, provider],
  );

  const players = playerRows.map(row => ({
    playerId: Number(row.id),
    label: `${row.id} ${row.platform_name}/${row.player_name}`,
    account: playerRowToAccountRecord({
      id: row.id,
      platformName: row.platform_name,
      playerName: row.player_name,
      provider: row.provider,
      accountData: row.account_data,
    }),
  }));

  console.log(`拉场馆 ${provider} orderList ${formatDateKey(new Date(startMs))} .. ${formatDateKey(new Date(endMs))}`);
  /** @type {Map<string, number>} order_id -> player_id */
  const venueOwner = new Map();
  /** @type {Map<string, Set<number>>} order_id -> players that have it */
  const venueHits = new Map();

  /** @type {Array<{playerId:number, label:string, error:string}>} */
  const fetchErrors = [];

  for (const p of players) {
    const { account, playerId, label } = p;
    if (!account.gateway || !account.token) {
      console.log(`  [SKIP] ${label} 无凭证`);
      continue;
    }
    try {
      const ids = await fetchObPlayerIndex(account, startMs, endMs);
      console.log(`  ${label}: 场馆 ${ids.size} 条`);
      for (const orderId of ids) {
        if (!venueHits.has(orderId))
          venueHits.set(orderId, new Set());
        venueHits.get(orderId).add(playerId);
      }
    }
    catch (err) {
      console.error(`  [ERR] ${label}: ${err.message}`);
      fetchErrors.push({ playerId, label, error: err.message });
    }
  }

  if (fetchErrors.length === players.length) {
    console.error("全部 OB 账号拉单失败，中止");
    process.exit(1);
  }

  for (const [orderId, hits] of venueHits) {
    if (hits.size === 1)
      venueOwner.set(orderId, [...hits][0]);
    else if (hits.size > 1)
      console.warn(`  [WARN] 场馆多账号同 order_id=${orderId}: ${[...hits].join(",")}`);
  }

  /** @type {Array<{id:number, order_id:string, player_id:number, keep:number, reason:string}>} */
  const toDelete = [];
  /** @type {Array<{order_id:string, reason:string}>} */
  const skipped = [];

  for (const g of dupGroups.rows) {
    const orderId = String(g.order_id);
    const rowIds = g.order_row_ids.map(Number);
    const playerIds = g.player_ids.map(Number);
    const owner = venueOwner.get(orderId);

    if (!owner) {
      skipped.push({ order_id: orderId, reason: "场馆未命中任何账号" });
      continue;
    }
    if (!playerIds.includes(owner)) {
      skipped.push({ order_id: orderId, reason: `场馆 owner=${owner} 不在 RDS 重复组 [${playerIds.join(",")}]` });
      continue;
    }

    for (let i = 0; i < rowIds.length; i += 1) {
      const rowId = rowIds[i];
      const pid = playerIds[i];
      if (pid !== owner) {
        toDelete.push({
          id: rowId,
          order_id: orderId,
          player_id: pid,
          keep: owner,
          reason: `场馆归属 player ${owner}`,
        });
      }
    }
  }

  console.log(`\n将删除 ${toDelete.length} 条（仅重复组内非 owner 副本）`);
  for (const d of toDelete) {
    console.log(`  DELETE id=${d.id} player=${d.player_id} order=${d.order_id} keep=${d.keep}`);
  }

  if (skipped.length) {
    console.log(`\n跳过 ${skipped.length} 组（不删任何行）:`);
    for (const s of skipped)
      console.log(`  ${s.order_id}: ${s.reason}`);
  }

  // 安全：非重复 order 总数不变
  const nonDupCount = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM ${financialOrdersRelation("o")}
     WHERE o.user_id = $1::uuid AND o.provider = $2
       AND (o.user_id, o.provider, o.order_id) NOT IN (
         SELECT user_id, provider, order_id
         FROM ${financialOrdersRelation()}
         WHERE user_id = $1::uuid AND provider = $2
         GROUP BY user_id, provider, order_id
         HAVING COUNT(*) > 1
       )`,
    [userId, provider],
  );
  console.log(`\n非重复 ${provider} 订单: ${nonDupCount.rows[0].n} 条（脚本不会删除）`);

  if (!toDelete.length) {
    console.log("\n无需删除");
    await pool.end();
    return;
  }

  if (args.dryRun) {
    console.log("\n[dry-run] 无变更");
    console.log(`执行: node scripts/resolve-dup-orders-by-venue.mjs --user ${args.userName} --execute`);
    await pool.end();
    return;
  }

  const deleteIds = toDelete.map(d => d.id);
  const BACKUP_TABLE = backupTableName(args.userName);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
    await client.query(
      `CREATE TABLE ${BACKUP_TABLE} AS
       SELECT * FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND id = ANY($2::bigint[])`,
      [userId, deleteIds],
    );
    const del = await client.query(
      `DELETE FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND id = ANY($2::bigint[])`,
      [userId, deleteIds],
    );
    await client.query("COMMIT");
    console.log(`\n已删 ${del.rowCount ?? 0} 条，备份 ${BACKUP_TABLE}`);
  }
  catch (err) {
    await client.query("ROLLBACK");
    console.error("rollback:", err.message);
    process.exit(1);
  }
  finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
