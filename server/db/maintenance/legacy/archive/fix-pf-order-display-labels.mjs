/**
 * [archive] 一次性：修两笔 PF 单的 match/bet/item 文案（对齐 OB 对锁展示）。
 * 不是卖出/盈亏逻辑工具。硬编码 order id，勿当通用脚本。
 *
 *   node scripts/archive/fix-pf-order-display-labels.mjs [--apply]
 */
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", "..", "..", "backend", ".env");
const envTxt = fs.readFileSync(envPath, "utf8");
const env = Object.create(null);
for (const raw of envTxt.split(/\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const url = env.DATABASE_URL_PUBLIC || env.DATABASE_URL || env.DATABASE_URL_INTERNAL;
if (!url) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const IDS = ["6703115", "6702470"];
const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(
  `SELECT id, bet_money, odds, match, bet, item, link, raw
   FROM orders WHERE id = ANY($1::bigint[])`,
  [IDS],
);

for (const r of rows) {
  const peer = await client.query(
    `SELECT match, bet, item FROM orders
     WHERE link = $1 AND LOWER(provider) <> 'predictfun'
     LIMIT 1`,
    [r.link],
  );
  const ob = peer.rows[0];
  if (!ob) {
    console.warn("NO_PEER", r.id);
    continue;
  }
  // 套利对锁：OB 选 Zeu5 → PF 应为对面 LYON Academy
  const match = String(ob.match || "").trim() || "LYON Academy vs Zeu5 Esports";
  const bet = String(ob.bet || "").trim() || "[全场]全局 - 获胜";
  const obItem = String(ob.item || "").trim();
  let item = "LYON Academy";
  if (/zeu5/i.test(obItem))
    item = "LYON Academy";
  else if (/lyon/i.test(obItem))
    item = "Zeu5 Esports";
  else if (obItem)
    item = obItem;

  console.log({
    id: r.id,
    bet_money_usdt: r.bet_money,
    cny_after_deploy: Number(r.bet_money) * 6.7,
    before: { match: r.match, bet: r.bet, item: String(r.item).slice(0, 24) },
    after: { match, bet, item },
  });

  if (!apply)
    continue;

  const raw = r.raw && typeof r.raw === "object" ? { ...r.raw } : {};
  raw.match = match;
  raw.Match = match;
  raw.bet = bet;
  raw.Bet = bet;
  raw.item = item;
  raw.Item = item;
  await client.query(
    `UPDATE orders SET match = $1, bet = $2, item = $3, raw = $4::jsonb WHERE id = $5`,
    [match, bet, item, JSON.stringify(raw), r.id],
  );
  console.log("UPDATED", r.id);
}

await client.end();
console.log(apply ? "DONE apply" : "DRY-RUN (pass --apply)");
