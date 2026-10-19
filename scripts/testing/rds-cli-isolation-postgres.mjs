// [changmen 扩展] Real CLI compatibility against a disposable loopback-only database.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)), exec = promisify(execFile), checks = [];
await withTemporaryPostgres(async ({ temporary }) => {
  const { default: pg } = await import("../../server/db/pg.js");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const command = (directory, name, args = []) => exec(process.execPath,
    [path.join(root, directory, `${name}.mjs`), ...args],
    { cwd: temporary, env: { ...process.env, NODE_OPTIONS: "" }, timeout: 30000, windowsHide: true });
  const ledger = async () => (await client.query("SELECT name,checksum,applied_at FROM changmen_schema_migrations ORDER BY name")).rows;
  try {
    for (const directory of ["server/db/maintenance"]) {
      await assert.rejects(command(directory, "apply-rds-schema"), error => error.code === 1 && /数据库结构核验失败/.test(error.stderr));
      assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    }
    checks.push("canonical default commands reject an empty database without creating tables");
    const initialized = await command("server/db/maintenance", "apply-rds-schema", ["--initialize"]);
    assert.match(initialized.stdout, /空库初始化完成/);
    checks.push("explicit initialization uses the RDS implementation and reads original SQL assets");
    const before = await ledger();
    for (const name of ["check-rds-schema", "apply-rds-schema"]) {
      for (const directory of ["server/db/maintenance"])
        await command(directory, name);
      assert.deepEqual(await ledger(), before);
      checks.push(`${name}: canonical commands succeed without changing migration records`);
    }
    for (const directory of ["server/db/maintenance"])
      await assert.rejects(command(directory, "apply-rds-schema", ["--initialize"]), error => error.code === 1 && /数据库已有业务表/.test(error.stderr));
    assert.deepEqual(await ledger(), before);
    checks.push("explicit initialization refuse an existing database without replaying history");
    await client.query("CREATE DATABASE canonical_cli_initialization");
    const url = new URL(process.env.DATABASE_URL); url.pathname = "/canonical_cli_initialization";
    const initializedCanonical = await exec(process.execPath,
      [path.join(root, "server/db/maintenance/apply-rds-schema.mjs"), "--initialize"],
      { cwd: temporary, env: { ...process.env, DATABASE_URL: url.href, NODE_OPTIONS: "" }, timeout: 30000, windowsHide: true });
    assert.match(initializedCanonical.stdout, /空库初始化完成/);
    checks.push("canonical explicit initialization also works independently of cwd");
  } finally { await client.end(); }
});
console.log(JSON.stringify({ passed: true, localOnly: true, checks }, null, 2));
