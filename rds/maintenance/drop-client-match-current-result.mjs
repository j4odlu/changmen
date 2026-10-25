/** 用户明确撤销的增量字段；默认只读，独立执行 --apply，不接入部署或启动。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function dropCurrentResultColumn(client, { apply = false } = {}) {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const exists = async () => (await client.query(`SELECT 1 FROM pg_attribute
      WHERE attrelid=to_regclass('public.client_matches') AND attname='current_result'
        AND attnum>0 AND NOT attisdropped`)).rowCount > 0;
    const present = await exists();
    const rows = present ? (await client.query("SELECT id,current_result FROM public.client_matches WHERE current_result IS NOT NULL")).rows : [];
    let backup = null;
    if (apply && present) {
      if (rows.length) {
        const directory = fileURLToPath(new URL("../../output/current-result-removal/", import.meta.url));
        mkdirSync(directory, { recursive: true });
        backup = path.join(directory, `backup-${Date.now()}.json`);
        writeFileSync(backup, JSON.stringify(rows, null, 2));
      }
      await client.query("ALTER TABLE public.client_matches DROP COLUMN IF EXISTS current_result");
      assert.equal(await exists(), false);
    }
    await client.query("COMMIT");
    return { table: "client_matches", field: "current_result", exists: apply ? false : present,
      removed: apply && present, populatedRows: rows.length, backup, readOnly: !apply };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === "--apply"), "仅支持 --apply；默认只读");
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady(), client = await pool.connect();
  try { console.log(JSON.stringify(await dropCurrentResultColumn(client, { apply: args.includes("--apply") }), null, 2)); }
  finally { client.release(); await pool.end(); }
}
