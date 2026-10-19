#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 只读：gb18 / gb19 因 PB 登录交叉产生的重复订单归属。
 *
 *   DATABASE_RDS_TARGET=public node server/backend/scripts/ops/diagnostics/diag-gb18-gb19-pb-dup-orders.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool, initDatabaseUrl } from "@changmen/db";

loadChangmenEnv();
process.env.DATABASE_RDS_TARGET = process.env.DATABASE_RDS_TARGET || "public";
await initDatabaseUrl();
await ensurePgPoolReady();
const pool = getPgPool();
if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

function tryParseJson(raw) {
  if (raw == null)
    return undefined;
  if (typeof raw === "object")
    return raw;
  try {
    return JSON.parse(String(raw));
  }
  catch {
    return undefined;
  }
}

function decodeBase64Utf8(raw) {
  try {
    return Buffer.from(String(raw).replace(/\s+/g, ""), "base64").toString("utf8");
  }
  catch {
    return "";
  }
}

function custidMemberId(raw) {
  try {
    const decoded = decodeURIComponent(String(raw || "").replace(/\+/g, "%20"));
    return String(new URLSearchParams(decoded).get("id") || "").trim();
  }
  catch {
    return "";
  }
}

function parsePbVenueMemberFromToken(token) {
  const text = String(token || "").trim();
  if (!text)
    return { venueMemberId: "", venueAccountName: "", loginId: "" };
  let parsed = tryParseJson(text);
  if (!parsed) {
    try {
      parsed = tryParseJson(decodeBase64Utf8(text));
    }
    catch {
      parsed = undefined;
    }
  }
  if (!parsed || typeof parsed !== "object")
    return { venueMemberId: "", venueAccountName: "", loginId: "" };
  if (typeof parsed.token === "string" && (parsed.provider || parsed.gateway)) {
    const inner = tryParseJson(parsed.token);
    if (inner)
      parsed = inner;
  }
  const outer = parsed;
  const app = tryParseJson(outer["x-app-data"] || "{}") || {};
  let suffix = "";
  for (const key of Object.keys(app)) {
    const m = key.match(/^BrowserSessionId_(\d+)$/) || key.match(/^custid_(\d+)$/);
    if (m) {
      suffix = m[1];
      break;
    }
  }
  const custidRaw = suffix
    ? (app[`custid_${suffix}`] || outer[`custid_${suffix}`] || "")
    : (app.custid || outer.custid || "");
  const fromCustid = custidMemberId(custidRaw);
  let fromInner = "";
  const innerTok = tryParseJson(outer.token || "{}") || {};
  const innerCustid = suffix
    ? (innerTok[`X-Custid-${suffix}`] || innerTok[`x-custid-${suffix}`] || "")
    : (innerTok["X-Custid"] || innerTok["x-custid"] || "");
  fromInner = custidMemberId(innerCustid);
  const udata = tryParseJson(decodeBase64Utf8(outer.__udata || ""));
  const a = tryParseJson(decodeBase64Utf8(outer.a || ""));
  const userCode = String(udata?.userCode ?? "").trim();
  const loginId = String(udata?.loginId ?? a?.loginId ?? "").trim();
  const venueMemberId = userCode || fromCustid || fromInner;
  return {
    venueMemberId: venueMemberId || loginId,
    venueAccountName: loginId || venueMemberId,
    loginId,
  };
}

function fmtTs(ms) {
  const n = Number(ms) || 0;
  if (!n)
    return "-";
  return new Date(n).toISOString().replace("T", " ").slice(0, 19);
}

const { rows: users } = await pool.query(
  `SELECT id, user_name FROM profiles WHERE lower(user_name) IN ('gb18', 'gb19') ORDER BY user_name`,
);
if (users.length < 2) {
  console.error("找不到 gb18/gb19", users);
  await pool.end();
  process.exit(1);
}
const byName = Object.fromEntries(users.map(u => [String(u.user_name).toLowerCase(), u]));
const gb18 = byName.gb18;
const gb19 = byName.gb19;
console.log("=== USERS ===");
for (const u of users)
  console.log(`  ${u.user_name}  ${u.id}`);

const { rows: players } = await pool.query(
  `SELECT id, owner_user_id, platform_name, player_name, provider, venue_member_id, venue_account_key,
          deleted_at, account_data, updated_at
   FROM players
   WHERE owner_user_id IN ($1::uuid, $2::uuid)
   ORDER BY owner_user_id, provider, id`,
  [gb18.id, gb19.id],
);

