#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRdsSchema } from "./rds-schema-check.mjs";

export async function checkConfiguredRdsSchema() {
  const { buildPgClientConfig, initDatabaseUrl } = await import("@changmen/db");
  const { default: pg } = await import("@changmen/db/pg.js");
  await initDatabaseUrl();
  if (!process.env.DATABASE_URL) throw new Error("缺少 DATABASE_URL，无法核验数据库结构");
  const client = new pg.Client({ ...buildPgClientConfig(process.env.DATABASE_URL, 10000),
    statement_timeout: 15000, lock_timeout: 2000, query_timeout: 20000,
    idle_in_transaction_session_timeout: 20000 });
  client.on("error", error => console.warn("[rds] client error:", error.message));
  await client.connect();
  try { return await verifyRdsSchema(client); }
  finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkConfiguredRdsSchema().catch(error => { console.error("[rds] 失败:", error.message); process.exitCode = 1; });
}
