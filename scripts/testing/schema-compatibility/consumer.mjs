// Run in a separate process so old and candidate pools/module caches cannot mix.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, mode, userId] = process.argv.slice(2);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1", "Compatibility consumers require an isolated local database");
assert.equal(url.username, "changmen_test");
const load = file => import(pathToFileURL(path.join(root, file)).href);
const dbRoot = root === process.env.CHANGMEN_REFERENCE_ROOT ? "server/db" : "rds";
const { getPgPool } = await load(`${dbRoot}/pg_pool.js`);
const pool = getPgPool();
try {
  if (mode === "verify") {
    const { verifyRdsSchema } = await load(root === process.env.CHANGMEN_REFERENCE_ROOT ? "server/backend/scripts/rds-schema-check.mjs" : "rds/maintenance/rds-schema-check.mjs");
    const client = await pool.connect();
    try { console.log(JSON.stringify(await verifyRdsSchema(client, { log: () => {} }))); }
    finally { client.release(); }
  } else {
    assert(["read", "write", "create"].includes(mode));
    const profiles = await load(`${dbRoot}/rds/profile_store.js`);
    const users = await load(`${dbRoot}/rds/admin_users_store.js`);
    const signals = await load(`${dbRoot}/rds/value_signals_store.js`);
    let selectedUser = userId;
    if (mode === "create") {
      const created = await users.createManagedUser(`fixture_${randomUUID()}`, "synthetic-not-used-for-login", 1);
      selectedUser = created.id;
    }
    if (mode === "write") await profiles.writeProfileAsync(selectedUser, { collect_config: { OB: true } });
    const profile = await profiles.fetchProfileById(selectedUser);
    assert(profile, "Expected legacy fixture profile");
    console.log(JSON.stringify({ profile, identity: await users.readManagedUserIdentity(selectedUser),
      administrators: await users.countManagedAdministrators(), dashboard: await signals.createValueSignalDashboardReader()() }));
  }
} finally { await pool.end(); }
