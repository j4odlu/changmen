import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema, initializeEmptyRdsSchema } from "../../server/backend/scripts/apply-rds-schema.mjs";
import { verifyRdsSchema, readSchemaBaseline } from "../../server/backend/scripts/rds-schema-check.mjs";

const run = promisify(execFile);
const bash = process.platform === "win32" ? "C:/msys64/usr/bin/bash.exe" : "bash";
const shellPath = value => process.platform === "win32"
  ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : value;

await withTemporaryPostgres(async ({ temporary }) => {
  const db = await import("../../server/db/index.js");
  const pool = db.getPgPool(), cases = [];
  try {
    const client = await pool.connect();
    try { await applyRdsSchema(client); } finally { client.release(); }
    const owner = randomUUID();
    // Synthetic fixture username intentionally exercises historical 004/012 DML.
    await pool.query("INSERT INTO users(id,user_name,password_hash,is_admin,role,created_at,updated_at) VALUES($1,'admin','synthetic',false,'user',1,1)", [owner]);
    await pool.query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,'admin',1,1) ON CONFLICT DO NOTHING", [owner]);
    const tag = (await pool.query("INSERT INTO tag_platforms(name,created_at) VALUES('deploy-preservation',1) RETURNING id")).rows[0].id;
    const id = Number((await pool.query(`INSERT INTO players(platform_id,owner_user_id,provider,player_name,total_balance,account_data,created_at,updated_at)
      VALUES($1,$2,'OB','synthetic',200,'{"token":"synthetic-current","currency":"CNY"}',1,1) RETURNING id`, [tag, owner])).rows[0].id);
    const legacy = [{ accountId: id, platformId: Number(tag), provider: "OB", playerName: "synthetic", balance: 1, token: "synthetic-legacy" }];
    await pool.query("UPDATE profiles SET accounts=$2::jsonb WHERE id=$1", [owner, JSON.stringify(legacy)]);
    const before = (await pool.query("SELECT * FROM players WHERE id=$1", [id])).rows[0];
    const beforeUser = (await pool.query("SELECT * FROM users WHERE id=$1", [owner])).rows[0];
    const beforeProfile = (await pool.query("SELECT * FROM profiles WHERE id=$1", [owner])).rows[0];
    await pool.query("SELECT setval('client_matches_id_seq',12345)");
    // Release activation must not execute database maintenance. The standalone
    // checker is exercised separately against the same disposable database.
    const fixture = path.join(temporary, "activation"), bin = path.join(fixture, "bin");
    for (const directory of [bin, "server/backend", "client/web", "deploy"].map(name => path.isAbsolute(name) ? name : path.join(fixture, name)))
      mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(fixture, "package.json"), "{}");
    writeFileSync(path.join(fixture, "deploy/ecosystem.config.cjs"), "module.exports = {};");
    writeFileSync(path.join(fixture, "client/web/.deploy-needs-dist-upload"), "preserve-marker");
    function command(name, body) {
      const file = path.join(bin, name);
      writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`); chmodSync(file, 0o755);
    }
    command("node", `printf '%s\\n' "$PWD:$*" >> "$AUDIT_NODE_LOG"; echo "Unexpected activation script: $*" >&2; exit 97`);
    command("npm", "exit 0");
    command("pm2", 'printf "%s\\n" "$*" >> "$AUDIT_PM2_LOG"; if [[ "${1:-}" == describe ]]; then exit 1; fi; exit 0');
    for (const name of ["curl", "ssh", "scp"]) command(name, 'echo "Unexpected network access" >&2; exit 98');
    const manifest = path.join(fixture, "changes.txt"), nodeLog = path.join(fixture, "node.log"), pm2Log = path.join(fixture, "pm2.log");
    const scenarios = [
      { name: "ordinary runtime activation does not access schema or change players, roles, profiles or sequences", files: ["server/backend/core/db/store.js", "server/db/rds/player_store.js"], full: "0", ledger: 42 },
      { name: "activation without a migration ledger does not replay or adopt migrations", files: ["server/backend/scripts/apply-rds-schema.mjs"], full: "0", dropLedger: true, ledger: null },
      { name: "activation with an empty ledger does not write migration records", files: ["server/backend/scripts/check-rds-schema.mjs"], full: "0", emptyLedger: true, ledger: 0 },
      { name: "explicit full activation also does not invoke database maintenance", files: ["server/db/rds/player_store.js"], full: "1", ledger: 0 },
      { name: "standalone check rejects a missing column while activation remains independent", files: ["server/backend/core/db/store.js"], full: "0", missingColumn: true, ledger: 0 },
    ];
    for (const scenario of scenarios) {
      if (scenario.dropLedger) await pool.query("DROP TABLE changmen_schema_migrations");
      if (scenario.emptyLedger) await pool.query("CREATE TABLE changmen_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
      if (scenario.missingColumn) await pool.query("ALTER TABLE platform_bets DROP COLUMN line_id");
      writeFileSync(manifest, scenario.files.join("\n") + "\n"); writeFileSync(nodeLog, ""); writeFileSync(pm2Log, "");
      const activation = run(bash, ["-c", 'export PATH="$AUDIT_BIN:/usr/bin:/bin:$PATH"; exec bash "$AUDIT_ACTIVATION_SCRIPT"'], {
        cwd: process.cwd(), timeout: 30_000, windowsHide: true,
        env: { ...process.env, DEPLOY_REPO: shellPath(fixture), DEPLOY_CHANGED_PATHS_FILE: shellPath(manifest),
          DEPLOY_SKIP_GIT_PULL: "1", DEPLOY_RELEASE_MODE: "1", DEPLOY_SCHEMA_CHANGED: "0", DEPLOY_FULL: scenario.full,
          DEPLOY_SKIP_APP_BUILD: "1", DEPLOY_SKIP_POSTCHECK: "1", DEPLOY_PLAN_ONLY: "0", DEPLOY_OLD_HEAD: "old", DEPLOY_NEW_HEAD: "new",
          AUDIT_BIN: shellPath(bin), AUDIT_NODE_LOG: shellPath(nodeLog), AUDIT_PM2_LOG: shellPath(pm2Log), AUDIT_SOURCE_ROOT: process.cwd().replaceAll("\\", "/"),
          AUDIT_REAL_NODE: process.execPath.replaceAll("\\", "/"), AUDIT_ACTIVATION_SCRIPT: shellPath(path.resolve("deploy/scripts/deploy-server-remote.sh")),
        },
      });
      await activation;
      const checkClient = await pool.connect();
      try {
        if (scenario.missingColumn) await assert.rejects(verifyRdsSchema(checkClient), /platform_bets.line_id: missing/);
        else await verifyRdsSchema(checkClient);
      } finally { checkClient.release(); }
      assert.deepEqual((await pool.query("SELECT * FROM players WHERE id=$1", [id])).rows[0], before);
      assert.deepEqual((await pool.query("SELECT * FROM users WHERE id=$1", [owner])).rows[0], beforeUser);
      assert.deepEqual((await pool.query("SELECT * FROM profiles WHERE id=$1", [owner])).rows[0], beforeProfile);
      assert.equal((await pool.query("SELECT last_value FROM client_matches_id_seq")).rows[0].last_value, "12345");
      assert.equal(readFileSync(path.join(fixture, "client/web/.deploy-needs-dist-upload"), "utf8"), "preserve-marker");
      const commands = readFileSync(nodeLog, "utf8").trim().split("\n").filter(Boolean);
      assert.deepEqual(commands, [], "application activation must not run database maintenance");
      const ledger = (await pool.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name;
      if (scenario.ledger === null) assert.equal(ledger, null);
      else assert.equal(Number((await pool.query("SELECT count(*) FROM changmen_schema_migrations")).rows[0].count), scenario.ledger);
      cases.push(scenario.name); console.log(`PASS ${scenario.name}`);
    }
    await pool.query("ALTER TABLE platform_bets ADD COLUMN line_id bigint");
    async function drift(name, change, restore, pattern) {
      await pool.query(change);
      const client = await pool.connect();
      try { await assert.rejects(verifyRdsSchema(client), pattern); }
      finally { client.release(); await pool.query(restore); }
      assert.deepEqual((await pool.query("SELECT * FROM players WHERE id=$1", [id])).rows[0], before);
      assert.deepEqual((await pool.query("SELECT * FROM users WHERE id=$1", [owner])).rows[0], beforeUser);
      cases.push(name); console.log(`PASS ${name}`);
    }
    await drift("wrong field type fails without an automatic ALTER",
      "ALTER TABLE platform_bets ALTER COLUMN line_id TYPE text", "ALTER TABLE platform_bets ALTER COLUMN line_id TYPE bigint USING line_id::bigint",
      /columns.platform_bets.line_id: incompatible/);
    const expected = readSchemaBaseline();
    await drift("missing owner constraint fails without repairing or deleting accounts",
      "ALTER TABLE players DROP CONSTRAINT players_active_requires_owner",
      `ALTER TABLE players ADD CONSTRAINT players_active_requires_owner ${expected.schema.constraints['players.players_active_requires_owner'].definition}`,
      /constraints.players.players_active_requires_owner: missing/);
    await drift("missing unique account index fails without deduplicating accounts",
      "DROP INDEX players_venue_account_key_all", expected.schema.indexes['players.players_venue_account_key_all'].definition,
      /indexes.players.players_venue_account_key_all: missing/);
    await drift("disabled identity trigger is rejected without reenabling it automatically",
      "ALTER TABLE canonical_teams DISABLE TRIGGER canonical_teams_before_insert_trg",
      "ALTER TABLE canonical_teams ENABLE TRIGGER canonical_teams_before_insert_trg",
      /triggers.canonical_teams.canonical_teams_before_insert_trg: incompatible/);
    const guard = await pool.connect();
    try {
      await assert.rejects(initializeEmptyRdsSchema(guard), /数据库已有业务表/);
      cases.push("explicit initialization refuses existing tables");
      const raw = guard.query.bind(guard);
      const accidentalWrite = { query: sql => sql.startsWith("SELECT c.relname AS key")
        ? raw("UPDATE users SET is_admin=true") : raw(sql) };
      await assert.rejects(verifyRdsSchema(accidentalWrite), error => error.code === "25006");
      assert.deepEqual((await pool.query("SELECT * FROM users WHERE id=$1", [owner])).rows[0], beforeUser);
      await verifyRdsSchema(guard);
      cases.push("PostgreSQL itself rejects an injected data write inside verification and the next check recovers");
      assert.equal(Number((await pool.query("SELECT count(*) FROM changmen_schema_migrations")).rows[0].count), 0);
      // The compatibility export must also check an existing database, not replay old SQL.
      assert.deepEqual(await applyRdsSchema(guard), []);
      assert.deepEqual((await pool.query("SELECT * FROM users WHERE id=$1", [owner])).rows[0], beforeUser);
      assert.equal((await pool.query("SELECT last_value FROM client_matches_id_seq")).rows[0].last_value, "12345");
      cases.push("compatibility schema entry checks existing databases without replaying role or sequence SQL");
    } finally { guard.release(); }
    console.log(JSON.stringify({ passed: true, localOnly: true, checks: cases.length, cases }, null, 2));
  }
  finally { await pool.end(); }
});
