/** Local-only integration verification. Owns an ephemeral cluster bound to loopback. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "../../server/db/pg.js";
import { applyRdsSchema, RDS_MIGRATIONS } from "../../server/backend/scripts/apply-rds-schema.mjs";
import { runRdsMigrations } from "../../server/backend/scripts/rds-migrations.mjs";

const suffix = process.platform === "win32" ? ".exe" : "";
function executable(name) {
  for (const directory of [process.env.CHANGMEN_TEST_PG_BIN, ...(process.env.PATH || "").split(path.delimiter)].filter(Boolean)) {
    const file = path.join(directory, name + suffix);
    if (existsSync(file)) return file;
  }
  throw new Error(`Local PostgreSQL ${name} is required; set CHANGMEN_TEST_PG_BIN`);
}
const initdb = executable("initdb"), pgctl = executable("pg_ctl");
const tempRoot = path.resolve(os.tmpdir());
const temporary = mkdtempSync(path.join(tempRoot, "changmen-phase1-pg-"));
const data = path.join(temporary, "data");
const clients = [];
let startAttempted = false, db;
const checks = [];
async function check(name, run) {
  await run(); checks.push(name); console.log(`PASS ${name}`);
}
async function connect(database, port) {
  const client = new pg.Client({ host: "127.0.0.1", port, user: "changmen_test", database, ssl: false });
  await client.connect(); clients.push(client); return client;
}
const readSql = name => readFileSync(new URL(`../../server/backend/db/migrations/${name}`, import.meta.url), "utf8");
try {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
  console.log("Starting a new temporary PostgreSQL cluster on 127.0.0.1");
  execFileSync(initdb, ["-D", data, "-U", "changmen_test", "--auth=trust", "--no-locale", "--encoding=UTF8", "--no-sync"], { windowsHide: true, stdio: "pipe", timeout: 60000 });
  startAttempted = true;
  execFileSync(pgctl, ["-D", data, "-l", path.join(temporary, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], { windowsHide: true, stdio: "ignore", timeout: 60000 });
  const admin = await connect("postgres", port);
  const postgresVersion = (await admin.query("SHOW server_version")).rows[0].server_version;
  await admin.query("CREATE DATABASE phase1_fresh");
  await admin.query("CREATE DATABASE phase1_legacy");
  const fresh = await connect("phase1_fresh", port);
  const legacy = await connect("phase1_legacy", port);
  await check("fresh schema includes every numbered migration and both collector fields", async () => {
    const peer = await connect("phase1_fresh", port);
    const runs = await Promise.all([applyRdsSchema(fresh), applyRdsSchema(peer)]);
    assert.deepEqual(runs.map(completed => completed.length).sort((a, b) => a - b), [0, RDS_MIGRATIONS.length]);
    assert.deepEqual(await applyRdsSchema(fresh), []);
  });
  await check("legacy schema missing 034/039 fails read-only until those fields are explicitly maintained", async () => {
    await runRdsMigrations(legacy, RDS_MIGRATIONS.filter(name => !/^(034|039)_/.test(name)), { readSql, log: () => {} });
    const legacyOwner = randomUUID();
    await legacy.query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,'legacy','synthetic',1,1)", [legacyOwner]);
    await legacy.query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,'legacy',1,1) ON CONFLICT DO NOTHING", [legacyOwner]);
    const legacyTag = (await legacy.query("INSERT INTO tag_platforms(name,created_at) VALUES('legacy',1) RETURNING id")).rows[0].id;
    const legacyPlayer = (await legacy.query(`INSERT INTO players(platform_id,owner_user_id,provider,account_data,created_at,updated_at)
      VALUES($1,$2,'OB','{"token":"legacy-preserved"}',1,1) RETURNING id`, [legacyTag, legacyOwner])).rows[0].id;
    await legacy.query("DROP TABLE changmen_schema_migrations");
    await assert.rejects(applyRdsSchema(legacy), /columns.platform_bets.(market_id|line_id): missing/);
    assert.equal((await legacy.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name, null);
    // Explicit local fixture maintenance, not a deployment or a historical replay.
    await legacy.query(readSql("034_platform_bets_market_id.sql"));
    await legacy.query(readSql("039_platform_bets_line_id.sql"));
    assert.deepEqual(await applyRdsSchema(legacy), []);
    await legacy.query(`INSERT INTO platform_bets(platform,source_match_id,source_bet_id,map,bet_name,home_odds,away_odds,updated_at,market_id,line_id)
      VALUES('PB','audit','audit',0,'winner',2,2,1,'market',123)`);
    const row = (await legacy.query("SELECT market_id,line_id FROM platform_bets WHERE source_match_id='audit'")).rows[0];
    assert.equal(row.market_id, "market"); assert.equal(row.line_id, "123");
    assert.equal((await legacy.query("SELECT account_data->>'token' AS token FROM players WHERE id=$1", [legacyPlayer])).rows[0].token, "legacy-preserved");
  });
  await check("concurrent migration runs execute a pending migration once", async () => {
    const peer = await connect("phase1_fresh", port);
    const options = { readSql: () => "CREATE TABLE phase1_migration_lock_probe(id int); SELECT pg_sleep(0.05);", log: () => {} };
    const results = await Promise.all([
      runRdsMigrations(fresh, ["998_phase1_lock.sql"], options),
      runRdsMigrations(peer, ["998_phase1_lock.sql"], options),
    ]);
    assert.deepEqual(results.map(list => list.length).sort(), [0, 1]);
    await assert.rejects(runRdsMigrations(fresh, ["998_phase1_lock.sql"], { readSql: () => "SELECT 2;", log: () => {} }), /迁移内容发生变化/);
  });
  await check("migration failure rolls back DDL and leaves no success record", async () => {
    await assert.rejects(runRdsMigrations(fresh, ["999_phase1_failure.sql"], {
      readSql: () => "CREATE TABLE phase1_rollback_probe(id int); SELECT no_such_phase1_function();", log: () => {},
    }));
    assert.equal((await fresh.query("SELECT to_regclass('phase1_rollback_probe') AS name")).rows[0].name, null);
    assert.equal((await fresh.query("SELECT count(*)::int AS n FROM changmen_schema_migrations WHERE name='999_phase1_failure.sql'")).rows[0].n, 0);
  });

  // Override every DB alternative before importing application modules; .env cannot select RDS.
  process.env.DATABASE_URL = `postgresql://changmen_test@127.0.0.1:${port}/phase1_fresh`;
  process.env.DATABASE_URL_PUBLIC = ""; process.env.DATABASE_URL_INTERNAL = "";
  process.env.DATABASE_SSL = "0";
  process.env.CHANGMEN_STORAGE_DIR = path.join(temporary, "storage");
  process.env.ESPORT_DATA_DIR = path.join(temporary, "storage", "esport");
  process.env.DATABASE_APPLICATION_NAME = "changmen-phase1-local-test";
  db = await import("../../server/db/index.js");
  const account = await import("../../server/backend/core/account/account_service.js");
  const cache = await import("../../server/backend/core/db/store.js");
  const owner = randomUUID(), otherOwner = randomUUID(), emptyOwner = randomUUID();
  for (const id of [owner, otherOwner, emptyOwner]) {
    await fresh.query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic',1,1)", [id, id]);
    await fresh.query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,$2,1,1) ON CONFLICT DO NOTHING", [id, id]);
  }
  const tag = (await fresh.query("INSERT INTO tag_platforms(name,created_at) VALUES('phase1-OB',1) RETURNING id")).rows[0].id;
  async function player(uid, name) {
    return Number((await fresh.query(`INSERT INTO players(platform_id,platform_name,player_name,provider,owner_user_id,account_data,created_at,updated_at)
      VALUES($1,'phase1-OB',$2,'OB',$3,'{"token":"original"}',1,1) RETURNING id`, [tag, name, uid])).rows[0].id);
  }
  const one = await player(owner, "one"), two = await player(owner, "two"), foreign = await player(otherOwner, "foreign");
  const record = (id, token) => ({ accountId: id, platformId: Number(tag), platformName: "phase1-OB", playerName: `p${id}`, provider: "OB", ...(token ? { token } : {}) });
  const stored = async id => (await fresh.query("SELECT account_data,deleted_at FROM players WHERE id=$1", [id])).rows[0];
  await cache.loadAccountsForUserStrict(owner);
  await check("prune failure rolls back earlier account updates and keeps the cache", async () => {
    await fresh.query(`CREATE FUNCTION phase1_fail_prune() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN RAISE EXCEPTION 'phase1 prune failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER phase1_prune BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION phase1_fail_prune()`);
    await assert.rejects(account.handleSaveAccounts([record(one, "uncommitted")], owner), /phase1 prune failure/);
    assert.equal((await stored(one)).account_data.token, "original");
    assert.equal((await stored(two)).deleted_at, null);
    assert.equal(cache.listAccountsForUser(owner).find(row => row.accountId === one).token, "original");
    await fresh.query("DROP TRIGGER phase1_prune ON players; DROP FUNCTION phase1_fail_prune()");
  });
  await check("write failure cannot report a successful save or prune another account", async () => {
    await fresh.query(`CREATE FUNCTION phase1_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.account_data->>'token'='fail-write' THEN RAISE EXCEPTION 'phase1 write failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER phase1_write BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION phase1_fail_write()`);
    await assert.rejects(account.handleSaveData("ACCOUNT", JSON.stringify([record(one, "fail-write")]), owner), /phase1 write failure/);
    assert.equal((await stored(two)).deleted_at, null);
    assert.equal(cache.listAccountsForUser(owner).find(row => row.accountId === one).token, "original");
    await fresh.query("DROP TRIGGER phase1_write ON players; DROP FUNCTION phase1_fail_write()");
  });
  await check("empty overwrite and foreign player remain rejected", async () => {
    assert.equal((await account.handleSaveAccounts([], owner)).ok, false);
    assert.equal((await account.handleSaveAccounts([record(foreign, "forged")], owner)).ok, false);
    assert.equal((await stored(foreign)).account_data.token, "original");
    assert.equal((await account.handleSaveAccounts([], emptyOwner)).ok, true);
  });
  await check("successful A8 ACCOUNT save commits updates and prune together", async () => {
    assert.deepEqual(await account.handleSaveData("ACCOUNT", JSON.stringify([record(one, "committed")]), owner), { ok: true, info: true });
    assert.equal((await stored(one)).account_data.token, "committed");
    assert.notEqual((await stored(two)).deleted_at, null);
    assert.deepEqual(cache.listAccountsForUser(owner).map(row => row.accountId), [one]);
    assert.equal((await account.handleSaveAccounts([record(one)], owner)).ok, true);
    assert.equal((await stored(one)).account_data.token, "committed");
  });
  await check("an incomplete account UPDATE rolls back the whole replacement", async () => {
    const rows = [record(one, "partial"), record(999999999, "missing")];
    await assert.rejects(db.saveAccountRecordsForOwner(owner, rows, { replaceWith: async () => rows }), /账号保存未全部确认/);
    assert.equal((await stored(one)).account_data.token, "committed");
  });
  await check("database owner lock serializes concurrent replacement snapshots", async () => {
    let release, enter;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const first = db.saveAccountRecordsForOwner(owner, [record(one)], { replaceWith: async ({ existing }) => {
      enter(); await gate; return existing.map(row => ({ ...row, token: "first" }));
    } });
    await entered;
    let secondEntered = false;
    const second = db.saveAccountRecordsForOwner(owner, [record(one)], { replaceWith: async ({ existing }) => {
      secondEntered = true; assert.equal(existing[0].token, "first");
      return existing.map(row => ({ ...row, token: "second" }));
    } });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(secondEntered, false);
    }
    finally { release(); }
    await first; await second;
    assert.equal((await stored(one)).account_data.token, "second");
  });
  await check("missing profile persistence fails without publishing a configuration cache", async () => {
    const missing = randomUUID();
    await assert.rejects(cache.setUserSetting(missing, "CollectConfig", '{"collect":[]}'), /profile 不存在/);
    assert.equal(cache.getUserSetting(missing, "CollectConfig"), null);
  });
  await check("a failed configuration write cannot undo or contaminate the next successful write", async () => {
    await cache.loadProfileById(owner);
    await cache.updateProfileSetting(owner, { base: 1 });
    await fresh.query(`CREATE FUNCTION phase1_fail_config() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.betting_config->>'fail'='true' THEN RAISE EXCEPTION 'phase1 config failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER phase1_config BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION phase1_fail_config()`);
    const results = await Promise.allSettled([
      cache.updateProfileSetting(owner, { fail: true }),
      cache.updateProfileSetting(owner, { succeeds: true }),
    ]);
    assert.equal(results[0].status, "rejected"); assert.equal(results[1].status, "fulfilled");
    assert.deepEqual(cache.getProfileById(owner).setting, { base: 1, succeeds: true });
    assert.deepEqual((await fresh.query("SELECT betting_config FROM profiles WHERE id=$1", [owner])).rows[0].betting_config, { base: 1, succeeds: true });
  });
  console.log(JSON.stringify({ passed: true, localOnly: true, postgres: postgresVersion, checks: checks.length, cases: checks }, null, 2));
}
finally {
  if (db) await db.getPgPool()?.end();
  await Promise.allSettled(clients.map(client => client.end()));
  if (startAttempted && existsSync(path.join(data, "postmaster.pid")))
    execFileSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { windowsHide: true, stdio: "ignore", timeout: 30000 });
  if (path.dirname(path.resolve(temporary)) === tempRoot && path.basename(temporary).startsWith("changmen-phase1-pg-"))
    rmSync(temporary, { recursive: true, force: true });
}
