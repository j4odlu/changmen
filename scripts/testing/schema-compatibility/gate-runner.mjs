// Only used by the disposable PostgreSQL release fixture; never a release entry.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "changmen_test");
const client = new pg.Client({ connectionString: url.href, ssl: false });
await client.connect();
const fail = process.env.TEST_EXPECT_SCHEMA_FAILURE === "1";
let hidden = false;
try {
  if (fail) {
    await client.query("ALTER TABLE platform_bets RENAME COLUMN line_id TO hidden_test_line_id"); hidden = true;
  }
  const cli = fileURLToPath(new URL("../../../server/backend/scripts/check-rds-schema.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (fail) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /columns.platform_bets.line_id: missing/);
    appendFileSync(process.env.TEST_REAL_GATE_LOG, "missing-column-rejected\n");
  } else {
    assert.equal(result.status, 0, result.stderr);
    appendFileSync(process.env.TEST_REAL_GATE_LOG, "canonical-preflight-passed\n");
  }
  process.exitCode = result.status ?? 1;
} finally {
  if (hidden) await client.query("ALTER TABLE platform_bets RENAME COLUMN hidden_test_line_id TO line_id");
  await client.end();
}
