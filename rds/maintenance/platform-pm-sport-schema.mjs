/** 独立 RDS 字段维护：默认只读检查，--apply 才添加字段；不由应用或部署调用。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function readColumn(client) {
  const { rows } = await client.query(`SELECT format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.platform_matches') AND a.attname='pm_sport'
      AND a.attnum>0 AND NOT a.attisdropped`);
  return rows[0] || null;
}

export async function maintainPlatformPmSportSchema(client, { apply = false } = {}) {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const before = await readColumn(client);
    if (apply && !before)
      await client.query(readFileSync(new URL("../assets/platform_pm_sport.sql", import.meta.url), "utf8"));
    const column = await readColumn(client);
    if (column) assert.deepEqual(column, { type: "jsonb", not_null: false, default_value: null }, "pm_sport 字段结构不兼容");
    if (apply) assert(column, "pm_sport 字段添加失败");
    await client.query("COMMIT");
    return { table: "platform_matches", field: "pm_sport", ready: column != null,
      added: apply && !before, readOnly: !apply, column };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === "--apply"), "仅支持 --apply；不带参数时只读检查");
  const { loadChangmenEnv } = await import("@changmen/storage/load_env.js");
  loadChangmenEnv();
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady();
  const client = await pool.connect();
  try { console.log(JSON.stringify(await maintainPlatformPmSportSchema(client, { apply: args.includes("--apply") }), null, 2)); }
  finally { client.release(); await pool.end(); }
}
