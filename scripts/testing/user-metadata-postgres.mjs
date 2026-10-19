import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

// Real SQL against a disposable cluster; database destinations are pinned before app imports.
await withTemporaryPostgres(async () => {
  const db = await import("../../server/db/index.js");
  const { persistUserPresence } = await import("../../server/db/profile_metadata.js");
  const { recordUserLastLogin } = await import("../../server/backend/core/account/user_login_meta.js");
  const pool = db.getPgPool(), query = pool.query.bind(pool);
  try {
    const connection = await pool.connect();
    try { await applyRdsSchema(connection); } finally { connection.release(); }
    const userId = randomUUID();
    await query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic',1,1)", [userId, userId]);
    await query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,$2,1,1) ON CONFLICT DO NOTHING", [userId, userId]);
    const read = async () => (await query("SELECT preferences,updated_at FROM profiles WHERE id=$1", [userId])).rows[0];
    const reset = async preferences => query("UPDATE profiles SET preferences=$2::jsonb WHERE id=$1", [userId, JSON.stringify(preferences)]);

    await test("login preserves unrelated preferences and normalizes IP", async () => {
      await reset({ theme: "dark", nested: { keep: true }, lastActiveAt: 100 });
      assert.equal(await recordUserLastLogin(` ${userId} `, "::ffff:203.0.113.8"), true);
      const { preferences } = await read();
      assert.equal(preferences.lastLoginIp, "203.0.113.8");
      assert.equal(typeof preferences.lastLoginAt, "number");
      assert.equal(preferences.lastActiveAt, 100);
      assert.deepEqual(preferences.nested, { keep: true });
      assert.equal(preferences.theme, "dark");
    });
    await test("a delayed login snapshot cannot erase a committed presence or preference patch", { timeout: 10000 }, async () => {
      await reset({ theme: "old", lastActiveAt: 100 });
      let release, entered;
      const blocked = new Promise(resolve => { release = resolve; });
      const reached = new Promise(resolve => { entered = resolve; });
      pool.query = async (...args) => {
        const result = await query(...args);
        if (String(args[0]).includes("SELECT p.*") && args[1]?.[0] === userId) { entered(); await blocked; }
        return result;
      };
      const pending = recordUserLastLogin(userId, "203.0.113.9");
      try {
        await Promise.race([reached, new Promise((_, reject) => {
          const timeout = setTimeout(() => reject(new Error("snapshot gate timed out")), 3000); timeout.unref();
        })]);
        await persistUserPresence(userId, 200, 201);
        await query("UPDATE profiles SET preferences=preferences || '{\"theme\":\"new\",\"extra\":true}'::jsonb WHERE id=$1", [userId]);
      }
      finally { release(); pool.query = query; }
      assert.equal(await pending, true);
      const { preferences } = await read();
      assert.equal(preferences.lastActiveAt, 200);
      assert.equal(preferences.theme, "new");
      assert.equal(preferences.extra, true);
      assert.equal(preferences.lastLoginIp, "203.0.113.9");
    });
    await test("presence after login preserves login fields", async () => {
      await persistUserPresence(userId, 300, 301);
      const { preferences, updated_at } = await read();
      assert.equal(preferences.lastLoginIp, "203.0.113.9");
      assert.equal(preferences.lastActiveAt, 300);
      assert.equal(Number(updated_at), 301);
    });
    await test("live flush retains existing last-write semantics; legacy import only advances", async () => {
      assert.equal(await persistUserPresence(userId, 50, 51), true);
      assert.equal((await read()).preferences.lastActiveAt, 50);
      assert.equal(await persistUserPresence(userId, 49, 52, { onlyIfNewer: true }), false);
      assert.equal(await persistUserPresence(userId, 50, 53, { onlyIfNewer: true }), false);
      assert.equal(Number((await read()).updated_at), 51);
      assert.equal(await persistUserPresence(userId, 60, 61, { onlyIfNewer: true }), true);
      assert.equal((await read()).preferences.lastActiveAt, 60);
    });
    await test("missing users do not acknowledge login or presence persistence", async () => {
      const missing = randomUUID();
      assert.equal(await recordUserLastLogin(missing, "::1"), false);
      assert.equal(await persistUserPresence(missing, 100, 100), false);
    });
    await test("legacy malformed preference values retain the previous login normalization", async () => {
      for (const preferences of [null, [], "legacy"]) {
        await reset(preferences);
        assert.equal(await recordUserLastLogin(userId, "::1"), true);
        const saved = (await read()).preferences;
        assert.equal(saved.lastLoginIp, "127.0.0.1");
        assert.deepEqual(Object.keys(saved).sort(), ["lastLoginAt", "lastLoginIp"]);
      }
    });
    await test("database failure propagates without partially modifying preferences", async () => {
      await reset({ marker: "before" });
      await query(`CREATE FUNCTION reject_metadata_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic metadata failure'; END $$`);
      await query("CREATE TRIGGER reject_metadata_test BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION reject_metadata_test()");
      try {
        await assert.rejects(recordUserLastLogin(userId, "::1"), /synthetic metadata failure/);
        await assert.rejects(persistUserPresence(userId, 100, 100), /synthetic metadata failure/);
        assert.deepEqual((await read()).preferences, { marker: "before" });
      }
      finally { await query("DROP TRIGGER reject_metadata_test ON profiles"); await query("DROP FUNCTION reject_metadata_test()"); }
    });
  }
  finally { pool.query = query; await pool.end(); }
});
