import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * 回填 PredictFun 买单 raw.pfNotionalUsdt（名义金额 = 成交份额 × 限价）
 * 默认 dry-run；加 --execute 才写库
 */
import fs from "fs";
import pg from "pg";
import { computePfNotionalUsdt } from "../../../core/integrations/predictfun/pf_fill.js";

const envTxt = fs.readFileSync(new URL("../../../.env", import.meta.url), "utf8");
for (const raw of envTxt.split(/\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  if (process.env[k] == null) process.env[k] = v;
}

const execute = process.argv.includes("--execute");
const url = process.env.DATABASE_URL_PUBLIC || process.env.DATABASE_URL;
const c = new pg.Client({
  connectionString: url,
  ssl: /sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
});
await c.connect();
if (process.env.ORDERS_EXECUTION_COMPAT === "1") await prepareOrdersExecutionCompatibility(c);

const { rows } = await c.query(`
  SELECT id, order_id, status, bet_money, odds, raw
  FROM ${financialOrdersRelation()}
  WHERE provider = 'PredictFun'
    AND COALESCE(raw->>'pfSide', 'buy') <> 'sell'
    AND raw ? 'pfShares'
    AND (
      raw->>'pfNotionalUsdt' IS NULL
      OR TRIM(COALESCE(raw->>'pfNotionalUsdt', '')) = ''
      OR (raw->>'pfNotionalUsdt')::float <= 0
    )
  ORDER BY id DESC
  LIMIT 5000
`);

let would = 0;
let written = 0;
for (const row of rows) {
  const raw = row.raw && typeof row.raw === "object" ? { ...row.raw } : {};
  let book = Number(raw.pfBookPrice);
  if (!(book > 0 && book < 1)) {
    const odds = Number(row.odds);
    if (odds > 1)
      book = 1 / odds;
  }
  const notional = computePfNotionalUsdt({
    shares: raw.pfShares,
    bookPrice: book,
    fallbackUsdt: undefined,
  });
  if (notional == null || !(notional > 0))
    continue;
  would += 1;
  console.log({
    id: String(row.id),
    order_id: String(row.order_id).slice(0, 18),
    bet_money: row.bet_money,
    pfShares: raw.pfShares,
    book,
    pfNotionalUsdt: notional,
  });
  if (!execute)
    continue;
  raw.pfNotionalUsdt = notional;
  if (!(Number(raw.pfBookPrice) > 0) && book > 0)
    raw.pfBookPrice = book;
  await c.query(`UPDATE ${financialOrdersRelation()} SET raw = $1::jsonb WHERE id = $2`, [
    JSON.stringify(raw),
    row.id,
  ]);
  written += 1;
}

console.log(execute
  ? `written=${written} / candidates=${would}`
  : `dry-run candidates=${would} (pass --execute to write)`);
await c.end();
