#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
// 一次性探针：对比足球订单「按操盘账号」分列在 不同排序规则 下的左右顺序，定位 gb12 的位置
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const GB12 = "ce757d3f-6906-4a5d-8bed-b1e2d94edce4";
const since = process.argv[2] || "7 days";
const { rows: frows } = await pool.query(
  `SELECT o.user_id::text AS user_id, o.player_id, o.venue, o.account_name,
          o.client_id, p.user_name, o.placed_at
   FROM football_orders o
   LEFT JOIN profiles p ON p.id = o.user_id
   WHERE o.placed_at >= ((extract(epoch from now() - $1::interval)) * 1000)::bigint
   ORDER BY o.placed_at`,
  [since],
);
console.log(`\n== 足球订单近 ${since}：${frows.length} 笔 ==`);

const byAccount = new Map();
for (const row of frows) {
  const pid = Number(row.player_id) || 0;
  const key = String(pid || row.account_name || row.user_id || row.client_id);
  if (!byAccount.has(key))
    byAccount.set(key, []);
  byAccount.get(key).push(row);
}
const cols = [...byAccount.entries()].map(([key, list]) => {
  const first = list[0];
  return {
    key,
    venue: String(first.venue || "OB"),
    accountName: String(first.account_name || ""),
    playerId: Number(first.player_id) || 0,
    userName: String(first.user_name || ""),
    orders: list.length,
    lastAt: list[list.length - 1].placed_at,
  };
});

// playerId → players 表的 player_name / owner（电竞页排序用的就是 playerName）
const ids = cols.filter(c => c.playerId).map(c => c.playerId);
const pname = new Map();
const owner = new Map();
if (ids.length) {
  const { rows } = await pool.query(
    `SELECT pl.id, pl.player_name, u.user_name AS owner
     FROM players pl LEFT JOIN users u ON u.id = pl.owner_user_id
     WHERE pl.id = ANY($1::bigint[])`,
    [ids],
  );
  for (const r of rows) {
    pname.set(Number(r.id), String(r.player_name || ""));
    owner.set(Number(r.id), String(r.owner || ""));
  }
}
for (const c of cols) {
  c.pname = pname.get(c.playerId) || "";
  c.owner = owner.get(c.playerId) || c.userName;
}

const zh = (a, b) => String(a).localeCompare(String(b), "zh-CN");
const byVenue = (a, b) => String(a.venue).localeCompare(String(b.venue));
const cur = (a, b) => byVenue(a, b) || zh(a.accountName, b.accountName) || a.playerId - b.playerId;   // 现在线上：venue → accountName → playerId
const esq = (a, b) => byVenue(a, b) || zh(a.pname, b.pname) || a.playerId - b.playerId;               // 电竞同口径：venue → playerName → playerId
const usr = (a, b) => zh(a.owner, b.owner) || byVenue(a, b) || zh(a.pname, b.pname) || a.playerId - b.playerId; // 用户优先

const isGb12 = c => /gb12/i.test(c.owner) || /gb12/i.test(c.userName);
const fmt = list => list.map((c, i) => `${i + 1}.${isGb12(c) ? "★" : " "}${c.venue} / ${c.pname || c.accountName || "(无名)"} (acc=${c.accountName || "-"} owner=${c.owner || c.userName || "?"} pid=${c.playerId} x${c.orders})`).join("\n");

console.log("\n== venue 分布 ==");
console.log([...new Set(cols.map(c => c.venue))].join(", "));

console.log("\n== 规则A：现行（venue → accountName → playerId）==");
console.log(fmt([...cols].sort(cur)));
console.log("\n== 规则B：电竞同口径（venue → playerName → playerId）==");
console.log(fmt([...cols].sort(esq)));
console.log("\n== 规则C：用户优先（owner → venue → playerName → playerId）==");
console.log(fmt([...cols].sort(usr)));

// GB12 名下现役账号（provider → 会看到他的列会落到电竞页哪个平台组）
const { rows: gbPlayers } = await pool.query(
  `SELECT pl.id, pl.provider, pl.platform_name, pl.player_name,
          u.user_name AS owner, COUNT(o.id)::int AS orders_30d
   FROM players pl
   LEFT JOIN users u ON u.id = pl.owner_user_id
   LEFT JOIN ${financialOrdersRelation("o")} ON o.player_id = pl.id
     AND o.create_at >= ((extract(epoch from now() - interval '30 days')) * 1000)::bigint
   WHERE pl.owner_user_id = $1::uuid AND pl.deleted_at IS NULL
   GROUP BY pl.id, pl.provider, pl.platform_name, pl.player_name, u.user_name
   ORDER BY pl.id`,
  [GB12],
);
console.log("\n== GB12 名下现役 players（含近30天订单数）==");
console.log(gbPlayers.length ? gbPlayers.map(r => `pid=${r.id} ${r.provider}/${r.platform_name} name=${r.player_name} orders30d=${r.orders_30d}`).join("\n") : "(无)");

// 复刻 AdminOrdersView（电竞订单查询）「按操盘账号」分列：provider → playerName → playerId
const { rows: orows } = await pool.query(
  `SELECT o.player_id, pl.player_name,
          COALESCE(NULLIF(pl.platform_name, ''), NULLIF(pl.provider, ''), '') AS provider,
          u.user_name AS owner, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   LEFT JOIN users u ON u.id = pl.owner_user_id
   WHERE o.create_at >= ((extract(epoch from now() - interval '30 days')) * 1000)::bigint
   GROUP BY o.player_id, pl.player_name, pl.platform_name, pl.provider, u.user_name`,
  [],
);
const ocmp = (a, b) => String(a.provider).localeCompare(String(b.provider))
  || String(a.player_name).localeCompare(String(b.player_name), "zh-CN")
  || Number(a.player_id) - Number(b.player_id);
const sorted = [...orows].sort(ocmp);
console.log(`\n== 电竞订单查询（orders 表近 30 天，现行规则：provider → playerName → playerId）== 共 ${sorted.length} 列`);
console.log(sorted
  .map((r, i) => `${i + 1}.${/gb12/i.test(r.owner || "") ? "★" : " "}${r.provider} / ${r.player_name || "(无名)"} (owner=${r.owner || "?"} pid=${r.player_id} x${r.n})`)
  .join("\n"));

// 若按 用户优先 排，gb12 会到哪
const ucmp = (a, b) => String(a.owner).localeCompare(String(b.owner), "zh-CN") || ocmp(a, b);
const sortedU = [...orows].sort(ucmp);
const pos = sortedU.findIndex(r => /gb12/i.test(r.owner || ""));
console.log(`\n== 若改成 用户优先（owner → provider → playerName → playerId）== gb12 首列位置：${pos >= 0 ? pos + 1 : "(近30天无订单)"}`);
console.log(sortedU.slice(0, 8)
  .map((r, i) => `${i + 1}.${/gb12/i.test(r.owner || "") ? "★" : " "}${r.owner || "?"} · ${r.provider} / ${r.player_name || "(无名)"}`)
  .join("\n"));

const { rows: users } = await pool.query(`SELECT user_name FROM users`);
const names = [...new Set(users.map(u => String(u.user_name || "")))].sort((a, b) => a.localeCompare(b, "zh-CN"));
console.log("\n== 用户名 zh-CN 排序（前 10）==");
console.log(names.slice(0, 10).map((n, i) => `${i + 1}.${/gb12/i.test(n) ? "★" : " "}${n}`).join("\n"));

await pool.end();
