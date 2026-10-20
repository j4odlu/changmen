import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

function gate() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("audit gate timed out")), 5_000);
    })]);
  }
  finally { clearTimeout(timer); }
}

await withTemporaryPostgres(async () => {
  const db = await import("../../rds/index.js");
  const cache = await import("../../server/backend/core/db/store.js");
  const account = await import("../../server/backend/core/account/account_service.js");
  const pool = db.getPgPool(), query = pool.query.bind(pool), passed = [];
  function instrument(run) {
    const originals = new Map();
    const acquired = client => {
      if (originals.has(client)) return;
      const raw = client.query.bind(client); originals.set(client, raw);
      client.query = (...args) => typeof args.at(-1) === "function" ? raw(...args) : run(raw, args);
    };
    pool.on("acquire", acquired);
    return () => { pool.off("acquire", acquired); for (const [client, raw] of originals) client.query = raw; };
  }
  const check = (name, run) => test(name, { timeout: 15_000 }, async () => { await run(); passed.push(name); });
  try {
    const connection = await pool.connect();
    try { await applyRdsSchema(connection); } finally { connection.release(); }
    const owners = [randomUUID(), randomUUID()];
    for (const owner of owners) {
      await query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic',1,1)", [owner, owner]);
      await query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,$2,1,1) ON CONFLICT DO NOTHING", [owner, owner]);
    }
    const [owner, other] = owners;
    const tag = (await query("INSERT INTO tag_platforms(name,created_at) VALUES('boundary-audit',1) RETURNING id")).rows[0].id;
    async function createPlayer(uid = owner) {
      const id = Number((await query(`INSERT INTO players(platform_id,owner_user_id,provider,player_name,account_data,total_balance,created_at,updated_at)
        VALUES($1,$2,'OB',$3,'{"token":"initial"}',100,1,1) RETURNING id`, [tag, uid, randomUUID()])).rows[0].id);
      await cache.loadAccountsForUserStrict(uid);
      return id;
    }
    const stored = async id => (await query("SELECT total_balance,account_data,deleted_at FROM players WHERE id=$1", [id])).rows[0];
    const logs = async id => Number((await query("SELECT count(*) FROM money_logs WHERE player_id=$1", [id])).rows[0].count);

    await check("COMMIT failure rolls back recharge amount and money log, then the next recharge succeeds", async () => {
      const id = await createPlayer();
      await query(`CREATE FUNCTION audit_log_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.description='audit-fail-commit' THEN RAISE EXCEPTION 'audit deferred log failure'; END IF; RETURN NEW; END $$;
        CREATE CONSTRAINT TRIGGER audit_log_commit_failure AFTER INSERT ON money_logs DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION audit_log_commit_failure()`);
      try {
        const result = await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: id, ownerUserId: owner, amount: 7, description: "audit-fail-commit" });
        assert.equal(result.ok, false); assert.match(result.msg, /deferred log failure/);
        assert.equal((await stored(id)).total_balance, 100); assert.equal(await logs(id), 0);
      }
      finally { await query("DROP TRIGGER audit_log_commit_failure ON money_logs; DROP FUNCTION audit_log_commit_failure()"); }
      assert.equal((await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: id, ownerUserId: owner, amount: 2 })).ok, true);
      assert.equal((await stored(id)).total_balance, 102); assert.equal(await logs(id), 1);
    });

    await check("COMMIT failure rolls back ACCOUNT edits and pruning without publishing cache or poisoning its queue", async () => {
      const id = await createPlayer(), removed = await createPlayer();
      const before = structuredClone(cache.listAccountsForUser(owner));
      const planned = before.filter(row => row.accountId !== removed).map(row => row.accountId === id ? { ...row, token: "uncommitted", auditFailCommit: "yes" } : row);
      await query(`CREATE FUNCTION audit_account_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.account_data->>'auditFailCommit'='yes' THEN RAISE EXCEPTION 'audit deferred account failure'; END IF; RETURN NEW; END $$;
        CREATE CONSTRAINT TRIGGER audit_account_commit_failure AFTER UPDATE ON players DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION audit_account_commit_failure()`);
      try {
        await assert.rejects(cache.saveAccountsTransactionForUser(owner, planned, () => planned), /deferred account failure/);
        assert.equal((await stored(id)).account_data.token, "initial");
        assert.equal((await stored(removed)).deleted_at, null);
        assert.deepEqual(cache.listAccountsForUser(owner), before);
      }
      finally { await query("DROP TRIGGER audit_account_commit_failure ON players; DROP FUNCTION audit_account_commit_failure()"); }
      assert.equal((await cache.updateAccountForUser(owner, id, { token: "confirmed" })).token, "confirmed");
      assert.equal((await stored(removed)).deleted_at, null);
    });

    await check("profile lock timeout aborts recharge without partial writes and releases the transaction", async () => {
      const id = await createPlayer(), blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [owner]);
      const restore = instrument(async (raw, args) => {
        const result = await raw(...args);
        if (args[0] === "BEGIN") await raw("SET LOCAL lock_timeout='80ms'");
        return result;
      });
      try {
        const result = await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: id, ownerUserId: owner, amount: 4 });
        assert.equal(result.ok, false); assert.match(result.msg, /lock timeout/);
        assert.equal((await stored(id)).total_balance, 100); assert.equal(await logs(id), 0);
      }
      finally { await blocker.query("ROLLBACK"); blocker.release(); restore(); }
      assert.equal((await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: id, ownerUserId: owner, amount: 1 })).ok, true);
    });

    await check("a blocked owner does not serialize another owner's account mutation", async () => {
      const id = await createPlayer(other), blocker = await pool.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [owner]);
        const result = await bounded(cache.updateAccountForUser(other, id, { description: "independent" }));
        assert.equal(result.description, "independent");
        assert.equal((await stored(id)).account_data.description, "independent");
      }
      finally { await blocker.query("ROLLBACK"); blocker.release(); }
    });

    await check("actual strict read delivered after deletion cannot restore the deleted row", async () => {
      const id = await createPlayer(), entered = gate(), release = gate();
      const original = pool.query; let held = false, loading;
      pool.query = async (...args) => {
        const result = await original.apply(pool, args);
        if (!held && String(args[0]).includes("WHERE owner_user_id = $1::uuid AND deleted_at IS NULL")) {
          held = true; entered.resolve(); await release.promise;
        }
        return result;
      };
      try {
        loading = cache.loadAccountsForUserStrict(owner);
        await bounded(entered.promise);
        assert.equal((await account.handleDeletePlayer({ playerId: id }, owner)).ok, true);
        release.resolve(); assert.equal((await loading).some(row => row.accountId === id), false);
        assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === id), false);
        assert((await stored(id)).deleted_at);
      }
      finally { release.resolve(); if (loading) await loading; pool.query = original; }
    });

    await check("failed soft delete leaves a delayed committed snapshot and active account intact", async () => {
      const id = await createPlayer(), committed = gate(), release = gate(); let held = false, patch;
      await query(`CREATE FUNCTION audit_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'audit delete failure'; END $$;
        CREATE TRIGGER audit_delete_failure BEFORE UPDATE ON players FOR EACH ROW
        WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) EXECUTE FUNCTION audit_delete_failure()`);
      const restore = instrument(async (raw, args) => {
        const result = await raw(...args);
        if (!held && args[0] === "COMMIT") { held = true; committed.resolve(); await release.promise; }
        return result;
      });
      try {
        patch = cache.updateAccountForUser(owner, id, { description: "committed-before-failed-delete" });
        await bounded(committed.promise);
        assert.equal((await account.handleDeletePlayer({ playerId: id }, owner)).ok, false);
        release.resolve(); assert.equal((await patch).accountId, id);
        assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === id), true);
        assert.equal((await stored(id)).deleted_at, null);
      }
      finally {
        release.resolve(); if (patch) await patch; restore();
        await query("DROP TRIGGER audit_delete_failure ON players; DROP FUNCTION audit_delete_failure()");
      }
    });

    await check("deletion during a completed rollback stays deleted and the next queued mutation succeeds", async () => {
      const id = await createPlayer(), survivor = await createPlayer(), rolledBack = gate(), release = gate(); let held = false, rejected;
      const restore = instrument(async (raw, args) => {
        if (String(args[0]).includes("UPDATE players AS p SET")) throw new Error("audit patch failure");
        const result = await raw(...args);
        if (!held && args[0] === "ROLLBACK") { held = true; rolledBack.resolve(); await release.promise; }
        return result;
      });
      try {
        rejected = assert.rejects(cache.updateAccountForUser(owner, id, { token: "uncommitted" }), /audit patch failure/);
        await bounded(rolledBack.promise);
        assert.equal((await account.handleDeletePlayer({ playerId: id }, owner)).ok, true);
        release.resolve(); await rejected;
        assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === id), false);
        assert((await stored(id)).deleted_at);
        assert.equal((await stored(id)).account_data.token, "initial");
      }
      finally { release.resolve(); if (rejected) await rejected; restore(); }
      assert.equal((await cache.updateAccountForUser(owner, survivor, { description: "recovered" })).description, "recovered");
      assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === id), false);
    });

    await check("metadata patch serializes with a later direct balance write without losing either database update", async () => {
      const id = await createPlayer(), locked = gate(), release = gate(); let held = false, operations;
      const restore = instrument(async (raw, args) => {
        const result = await raw(...args);
        if (!held && String(args[0]).includes("ORDER BY id FOR UPDATE")) {
          held = true; locked.resolve(); await release.promise;
        }
        return result;
      });
      try {
        const metadata = account.syncAccountRowInKv(id, { balance: 1, currency: "CNY", totalProfit: 1 }, owner);
        await bounded(locked.promise);
        const laterBalance = account.handleUpdateBalance({ playerId: id, balance: 200 }, owner);
        operations = Promise.all([metadata, laterBalance]);
        release.resolve(); const [, updated] = await operations;
        assert.equal(updated.ok, true);
        assert.equal((await stored(id)).total_balance, 200);
        assert.equal((await stored(id)).account_data.currency, "CNY");
        assert.equal((await cache.loadAccountsForUserStrict(owner)).find(row => row.accountId === id).balance, 200);
      }
      finally { release.resolve(); if (operations) await operations; restore(); }
    });
    console.log(JSON.stringify({ passed: passed.length === 8, localOnly: true, checks: passed.length, cases: passed }, null, 2));
  }
  finally { await pool.end(); }
});
