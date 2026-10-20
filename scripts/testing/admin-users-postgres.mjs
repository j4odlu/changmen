import assert from "node:assert/strict";
import { test } from "node:test";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

await withTemporaryPostgres(async () => {
  const db = await import("../../rds/index.js");
  const admin = await import("../../server/backend/core/account/admin_service.js");
  const cache = await import("../../server/backend/core/db/store.js");
  const pool = db.getPgPool();
  const read = async id => (await pool.query("SELECT u.*,p.preferences FROM users u JOIN profiles p ON p.id=u.id WHERE u.id=$1", [id])).rows[0];
  try {
    const client = await pool.connect();
    try { await applyRdsSchema(client); } finally { client.release(); }
    let alice, bob, root;
    await test("create persists a hashed password and exactly one matching profile", async () => {
      alice = await admin.createAdminUser(" alice ", "synthetic-one");
      bob = await admin.createAdminUser("bob", "synthetic-two");
      root = await admin.createAdminUser("root_test", "synthetic-root");
      assert.equal(alice.userName, "alice");
      const row = await read(alice.id);
      assert.notEqual(row.password_hash, "synthetic-one");
      assert.equal((await pool.query("SELECT password_hash=crypt($2,password_hash) AS valid FROM users WHERE id=$1", [alice.id, "synthetic-one"])).rows[0].valid, true);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM profiles WHERE id=$1", [alice.id])).rows[0].n, 1);
    });
    await test("case-insensitive duplicate creation leaves both tables unchanged", async () => {
      await assert.rejects(admin.createAdminUser("ALICE", "synthetic-three"), /用户名已存在/);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 3);
    });
    await test("same-name no-op and case-only rename preserve unrelated preferences", async () => {
      await pool.query("UPDATE profiles SET preferences=$2 WHERE id=$1", [alice.id, { lastActiveAt: 123, Follow: "keep" }]);
      const before = await read(alice.id);
      assert.deepEqual(await admin.renameAdminUser(alice.id, "alice"), alice);
      assert.equal((await read(alice.id)).updated_at, before.updated_at);
      assert.deepEqual(await admin.renameAdminUser(alice.id, "Alice"), { id: alice.id, userName: "Alice" });
      assert.equal((await pool.query("SELECT user_name FROM profiles WHERE id=$1", [alice.id])).rows[0].user_name, "Alice");
      assert.deepEqual((await read(alice.id)).preferences, { lastActiveAt: 123, Follow: "keep" });
      assert.equal(cache.listProfileRows().find(row => row.id === alice.id)?.user_name, "Alice");
    });
    await test("rename conflict is rejected without changing users or profiles", async () => {
      await assert.rejects(admin.renameAdminUser(alice.id, "BOB"), /用户名已存在/);
      assert.equal((await read(alice.id)).user_name, "Alice");
    });
    await test("profile write failure rolls back the existing atomic rename and preserves cache", async () => {
      await pool.query(`CREATE FUNCTION reject_profile_rename() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected profile update'; END $$;
        CREATE TRIGGER reject_profile_rename BEFORE UPDATE OF user_name ON profiles FOR EACH ROW EXECUTE FUNCTION reject_profile_rename()`);
      try { await assert.rejects(admin.renameAdminUser(alice.id, "new_name"), /injected profile update/); }
      finally { await pool.query("DROP TRIGGER reject_profile_rename ON profiles; DROP FUNCTION reject_profile_rename()"); }
      assert.equal((await read(alice.id)).user_name, "Alice");
      assert.equal(cache.listProfileRows().find(row => row.id === alice.id)?.user_name, "Alice");
    });
    await test("password changes retain visibility checks and use database hashing", async () => {
      await assert.rejects(admin.resetAdminUserPassword(alice.id, "synthetic-new", { id: bob.id, role: "user" }), /无权操作该用户/);
      assert.deepEqual(await admin.resetAdminUserPassword(alice.id, "synthetic-new"), { id: alice.id, userName: "Alice" });
      const { rows } = await pool.query("SELECT password_hash=crypt($2,password_hash) AS valid,password_hash=crypt($3,password_hash) AS old FROM users WHERE id=$1", [alice.id, "synthetic-new", "synthetic-one"]);
      assert.equal(rows[0].valid, true); assert.equal(rows[0].old, false);
    });
    await test("password update failure propagates without changing the stored password", async () => {
      const before = (await read(alice.id)).password_hash;
      await pool.query(`CREATE FUNCTION reject_password() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected password update'; END $$;
        CREATE TRIGGER reject_password BEFORE UPDATE OF password_hash ON users FOR EACH ROW EXECUTE FUNCTION reject_password()`);
      try { await assert.rejects(admin.resetAdminUserPassword(alice.id, "synthetic-fail"), /injected password update/); }
      finally { await pool.query("DROP TRIGGER reject_password ON users; DROP FUNCTION reject_password()"); }
      assert.equal((await read(alice.id)).password_hash, before);
    });
    await test("all existing last-admin protections reject before mutation", async () => {
      await admin.setAdminUserRole(root.id, "admin");
      for (const run of [() => admin.deleteAdminUser(root.id), () => admin.setAdminUserAdmin(root.id, false), () => admin.setAdminUserRole(root.id, "user")])
        await assert.rejects(run(), /至少保留一名管理员/);
      assert.equal((await read(root.id)).is_admin, true);
      assert.equal((await read(root.id)).role, "admin");
    });
    await test("self-delete and self-role-change remain forbidden", async () => {
      await assert.rejects(admin.deleteAdminUser(root.id, root.id), /不能删除当前登录账号/);
      await assert.rejects(admin.setAdminUserRole(root.id, "user", undefined, root.id), /不能更改当前登录账号的角色/);
    });
    await test("another administrator permits demotion and cache refresh", async () => {
      await admin.setAdminUserRole(bob.id, "admin");
      assert.deepEqual(await admin.setAdminUserRole(root.id, "user"), { id: root.id, userName: "root_test", role: "user", teamId: null, isAdmin: 0 });
      assert.equal(cache.listProfileRows().find(row => row.id === root.id)?.role, "user");
    });
    await test("team validation, member count and delete results remain unchanged", async () => {
      await assert.rejects(admin.setAdminUserRole(alice.id, "leader"), /团队长必须分配/);
      await admin.upsertTeam("synthetic_team", "Synthetic team");
      await admin.setAdminUserRole(alice.id, "leader", "synthetic_team");
      await assert.rejects(admin.deleteTeam("synthetic_team"), /团队内还有 1 个成员/);
      await admin.setAdminUserRole(alice.id, "user", null);
      assert.deepEqual(await admin.deleteTeam("synthetic_team"), { id: "synthetic_team" });
    });
    await test("deletion keeps existing profile cascade and leaves unrelated users intact", async () => {
      assert.deepEqual(await admin.deleteAdminUser(alice.id), { id: alice.id, userName: "Alice" });
      assert.equal(await read(alice.id), undefined);
      assert.equal((await read(bob.id)).user_name, "bob");
      await assert.rejects(admin.deleteAdminUser(alice.id), /用户不存在/);
      await assert.rejects(admin.resetAdminUserPassword(alice.id, "synthetic-missing"), /用户不存在/);
    });
  } finally { await pool.end(); }
});
