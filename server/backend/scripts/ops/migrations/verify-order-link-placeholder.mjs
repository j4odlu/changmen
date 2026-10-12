import { financialOrdersRelation } from "@changmen/db";
/**
 * 验证未绑单占位 Link：新单 link = RDS 入库时刻；legacy 可能 link=create_at 或 hash。
 * 用法：cd changmen/server/backend && node scripts/verify-order-link-placeholder.mjs
 */
import { getPgPool } from "@changmen/db";
import {
  ARB_LINK_MIN,
  isCreateAtPlaceholderLink,
  isHashLink,
  isInsertTimePlaceholderLink,
} from "@changmen/db";

const pool = getPgPool();
if (!pool) {
  console.error("无 DATABASE_URL / PG pool，跳过 RDS 校验");
  process.exit(2);
}

const days = Number(process.argv[2]) || 7;
const since = Date.now() - days * 24 * 60 * 60 * 1000;

const { rows } = await pool.query(
  `SELECT order_id, provider, link, create_at, user_id
   FROM ${financialOrdersRelation()}
   WHERE create_at >= $1
   ORDER BY create_at DESC
   LIMIT 500`,
  [since],
);

let createAtMatch = 0;
let insertTimePlaceholder = 0;
let hashPlaceholder = 0;
let arbBind = 0;
let other = 0;
const samples = { createAtMatch: [], insertTime: [], hash: [], arb: [] };

for (const r of rows) {
  const link = Number(r.link);
  const ca = Number(r.create_at);
  if (isCreateAtPlaceholderLink(link, ca)) {
    createAtMatch += 1;
    if (samples.createAtMatch.length < 3)
      samples.createAtMatch.push(r);
  }
  else if (isInsertTimePlaceholderLink(link, ca)) {
    insertTimePlaceholder += 1;
    if (samples.insertTime.length < 3)
      samples.insertTime.push(r);
  }
  else if (isHashLink(link)) {
    hashPlaceholder += 1;
    if (samples.hash.length < 3)
      samples.hash.push(r);
  }
  else if (link >= ARB_LINK_MIN) {
    arbBind += 1;
    if (samples.arb.length < 3)
      samples.arb.push(r);
  }
  else {
    other += 1;
  }
}

console.log(`--- orders since ${days}d (max 500 rows) ---`);
console.log({
  total: rows.length,
  legacy_create_at_placeholder: createAtMatch,
  insert_time_placeholder: insertTimePlaceholder,
  hash_placeholder: hashPlaceholder,
  arb_bind: arbBind,
  other,
});

if (samples.createAtMatch.length) {
  console.log("--- sample legacy create_at placeholder ---");
  for (const r of samples.createAtMatch) {
    console.log({
      order_id: String(r.order_id).slice(0, 24),
      provider: r.provider,
      link: String(r.link),
      create_at: String(r.create_at),
    });
  }
}

if (samples.insertTime.length) {
  console.log("--- sample insert-time placeholder ---");
  for (const r of samples.insertTime) {
    console.log({
      order_id: String(r.order_id).slice(0, 24),
      provider: r.provider,
      link: String(r.link),
      create_at: String(r.create_at),
      delta_ms: Number(r.link) - Number(r.create_at),
    });
  }
}

if (samples.hash.length) {
  console.log("--- sample legacy hash placeholder ---");
  for (const r of samples.hash) {
    console.log({
      order_id: String(r.order_id).slice(0, 24),
      provider: r.provider,
      link: r.link,
      create_at: r.create_at,
    });
  }
}

await pool.end();
process.exit(0);
