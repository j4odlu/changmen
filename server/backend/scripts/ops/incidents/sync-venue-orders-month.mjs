#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 从场馆 API 拉取指定用户活跃 player 某月订单，经 saveOrder 写入 RDS。
 *
 *   node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --dry-run
 *   node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --execute
 *   node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --player-id 79 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import { accountMultiplyScale } from "@changmen/shared/account_multiply";
import { buildPbAuthHeaders } from "./lib/pb_auth.mjs";
import { playerRowToAccountRecord } from "../../../../../rds/player_account_record.js";
import { saveOrder } from "../../../core/account/order_store.js";

loadChangmenEnv();

const { initDatabaseUrl, getPgPool } = await import("@changmen/db");

function parseArgs(argv) {
  const out = {
    dryRun: true,
    userName: "",
    month: "",
    playerId: 0,
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
    else if (a === "--month")
      out.month = String(argv[++i] ?? "").trim();
    else if (a === "--player-id")
      out.playerId = Number(argv[++i]) || 0;
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

function parseMonth(monthStr) {
  const m = String(monthStr).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m)
    throw new Error(`无效 --month: ${monthStr}，应为 YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12)
    throw new Error(`无效月份: ${monthStr}`);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return {
    label: monthStr,
    startMs: start.getTime(),
    endMs: end.getTime(),
    startKey: formatDateKey(start),
    endKey: formatDateKey(end),
  };
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${min}:${sec}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function obNum(v) {
  if (v && typeof v.toNumber === "function")
    return v.toNumber();
  return Number(v) || 0;
}

function normalizeProvider(p) {
  return String(p ?? "").trim().toLowerCase();
}

function inMonthRange(createAt, range) {
  const ts = parseVenueCreateAt(createAt, 0);
  return ts >= range.startMs && ts <= range.endMs;
}

function obHeaders(account) {
  const mobile = Boolean(account.userAgent && /mobile/i.test(account.userAgent));
  const base = {
    device: mobile ? "2" : "1",
    lang: "cn",
    token: account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
  if (account.userAgent)
    base["User-Agent"] = account.userAgent;
  if (account.referer)
    base.Referer = account.referer;
  return base;
}

function obUrl(account, path) {
  return `${String(account.gateway).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function obGet(account, path) {
  const res = await fetch(obUrl(account, path), {
    method: "GET",
    headers: obHeaders(account),
  });
  const text = await res.text();
  if (res.status >= 400)
    throw new Error(`OB HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

function mapObBetStatus(raw) {
  let money = 0;
  let status = "none";
  switch (Number(raw)) {
    case 2:
      status = "reject";
      break;
    case 4:
    case 7:
      status = "return";
      break;
    case 5:
      status = "win";
      break;
    case 6:
      status = "lose";
      break;
    default:
      status = "none";
  }
  return { status, money };
}

function mapObOrderRow(row, provider) {
  const teams = String(row.team_cn_names ?? "")
    .split(",")
    .map(t => t.replace(/&nbsp;/g, " "));
  const round = obNum(row.round);
  const stageLabel = round === 0 ? "全场" : `地图${round}`;
  const marketName = String(row.market_cn_name ?? "").replace(/&nbsp;/g, " ");
  let item = String(row.odd_name ?? "");
  if (item === "@T1")
    item = teams[0] ?? item;
  if (item === "@T2")
    item = teams[1] ?? item;

  const betMoney = obNum(row.bet_amount);
  const reward = obNum(row.win_amount);
  let { status, money } = mapObBetStatus(row.bet_status);
  if (status === "win" || status === "lose")
    money = reward - betMoney;

  return {
    provider: provider || "OB",
    orderId: String(row.id ?? ""),
    odds: obNum(row.odd),
    createAt: parseVenueCreateAt(row.bet_time),
    betMoney,
    reward,
    money,
    status,
    game: String(row.game_id ?? ""),
    match: teams.join(" vs "),
    bet: `[${stageLabel}]${marketName}`,
    item,
  };
}

/** 按 7 天切片拉 OB orderList，支持分页 */
async function fetchObOrdersForRange(account, beginTime, endTime) {
  const byId = new Map();
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
      const data = await obGet(account, `/game/orderList?${qs.toString()}`);
      if (!data || data.status !== "true")
        break;
      const bets = data.data?.bet ?? [];
      if (!bets.length)
        break;
      for (const row of bets) {
        const order = mapObOrderRow(row, account.provider);
        if (order.orderId)
          byId.set(order.orderId, order);
      }
      if (bets.length < 100)
        break;
      page += 1;
      await sleep(300);
    }
    await sleep(300);
  }
  return [...byId.values()];
}

function obTimeChunks(range) {
  const chunks = [];
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
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

async function fetchObOrdersMonth(account, range) {
  const byId = new Map();
  for (const chunk of obTimeChunks(range)) {
    const rows = await fetchObOrdersForRange(account, chunk.begin, chunk.end);
    for (const o of rows) {
      if (inMonthRange(o.createAt, range))
        byId.set(o.orderId, o);
    }
    await sleep(500);
  }
  return [...byId.values()].sort((a, b) => b.createAt - a.createAt);
}

function mapPbWagerRow(u, multiply) {
  const gameFull = String(u[28] ?? "");
  const game = gameFull.split(" - ")[0] ?? "";
  const match = String(u[9] ?? "");
  const mapNum = Number(u[42]) || 0;
  const bet = mapNum === 0 ? "全场" : `地图${mapNum}`;
  const item = String(u[22] ?? "");
  const orderId = String(u[7] ?? "");
  const odds = Number(u[16]) || 0;
  const reward = Number(u[29]) + Number(u[0] || 0);
  const betMoney = Number(u[29]) || 0;
  const createAt = Number(u[19]) || 0;
  const state = String(u[18] ?? "");

  let status = "none";
  let money = 0;
  if (state === "SETTLED") {
    status = reward > 0 ? "win" : "lose";
    money = reward - betMoney;
  }
  else if (state === "CANCELLED") {
    status = "return";
    money = 0;
  }

  return {
    provider: "PB",
    orderId,
    odds,
    createAt,
    betMoney: betMoney * multiply,
    reward: reward * multiply,
    money: money * multiply,
    status,
    game,
    match,
    bet,
    item,
  };
}

async function pbPost(account, path, body, extraHeaders = {}) {
  const headers = buildPbAuthHeaders(account, extraHeaders);
  if (!headers)
    throw new Error("PB token 无法解析 auth headers");
  const url = `${String(account.gateway).replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      ...(typeof body === "string"
        ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
        : { "content-type": "application/json; charset=UTF-8" }),
    },
    body: typeof body === "string"
      ? body
      : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status >= 400)
    throw new Error(`PB HTTP ${res.status}: ${text.slice(0, 160)}`);
  if (!text)
    return null;
  return JSON.parse(text);
}

function wagerFilterBody(fields) {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
  ).toString();
}

async function fetchPbOrdersMonth(account, range) {
  const multiply = accountMultiplyScale(account.multiply);
  const path = `/member-service/v2/wager-filter?locale=zh_CN`;
  const begin = `${range.startKey} 00:00:00`;
  const end = `${range.endKey} 23:59:59`;

  const filters = [
    {
      f: begin,
      t: end,
      d: -1,
      s: "SETTLED",
      sd: false,
      type: "WAGER",
      product: "SB",
      timezone: "GMT-4",
      sportId: "",
      leagueId: "",
    },
    {
      f: begin,
      t: end,
      d: -1,
      s: "OPEN",
      sd: false,
      type: "EVENT",
      product: "SB",
      timezone: "GMT-4",
      sportId: "",
      leagueId: "",
    },
  ];

  const byId = new Map();
  for (const filter of filters) {
    const data = await pbPost(account, path, wagerFilterBody(filter));
    if (!data || (typeof data === "object" && !Array.isArray(data) && "error" in data))
      continue;
    if (!Array.isArray(data))
      continue;
    for (const raw of data) {
      if (!Array.isArray(raw))
        continue;
      const order = mapPbWagerRow(raw, multiply);
      if (!order.orderId)
        continue;
      if (!inMonthRange(order.createAt, range))
        continue;
      byId.set(order.orderId, order);
    }
    await sleep(500);
  }
  return [...byId.values()].sort((a, b) => b.createAt - a.createAt);
}

function rayHeaders(account) {
  return {
    authorization: account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

function rayUrl(account, path) {
  return `${String(account.gateway).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function mapRayOrderRow(row) {
  const detail = row.detail?.[0];
  if (!detail)
    return null;

  let status = "none";
  let money = 0;
  const stake = Number(detail.stake) || 0;
  const totalBonus = Number(row.total_bonus) || 0;

  if (row.status === 0) {
    status = "none";
  }
  else if (row.status === 1) {
    money = totalBonus - stake;
    if (row.win === 1)
      status = "win";
    else if (row.win === 0)
      status = "lose";
  }
  else if (row.status === 4) {
    status = "reject";
  }

  const titleParts = String(detail.title ?? "").split("\n");
  let bet = titleParts.join(" ");
  let item = "";
  if (titleParts.length === 2) {
    bet = titleParts[0] ?? "";
    item = titleParts[1] ?? "";
  }

  return {
    provider: "RAY",
    orderId: String(row.order_number ?? ""),
    odds: Number(detail.odds) || 0,
    createAt: parseVenueCreateAt(row.create_time),
    game: String(detail.game_id ?? ""),
    match: String(detail.match_name ?? ""),
    bet: `${detail.match_stage ?? ""} ${bet}`.trim(),
    item,
    betMoney: stake,
    reward: totalBonus,
    status,
    money,
  };
}

async function fetchRayOrdersMonth(account, range) {
  const res = await fetch(rayUrl(account, "/v2/order"), {
    method: "GET",
    headers: rayHeaders(account),
  });
  const text = await res.text();
  if (res.status >= 400)
    throw new Error(`RAY HTTP ${res.status}: ${text.slice(0, 160)}`);
  const data = JSON.parse(text);
  if (data.code !== 200 || !Array.isArray(data.result))
    return [];
  const orders = [];
  for (const row of data.result) {
    const mapped = mapRayOrderRow(row);
    if (mapped && inMonthRange(mapped.createAt, range))
      orders.push(mapped);
  }
  return orders.sort((a, b) => b.createAt - a.createAt);
}

async function fetchVenueOrdersMonth(account, range) {
  const p = normalizeProvider(account.provider);
  if (p === "ob" || p.includes("ob"))
    return fetchObOrdersMonth(account, range);
  if (p === "pb" || p.includes("pb"))
    return fetchPbOrdersMonth(account, range);
  if (p === "ray" || p.includes("ray"))
    return fetchRayOrdersMonth(account, range);
  throw new Error(`不支持的平台 provider=${account.provider}`);
}

async function loadActivePlayers(pool, userName, playerIdFilter) {
  const params = [userName];
  let sql = `
    SELECT pl.*, u.user_name
    FROM players pl
    JOIN users u ON u.id = pl.owner_user_id
    WHERE u.user_name ILIKE $1
      AND pl.deleted_at IS NULL
      AND pl.owner_user_id IS NOT NULL
  `;
  if (playerIdFilter > 0) {
    params.push(playerIdFilter);
    sql += ` AND pl.id = $${params.length}`;
  }
  sql += " ORDER BY pl.id ASC";
  const { rows } = await pool.query(sql, params);
  return rows.map((row) => {
    const account = playerRowToAccountRecord({
      id: row.id,
      platformId: row.platform_id,
      platformName: row.platform_name,
      playerName: row.player_name,
      provider: row.provider,
      credit: row.credit,
      totalBalance: row.total_balance,
      accountData: row.account_data,
      updatedAt: row.updated_at,
    });
    return {
      playerId: Number(row.id),
      userId: String(row.owner_user_id),
      userName: row.user_name,
      account,
    };
  });
}

async function countRdsOrdersInMonth(pool, userId, playerId, range) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM ${financialOrdersRelation()}
     WHERE user_id = $1::uuid
       AND player_id = $2
       AND create_at >= $3
       AND create_at <= $4`,
    [userId, playerId, range.startMs, range.endMs],
  );
  return rows[0]?.n ?? 0;
}

function printHelp() {
  console.log(`
用法:
  node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --dry-run
  node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --execute
  node scripts/sync-venue-orders-month.mjs --user GB13 --month 2026-07 --player-id 79 --execute

从场馆 API 拉取活跃 player 指定月份订单，经 saveOrder upsert 到 RDS。
默认 --dry-run 只拉单统计，不写库。
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.userName || !args.month) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const range = parseMonth(args.month);
  await initDatabaseUrl();
  const pool = getPgPool();
  if (!pool) {
    console.error("DATABASE_URL 未配置");
    process.exit(1);
  }

  const players = await loadActivePlayers(pool, args.userName, args.playerId);
  if (!players.length) {
    console.error(`用户 ${args.userName} 无活跃 player${args.playerId ? ` id=${args.playerId}` : ""}`);
    process.exit(1);
  }

  console.log(`user=${args.userName} month=${range.label} players=${players.length} mode=${args.dryRun ? "dry-run" : "execute"}`);
  console.log(`range=${range.startKey} .. ${range.endKey} (${range.startMs} .. ${range.endMs})`);

  const summary = [];
  for (const row of players) {
    const { playerId, userId, account } = row;
    const label = `${playerId} ${account.provider}/${account.platformName}/${account.playerName}`;
    if (!account.gateway || !account.token) {
      console.log(`\n[SKIP] ${label} — 缺少 gateway 或 token`);
      summary.push({ playerId, label, skip: "no-creds", venue: 0, rds: 0, saved: 0 });
      continue;
    }

    const rdsBefore = await countRdsOrdersInMonth(pool, userId, playerId, range);
    console.log(`\n[${label}] RDS ${range.label} 现有 ${rdsBefore} 条，拉场馆…`);

    let venueOrders = [];
    try {
      venueOrders = await fetchVenueOrdersMonth(account, range);
    }
    catch (err) {
      console.error(`  [ERR] ${err.message}`);
      summary.push({ playerId, label, skip: "fetch-error", venue: 0, rds: rdsBefore, saved: 0, err: err.message });
      continue;
    }

    console.log(`  场馆 ${range.label} ${venueOrders.length} 条`);
    if (venueOrders.length) {
      const sample = venueOrders.slice(0, 3).map(o =>
        `    ${o.orderId} ${new Date(o.createAt).toISOString().slice(0, 19)} ${o.status} ${o.match?.slice(0, 40)}`,
      );
      console.log(sample.join("\n"));
      if (venueOrders.length > 3)
        console.log(`    … +${venueOrders.length - 3} more`);
    }

    let saved = 0;
    if (!args.dryRun && venueOrders.length) {
      const ok = await saveOrder(playerId, venueOrders, userId, account.provider || "");
      saved = ok ? venueOrders.length : 0;
      console.log(`  saveOrder => ${saved} 条`);
    }

    const rdsAfter = args.dryRun
      ? rdsBefore
      : await countRdsOrdersInMonth(pool, userId, playerId, range);
    summary.push({
      playerId,
      label,
      venue: venueOrders.length,
      rds: rdsAfter,
      rdsBefore,
      saved,
    });
  }

  console.log("\n=== SUMMARY ===");
  console.log("playerId\tvenue\trdsBefore\trdsAfter\tsaved\tlabel");
  for (const s of summary) {
    if (s.skip) {
      console.log(`${s.playerId}\t-\t${s.rds}\t-\t0\t${s.label} (${s.skip}${s.err ? `: ${s.err}` : ""})`);
    }
    else {
      console.log(`${s.playerId}\t${s.venue}\t${s.rdsBefore}\t${s.rds}\t${s.saved}\t${s.label}`);
    }
  }

  if (args.dryRun) {
    console.log("\n确认后执行: node scripts/sync-venue-orders-month.mjs --user", args.userName, "--month", args.month, "--execute");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
