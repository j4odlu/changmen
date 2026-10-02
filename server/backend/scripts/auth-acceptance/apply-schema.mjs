import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const url = "postgresql://auth_test@127.0.0.1:4927/changmen_auth_acceptance";
Object.assign(process.env, {
  DATABASE_URL: url, DATABASE_URL_INTERNAL: url, DATABASE_URL_PUBLIC: url, DATABASE_SSL: "0",
});
const { getPgPool } = await import("@changmen/db");
const pool = getPgPool();
const result = await pool.query("SELECT current_database() AS name, inet_server_addr()::text AS host");
assert.deepEqual(result.rows[0], { name: "changmen_auth_acceptance", host: "127.0.0.1" });
await pool.end();
const applied = spawnSync(process.execPath, ["server/backend/scripts/apply-rds-schema.mjs"], {
  cwd: new URL("../../../..", import.meta.url), env: process.env, stdio: "inherit",
});
if (applied.error) throw applied.error;
process.exitCode = applied.status ?? 1;
