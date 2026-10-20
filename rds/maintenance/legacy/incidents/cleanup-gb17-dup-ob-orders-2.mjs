import { financialOrdersRelation } from "@changmen/db";
/**
 * 清理 GB17 剩余 OB 重复（ffengjie1 删号重加）：
 * order_id 1788709582432881644 — player 203(已删) / 273(活跃)
 *
 * node server/backend/scripts/ops/incidents/cleanup-gb17-dup-ob-orders-2.mjs [--apply]
 */
import dotenv from "dotenv";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
dotenv.config({ path: path.join(root, "server/backend/.env") });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL_PUBLIC || process.env.DATABASE_URL;
const c = new pg.Client({
  connectionString: url,
  ssl: String(url).includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
await c.connect();


const uid = (await c.query(`select id from profiles where user_name ilike 'GB17'`)).rows[0].id;
const orderId = "1788709582432881644";
const keepPlayerId = 273;
const dropPlayerId = 203;

const { rows } = await c.query(
  `select id, player_id, link, money, status from ${financialOrdersRelation()}
   where user_id=$1::uuid and order_id=$2 order by player_id`,
  [uid, orderId],
);
console.log(apply ? "APPLY" : "DRY-RUN", rows);

const keep = rows.find(r => Number(r.player_id) === keepPlayerId);
const drop = rows.find(r => Number(r.player_id) === dropPlayerId);
if (!keep || !drop) {
  console.log("missing rows, abort");
  await c.end();
  process.exit(1);
}

if (String(keep.link) !== String(drop.link)) {
  console.log(`update id=${keep.id} link ${keep.link} -> ${drop.link}`);
  if (apply)
    await c.query(`update ${financialOrdersRelation()} set link=$1 where id=$2`, [drop.link, keep.id]);
}
console.log(`delete id=${drop.id} player=${drop.player_id}`);
if (apply)
  await c.query(`delete from ${financialOrdersRelation()} where id=$1`, [drop.id]);

const left = await c.query(
  `select id, player_id, link, money from ${financialOrdersRelation()} where user_id=$1::uuid and order_id=$2`,
  [uid, orderId],
);
console.log("after", left.rows);
await c.end();
