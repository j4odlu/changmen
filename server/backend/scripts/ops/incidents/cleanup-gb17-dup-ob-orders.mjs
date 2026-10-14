import { financialOrdersRelation } from "@changmen/db";
/**
 * 清理 GB17 因删号重加产生的 OB order_id 重复行：
 * - 把活跃账号(255)行的 link 改成与套利对腿一致（取自已删账号 200）
 * - 删除已删账号(200)上的重复行
 *
 * 用法：node server/backend/scripts/ops/incidents/cleanup-gb17-dup-ob-orders.mjs
 * dry-run 默认；加 --apply 才写库。
 */
import dotenv from "dotenv";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
dotenv.config({ path: path.join(root, "server/backend/.env") });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL_PUBLIC || process.env.DATABASE_URL;
if (!url) {
  console.error("NO_URL");
  process.exit(1);
}

const c = new pg.Client({
  connectionString: url,
  ssl: String(url).includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
await c.connect();


const pairs = [
  {
    orderId: "1837201350013222349",
    keepPlayerId: 255,
    dropPlayerId: 200,
  },
  {
    orderId: "1845490493399475642",
    keepPlayerId: 255,
    dropPlayerId: 200,
  },
];

const uid = (await c.query(
  `select id from profiles where user_name ilike $1`,
  ["GB17"],
)).rows[0]?.id;
if (!uid) {
  console.error("GB17 not found");
  await c.end();
  process.exit(1);
}

console.log(apply ? "APPLY" : "DRY-RUN", "user", uid);

for (const p of pairs) {
  const { rows } = await c.query(
    `
    select id, player_id, link, money, status, match
    from ${financialOrdersRelation()}
    where user_id = $1::uuid and order_id = $2
    order by player_id
  `,
    [uid, p.orderId],
  );
  console.log("\norder", p.orderId, rows);
  const keep = rows.find(r => Number(r.player_id) === p.keepPlayerId);
  const drop = rows.find(r => Number(r.player_id) === p.dropPlayerId);
  if (!keep || !drop) {
    console.log("skip: missing keep/drop row");
    continue;
  }
  const betterLink = drop.link;
  if (String(keep.link) !== String(betterLink)) {
    console.log(`update id=${keep.id} link ${keep.link} -> ${betterLink}`);
    if (apply) {
      await c.query(`update ${financialOrdersRelation()} set link = $1 where id = $2`, [betterLink, keep.id]);
    }
  }
  else {
    console.log(`keep id=${keep.id} link already ${keep.link}`);
  }
  console.log(`delete id=${drop.id} player_id=${drop.player_id}`);
  if (apply) {
    await c.query(`delete from ${financialOrdersRelation()} where id = $1`, [drop.id]);
  }
}

const left = await c.query(
  `
  select order_id, count(*) as n, array_agg(player_id) as players
  from ${financialOrdersRelation()}
  where user_id = $1::uuid
    and order_id = any($2::text[])
  group by order_id
`,
  [uid, pairs.map(p => p.orderId)],
);
console.log("\nafter:", left.rows);
await c.end();
