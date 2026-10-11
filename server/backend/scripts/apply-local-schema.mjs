#!/usr/bin/env node
/**
 * Dev-only local schema bootstrap for Cloud Agent / local PostgreSQL.
 *
 * Unlike scripts/apply-rds-schema.mjs (which hardcodes a migration list and
 * aborts on the first error), this applies every db/migrations/*.sql in
 * filename order, each in its own transaction, and tolerates the known
 * cosmetic failures that only occur on a brand-new database (e.g. migration
 * 024's COMMENT on a column the baseline already ships under a renamed name).
 * All migrations here are written to be idempotent, so re-running is safe.
 *
 *   cd server/backend && node scripts/apply-local-schema.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPgClientConfig, initDatabaseUrl } from "@changmen/db";
import pg from "@changmen/db/pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "db", "migrations");

await initDatabaseUrl();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL，请在 server/backend/.env 中配置");
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const client = new pg.Client(buildPgClientConfig(url, 30000));
client.on("error", err => console.warn("[local-schema] client error:", err.message));
await client.connect();

let failures = 0;
try {
  await client.query("SET lock_timeout = '30s'");
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await client.query(sql);
      console.log(`[local-schema] OK ${file}`);
    }
    catch (err) {
      // Ensure the failed statement's transaction is rolled back before the
      // next migration runs (Postgres aborts the whole batch on error).
      await client.query("ROLLBACK").catch(() => {});
      failures += 1;
      console.warn(`[local-schema] SKIP ${file}: ${err.message}`);
    }
  }
  const tables = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  console.log("[local-schema] public 表:", tables.rows.map(r => r.tablename).join(", "));
  console.log(`[local-schema] 完成（${files.length} 迁移，${failures} 条被容忍跳过）`);
}
finally {
  await client.end();
}
