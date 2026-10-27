#!/usr/bin/env node
/**
 * GB14 重复 OB 订单：逐单分析能否区分归属 player
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { playerRowToAccountRecord } from "../../../player_account_record.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB14'`)).rows[0].id;

const DUP_ORDER_IDS = [
  "1728733902429161529",
  "1732774685798387545",
  "1734899770462813646",
  "1775371010595844401",
  "1779478883551310902",
  "1780668329619188740",
  "1782379573235563325",
  "1788140943614079903",
  "1789762986427930201",
  "1790241363256736085",
];

const PLAYERS = [92, 93, 94, 95];

console.log("=== 活跃 OB 账号 gateway / venueAccountName ===");
const { rows: plRows } = await pool.query(
  `SELECT * FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid ORDER BY id`,
  [PLAYERS, uid],
);
for (const row of plRows) {
  const acc = playerRowToAccountRecord({
    id: row.id,
    platformName: row.platform_name,
    playerName: row.player_name,
    provider: row.provider,
    accountData: row.account_data,
  });
  console.log(
    `${row.id}\t${row.platform_name}/${row.player_name}\tvan=${acc.venueAccountName || acc.venueMemberId || "-"}\tgateway=${(acc.gateway || "").slice(0, 50)}`,
  );
}

console.log("\n=== 逐单：link / 对腿 / bet_money ===");
for (const orderId of DUP_ORDER_IDS) {
  const { rows } = await pool.query(
    `SELECT o.id, o.player_id, pl.platform_name, o.link, o.bet_money, o.status, o.match,
            o.create_at, o.raw
     FROM orders o
     JOIN players pl ON pl.id = o.player_id
     WHERE o.user_id = $1::uuid AND o.order_id = $2 AND o.provider = 'OB'
     ORDER BY o.player_id`,
    [uid, orderId],
  );
  console.log(`\n--- order_id=${orderId} match=${rows[0]?.match?.slice(0, 45)} ---`);
  const links = new Set(rows.map(r => String(r.link)));
  const sameLink = links.size === 1;
  console.log(`  copies=${rows.length} same_link=${sameLink} links=[${[...links].join(", ")}]`);

  for (const r of rows) {
    const legs = await pool.query(
      `SELECT o.player_id, pl.platform_name, pl.player_name, o.provider, o.link, o.bet_money,
              pl.deleted_at IS NOT NULL AS soft
       FROM orders o
       JOIN players pl ON pl.id = o.player_id
       WHERE o.user_id = $1::uuid AND o.link = $2 AND NOT (o.player_id = $3 AND o.provider = 'OB')
       ORDER BY o.provider, o.player_id`,
      [uid, r.link, r.player_id],
    );
    const legStr = legs.rows.length
      ? legs.rows.map(l => `${l.provider}:${l.player_id}(${l.platform_name}) bm=${l.bet_money}`).join(" + ")
      : "(无对腿)";
    console.log(
      `  pid=${r.player_id} ${r.platform_name} link=${r.link} bm=${r.bet_money} status=${r.status} legs: ${legStr}`,
    );
  }
}

console.log("\n=== link 一致性汇总 ===");
let sameLinkCount = 0;
let diffLinkCount = 0;
for (const orderId of DUP_ORDER_IDS) {
  const { rows } = await pool.query(
    `SELECT array_agg(DISTINCT link::text) AS links, COUNT(DISTINCT link)::int AS n
     FROM orders WHERE user_id = $1::uuid AND order_id = $2 AND provider = 'OB'`,
    [uid, orderId],
  );
  const n = rows[0].n;
  if (n === 1)
    sameLinkCount += 1;
  else
    diffLinkCount += 1;
  console.log(`${orderId}\t${n === 1 ? "SAME" : "DIFF"} link(s)\t${rows[0].links?.join(" | ")}`);
}

await pool.end();
