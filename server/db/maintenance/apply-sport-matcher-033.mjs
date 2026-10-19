#!/usr/bin/env node
/** 仅执行 033_sport_matcher_tables.sql（不跑全量 apply）。 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPgClientConfig, initDatabaseUrl } from "@changmen/db";
import pg from "@changmen/db/pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "../assets/migrations/033_sport_matcher_tables.sql");

await initDatabaseUrl();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client(buildPgClientConfig(url, 30000));
await client.connect();
try {
  await client.query("SET lock_timeout = '30s'");
  await client.query(readFileSync(sqlPath, "utf8"));
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'sport_%'
     ORDER BY tablename`,
  );
  console.log("[033] ok:", rows.map(r => r.tablename).join(", "));
}
finally {
  await client.end();
}