const playerById = new Map(players.map(p => [Number(p.id), p]));
console.log("\n=== PLAYERS ===");
for (const p of players) {
  const owner = users.find(u => u.id === p.owner_user_id)?.user_name;
  const data = p.account_data && typeof p.account_data === "object" ? p.account_data : {};
  const parsed = String(p.provider || "").toUpperCase() === "PB"
    ? parsePbVenueMemberFromToken(data.token)
    : { venueMemberId: "", venueAccountName: "", loginId: "" };
  const tokenMember = parsed.venueMemberId || "";
  const bound = String(p.venue_member_id || "");
  const mismatch = tokenMember && bound && tokenMember.toLowerCase() !== bound.toLowerCase();
  console.log(
    [
      owner,
      `player=${p.id}`,
      p.provider || "?",
      `name=${p.player_name || ""}`,
      `bound=${bound || "-"}`,
      `tokenId=${tokenMember || "-"}`,
      `login=${parsed.loginId || data.venueAccountName || "-"}`,
      p.deleted_at ? "DELETED" : "active",
      mismatch ? "TOKEN_NE_BOUND" : "",
    ].filter(Boolean).join("  "),
  );
}

const pbPlayers = players.filter(p => String(p.provider || "").toUpperCase() === "PB" && !p.deleted_at);
const pbIds = pbPlayers.map(p => Number(p.id));

const { rows: dupGroups } = await pool.query(
  `
  SELECT lower(order_id) AS oid, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users,
         COUNT(DISTINCT player_id) AS players, array_agg(DISTINCT provider) AS providers
  FROM ${financialOrdersRelation()}
  WHERE user_id IN ($1::uuid, $2::uuid)
    AND order_id IS NOT NULL AND trim(order_id) <> ''
  GROUP BY lower(order_id)
  HAVING COUNT(*) > 1
  ORDER BY COUNT(DISTINCT user_id) DESC, COUNT(*) DESC, oid
  `,
  [gb18.id, gb19.id],
);

console.log(`\n=== DUP order_id GROUPS (any provider) === ${dupGroups.length}`);
const cross = dupGroups.filter(g => Number(g.users) > 1);
const intra = dupGroups.filter(g => Number(g.users) === 1);
console.log(`  cross-user: ${cross.length}  intra-user: ${intra.length}`);

const oids = dupGroups.map(g => g.oid);
let dupRows = [];
if (oids.length) {
  const { rows } = await pool.query(
    `
    SELECT o.id, o.user_id, o.player_id, o.order_id, o.provider, o.match, o.bet, o.item,
           o.status, o.odds, o.bet_money, o.money, o.link, o.create_at, o.raw
    FROM ${financialOrdersRelation("o")}
    WHERE o.user_id IN ($1::uuid, $2::uuid)
      AND lower(o.order_id) = ANY($3::text[])
    ORDER BY lower(o.order_id), o.create_at, o.id
    `,
    [gb18.id, gb19.id, oids],
  );
  dupRows = rows;
}

function ownerName(userId) {
  return users.find(u => u.id === userId)?.user_name || String(userId);
}

function playerLabel(playerId) {
  const p = playerById.get(Number(playerId));
  if (!p)
    return `#${playerId}(missing)`;
  const owner = ownerName(p.owner_user_id);
  return `${owner}/p${p.id}/${p.provider}/${p.player_name || ""}/bound=${p.venue_member_id || "-"}`;
}

function rawHint(raw) {
  const obj = tryParseJson(raw) || {};
  const keys = [
    "venueMemberId", "venueAccountName", "custid", "memberId", "loginId",
    "uniqueRequestId", "wagerId", "betId",
  ];
  const bits = [];
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim())
      bits.push(`${k}=${obj[k]}`);
  }
  if (obj.response && typeof obj.response === "object")
    bits.push("hasResponse");
  return bits.join(",") || Object.keys(obj).slice(0, 8).join("|") || "-";
}

console.log("\n=== CROSS-USER DUP DETAILS ===");
const byOid = new Map();
for (const row of dupRows) {
  const oid = String(row.order_id).toLowerCase();
  if (!byOid.has(oid))
    byOid.set(oid, []);
  byOid.get(oid).push(row);
}

