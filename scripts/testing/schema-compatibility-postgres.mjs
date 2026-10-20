import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { initializeEmptyRdsSchema, RDS_MIGRATIONS } from "@changmen/db/maintenance/apply-rds-schema.mjs";
import { runRdsMigrations } from "@changmen/db/maintenance/rds-migrations.mjs";
import { readSchemaBaseline, verifyRdsSchema } from "@changmen/db/maintenance/rds-schema-check.mjs";
import { expandedRequirements, materializeReference, reference } from "./schema-compatibility/reference.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const exec = promisify(execFile);
const quiet = () => {};
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }

await withTemporaryPostgres(async ({ temporary }) => {
  process.env.DATABASE_POOL_MAX = "2";
  const { getPgPool } = await import("../../rds/pg_pool.js");
  const pool = getPgPool();
  const oldRoot = path.join(temporary, "published-reference");
  const oldSources = materializeReference(root, oldRoot);
  const oldBaseline = JSON.parse(oldSources["server/backend/scripts/rds-schema-baseline.json"]);
  const baseline = readSchemaBaseline(), expanded = expandedRequirements(baseline);
  const owner = "00000000-0000-0000-0000-000000000041";
  const env = { ...process.env, NODE_PATH: path.join(root, "node_modules"), NODE_OPTIONS: "", CHANGMEN_REFERENCE_ROOT: oldRoot };
  async function consumer(source, mode = "read") {
    const { stdout } = await exec(process.execPath, [path.join(root, "scripts/testing/schema-compatibility/consumer.mjs"), source, mode, owner],
      { env, cwd: temporary, timeout: 30_000, windowsHide: true });
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  }
  async function connection(run) {
    const client = await pool.connect();
    try { return await run(client); } finally { client.release(); }
  }
  const verify = requirements => connection(client => verifyRdsSchema(client, { baseline: requirements ?? baseline, log: quiet }));
  const ledger = async () => (await pool.query("SELECT name,checksum,applied_at FROM changmen_schema_migrations ORDER BY name")).rows;
  async function business() {
    const result = {};
    for (const table of ["users", "profiles", "players"])
      result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    result.sequence = (await pool.query("SELECT last_value,is_called FROM client_matches_id_seq")).rows;
    return result;
  }
  const migrationName = "round4_expand_fixture.sql";
  const expansion = readFileSync(new URL("./schema-compatibility/expand.sql", import.meta.url), "utf8");
  const migrate = (names, sources) => connection(client => runRdsMigrations(client, names,
    { readSql: name => { assert(Object.hasOwn(sources, name)); return sources[name]; }, log: quiet }));
  try {
    await check("isolated cluster uses only loopback TCP without a system Unix socket directory", async () => {
      assert.equal((await pool.query("SHOW unix_socket_directories")).rows[0].unix_socket_directories, "");
      assert.equal((await pool.query("SHOW listen_addresses")).rows[0].listen_addresses, "127.0.0.1");
    });
    await check("empty database fails read-only requirements without creating any tables", async () => {
      await assert.rejects(verify(), /数据库结构核验失败/);
      assert.equal((await pool.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name, null);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    });
    await check("candidate empty initialization uses a separate database and refuses a second initialization", async () => {
      await pool.query("CREATE DATABASE round4_candidate_initialization");
      const { default: pg } = await import("../../rds/pg.js");
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = "/round4_candidate_initialization";
      const client = new pg.Client({ connectionString: url.href, ssl: false });
      await client.connect();
      try {
        assert.deepEqual(await initializeEmptyRdsSchema(client), RDS_MIGRATIONS);
        await verifyRdsSchema(client, { baseline, log: quiet });
        await assert.rejects(initializeEmptyRdsSchema(client), /数据库已有业务表/);
      } finally { await client.end(); }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    });
    await check("legacy schema is initialized only from fixed published SQL and verified by the old checker", async () => {
      const names = Object.keys(oldBaseline.migrations);
      const completed = await connection(client => runRdsMigrations(client, names, {
        readSql: name => {
          const sql = oldSources[`server/backend/db/migrations/${name}`];
          assert.equal(typeof sql, "string", `Missing old migration ${name}`);
          return sql;
        }, log: quiet,
      }));
      assert.deepEqual(completed, names);
      assert.deepEqual(Object.fromEntries((await ledger()).map(row => [row.name, row.checksum])), oldBaseline.migrations);
      assert.equal((await consumer(oldRoot, "verify")).verified, true);
    });
    // Deliberately named admin but not privileged: replaying historical 004/012 would corrupt this fixture.
    await pool.query("INSERT INTO users(id,user_name,password_hash,is_admin,role,metadata,created_at,updated_at) VALUES($1,'admin','synthetic',false,'user',$2::jsonb,1,1)", [owner, JSON.stringify({ keep: true })]);
    await pool.query("INSERT INTO profiles(id,user_name,accounts,preferences,created_at,updated_at) VALUES($1,'admin','[]',$2::jsonb,1,1) ON CONFLICT(id) DO UPDATE SET preferences=EXCLUDED.preferences", [owner, JSON.stringify({ keep: true })]);
    const tag = (await pool.query("INSERT INTO tag_platforms(name,created_at) VALUES('round4-fixture',1) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO players(platform_id,owner_user_id,provider,player_name,total_balance,account_data,created_at,updated_at) VALUES($1,$2,'OB','round4',200,$3::jsonb,1,1)", [tag, owner, JSON.stringify({ token: "synthetic", currency: "CNY" })]);
    await pool.query("INSERT INTO value_signals(match_id,sharp_platform,soft_platform,soft_side,edge,status) VALUES(41,'PB','OB','Home',0.05,'open')");
    await pool.query("SELECT setval('client_matches_id_seq',12345)");
    let original = await business();
    const originalLedger = await ledger();
    let oldResult;
    await check("fixed published consumers and candidate read identical legacy rows and wire field types", async () => {
      oldResult = await consumer(oldRoot);
      assert.equal(oldResult.profile.id, owner);
      assert.deepEqual(oldResult.profile.preferences, { keep: true });
      assert.deepEqual(oldResult.identity, { user_name: "admin", is_admin: false });
      assert.equal(oldResult.administrators, 0);
      assert.equal(oldResult.dashboard.dbAvailable, true);
      assert.equal(oldResult.dashboard.signals[0].edge, "0.05000");
      assert.equal(oldResult.dashboard.signals[0].match_id, "41");
      assert.deepEqual(await consumer(root), oldResult);
      assert.deepEqual(await business(), original);
    });
    await check("candidate writes legacy rows without requiring future optional fields", async () => {
      const result = await consumer(root, "write");
      assert.deepEqual(result.profile.collect_config, { OB: true });
      assert.deepEqual(result.profile.preferences, { keep: true });
      assert.deepEqual(await consumer(oldRoot), result);
      original = await business(); oldResult = result;
    });
    await check("future required fields fail before upgrade without changing business data or the ledger", async () => {
      await assert.rejects(verify(expanded), /columns.users.round4_optional_note: missing/);
      assert.deepEqual(await business(), original); assert.deepEqual(await ledger(), originalLedger);
    });
    await check("explicit additive upgrade applies only the requested SQL and one atomic ledger record", async () => {
      assert.deepEqual(await migrate([migrationName], { [migrationName]: expansion }), [migrationName]);
      const after = await business();
      assert(after.users.every(row => row.round4_optional_note === null));
      for (const row of after.users) delete row.round4_optional_note;
      assert.deepEqual(after, original);
      const records = await ledger();
      assert.deepEqual(records.filter(row => row.name !== migrationName), originalLedger);
      assert.equal(records.length, originalLedger.length + 1);
      await verify(expanded);
    });
    await check("old checker accepts compatible additions and old/new consumers preserve legacy results", async () => {
      assert.equal((await consumer(oldRoot, "verify")).readOnly, true);
      assert.deepEqual(await consumer(oldRoot), oldResult);
      assert.deepEqual(await consumer(root), oldResult);
    });
    await check("code rollback retains the expansion and future data while old code still writes", async () => {
      await pool.query("UPDATE users SET round4_optional_note='future-value' WHERE id=$1", [owner]);
      const result = await consumer(oldRoot, "write");
      assert.deepEqual(result.profile.preferences, { keep: true });
      assert.deepEqual(await consumer(root), result);
      assert.equal((await pool.query("SELECT round4_optional_note FROM users WHERE id=$1", [owner])).rows[0].round4_optional_note, "future-value");
      await verify(expanded);
    });
    await check("rerunning the same explicit upgrade is a no-op for rows, sequence and ledger timestamps", async () => {
      const before = await business(), records = await ledger();
      assert.deepEqual(await migrate([migrationName], { [migrationName]: expansion }), []);
      assert.deepEqual(await business(), before); assert.deepEqual(await ledger(), records);
    });
    await check("old and candidate user creation remain valid with the new nullable field", async () => {
      for (const source of [oldRoot, root]) {
        const created = await consumer(source, "create");
        assert.equal(created.identity.is_admin, false);
        assert.deepEqual(created.profile.accounts, []);
        assert.deepEqual(created.profile.preferences, {});
        const row = (await pool.query("SELECT round4_optional_note FROM users WHERE id=$1", [created.profile.id])).rows[0];
        assert.equal(row.round4_optional_note, null);
      }
    });
    await check("changed migration checksum blocks every pending migration", async () => {
      const before = await business(), records = await ledger();
      await assert.rejects(migrate([migrationName, "round4_never.sql"], {
        [migrationName]: expansion + "\n-- changed history", "round4_never.sql": "CREATE TABLE round4_never(id int)",
      }), /已执行的迁移内容发生变化/);
      assert.equal((await pool.query("SELECT to_regclass('public.round4_never') AS name")).rows[0].name, null);
      assert.deepEqual(await business(), before); assert.deepEqual(await ledger(), records);
    });
    await check("failed upgrade rolls back both DDL and DML without recording success", async () => {
      const before = await business(), records = await ledger();
      await assert.rejects(migrate(["round4_failed.sql"], {
        "round4_failed.sql": "ALTER TABLE users ADD COLUMN round4_failed text; UPDATE users SET is_admin=true; SELECT 1/0;",
      }), error => error.code === "22012");
      assert.deepEqual(await business(), before); assert.deepEqual(await ledger(), records);
      await verify(expanded);
    });
    await check("lock timeout rolls back the upgrade and releases its advisory lock", async () => {
      const before = await ledger(), rowsBefore = await business();
      const blocker = await pool.connect(), migration = await pool.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT id FROM users");
        await migration.query("SET lock_timeout='100ms'");
        await assert.rejects(runRdsMigrations(migration, ["round4_lock.sql"], {
          readSql: () => "ALTER TABLE users ADD COLUMN round4_lock text", log: quiet,
        }), error => error.code === "55P03");
        assert.equal((await blocker.query("SELECT pg_try_advisory_lock(hashtextextended('changmen:rds-schema',0)) AS locked")).rows[0].locked, true);
        await blocker.query("SELECT pg_advisory_unlock(hashtextextended('changmen:rds-schema',0))");
      } finally {
        await blocker.query("ROLLBACK"); await migration.query("RESET lock_timeout"); blocker.release(); migration.release();
      }
      assert.deepEqual(await ledger(), before); assert.deepEqual(await business(), rowsBefore); await verify(expanded);
    });
    await check("real preflight CLI exits nonzero on missing required structure and leaves data untouched", async () => {
      const before = await business(), records = await ledger();
      await pool.query("ALTER TABLE profiles RENAME COLUMN preferences TO round4_hidden_preferences");
      try {
        await assert.rejects(exec(process.execPath, [path.join(root, "rds/maintenance/check-rds-schema.mjs")],
          { env, cwd: temporary, timeout: 30_000, windowsHide: true }), error => error.code === 1 && /columns.profiles.preferences: missing/.test(error.stderr));
      } finally { await pool.query("ALTER TABLE profiles RENAME COLUMN round4_hidden_preferences TO preferences"); }
      assert.deepEqual(await business(), before); assert.deepEqual(await ledger(), records);
      await verify(expanded);
    });
    await check("missing or empty migration ledger is never adopted by read-only checks", async () => {
      const before = await business();
      await pool.query("DROP TABLE changmen_schema_migrations");
      await verify(expanded);
      assert.equal((await pool.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name, null);
      await pool.query("CREATE TABLE changmen_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
      await verify(expanded); await consumer(oldRoot, "verify");
      assert.deepEqual(await ledger(), []); assert.deepEqual(await business(), before);
    });
    console.log(JSON.stringify({ passed: true, localOnly: true, referenceCommit: reference.commit, checks: checks.length, cases: checks }, null, 2));
  } finally { await pool.end(); }
});