const recommendations = [];
for (const g of cross) {
  const rows = byOid.get(g.oid) || [];
  console.log(`\n-- ${g.oid}  providers=${g.providers}  copies=${g.n}`);
  for (const r of rows) {
    console.log(
      `   ${ownerName(r.user_id)}  ${playerLabel(r.player_id)}  ${r.provider}  ${r.status}`
      + `  bet=${r.bet_money} money=${r.money} link=${r.link ?? "-"}`
      + `  at=${fmtTs(r.create_at)}  match=${String(r.match || "").slice(0, 60)}`
      + `  raw=${rawHint(r.raw)}`,
    );
  }
  const owners = [...new Set(rows.map(r => ownerName(r.user_id)))];
  const providers = [...new Set(rows.map(r => String(r.provider || "")))];
  recommendations.push({
    orderId: rows[0]?.order_id || g.oid,
    providers,
    owners,
    keep: null,
    reason: "",
    rows,
  });
}

console.log("\n=== INTRA-USER DUP (same order_id, one user) ===");
for (const g of intra.slice(0, 40)) {
  const rows = byOid.get(g.oid) || [];
  console.log(`\n-- ${g.oid}  n=${g.n}  ${ownerName(rows[0]?.user_id)}`);
  for (const r of rows) {
    console.log(
      `   ${playerLabel(r.player_id)}  ${r.provider}  ${r.status}`
      + `  bet=${r.bet_money}  at=${fmtTs(r.create_at)}  match=${String(r.match || "").slice(0, 50)}`,
    );
  }
}
if (intra.length > 40)
  console.log(`  ... ${intra.length - 40} more intra groups`);

const { rows: pbToday } = await pool.query(
  `
  SELECT u.user_name, o.player_id, o.order_id, o.status, o.bet_money, o.money, o.match, o.create_at, o.link
  FROM ${financialOrdersRelation("o")}
  JOIN profiles u ON u.id = o.user_id
  WHERE o.user_id IN ($1::uuid, $2::uuid)
    AND upper(o.provider) = 'PB'
    AND o.create_at >= $3
  ORDER BY o.create_at, u.user_name
  `,
  [gb18.id, gb19.id, Date.now() - 3 * 24 * 3600 * 1000],
);
console.log(`\n=== PB ORDERS last 3 days === ${pbToday.length}`);
for (const r of pbToday) {
  console.log(
    `  ${r.user_name}  p${r.player_id}  ${r.order_id}  ${r.status}  bet=${r.bet_money}`
    + `  at=${fmtTs(r.create_at)}  ${String(r.match || "").slice(0, 50)}`,
  );
}

const { rows: pbCounts } = await pool.query(
  `
  SELECT u.user_name, o.player_id, COUNT(*) AS n,
         MIN(o.create_at) AS first_at, MAX(o.create_at) AS last_at
  FROM ${financialOrdersRelation("o")}
  JOIN profiles u ON u.id = o.user_id
  WHERE o.user_id IN ($1::uuid, $2::uuid)
    AND upper(o.provider) = 'PB'
  GROUP BY u.user_name, o.player_id
  ORDER BY u.user_name, o.player_id
  `,
  [gb18.id, gb19.id],
);
console.log("\n=== PB ORDER COUNTS BY PLAYER ===");
for (const r of pbCounts) {
  console.log(
    `  ${r.user_name}  p${r.player_id}  n=${r.n}  ${fmtTs(r.first_at)} → ${fmtTs(r.last_at)}  ${playerLabel(r.player_id)}`,
  );
}

const crossLinks = [...new Set(
  dupRows.filter(r => Number(r.link) > 0).map(r => Number(r.link)),
)];
if (crossLinks.length) {
  const { rows: legs } = await pool.query(
    `
    SELECT u.user_name, o.player_id, o.order_id, o.provider, o.link, o.status,
           o.bet_money, o.money, o.match, o.item, o.bet, o.create_at
    FROM ${financialOrdersRelation("o")}
    JOIN profiles u ON u.id = o.user_id
    WHERE o.link = ANY($1::bigint[])
    ORDER BY o.link, o.create_at, u.user_name, o.provider
    `,
    [crossLinks],
  );
  console.log("\n=== ARB LEGS FOR DUP LINKS ===");
  const byLink = new Map();
  for (const r of legs) {
    const k = Number(r.link);
    if (!byLink.has(k))
      byLink.set(k, []);
    byLink.get(k).push(r);
  }
  for (const link of crossLinks) {
    const group = byLink.get(link) || [];
    console.log(`\n-- link ${link}`);
    for (const r of group) {
      console.log(
        `   ${r.user_name}  ${r.provider}  p${r.player_id}  ${r.order_id}  ${r.status}`
        + `  bet=${r.bet_money} money=${r.money}  at=${fmtTs(r.create_at)}`
        + `  ${(r.match || "").slice(0, 40)}  ${(r.bet || "")}  ${(r.item || "").slice(0, 36)}`,
      );
    }
  }
}

await pool.end();
