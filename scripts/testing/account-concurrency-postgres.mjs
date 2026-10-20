import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = promise => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error("concurrency gate timed out")), 5_000); timer.unref();
})]);

await withTemporaryPostgres(async () => {
  const db = await import("../../rds/index.js");
  const cache = await import("../../server/backend/core/db/store.js");
  const account = await import("../../server/backend/core/account/account_service.js");
  const api = (await import("../../server/backend/core/esport-api/store.js")).default;
  const pool = db.getPgPool(), query = pool.query.bind(pool), passed = [];
  async function check(name, run) {
    await test(name, { timeout: 15_000 }, async () => { await run(); passed.push(name); });
  }
  async function instrument(run) {
    const originals = new Map();
    const acquired = client => {
      if (originals.has(client)) return;
      const raw = client.query.bind(client); originals.set(client, raw);
      client.query = (...args) => typeof args.at(-1) === "function" ? raw(...args) : run(client, raw, args);
    };
    pool.on("acquire", acquired);
    return () => { pool.off("acquire", acquired); for (const [client, raw] of originals) client.query = raw; };
  }
  try {
    const connection = await pool.connect();
    try { await applyRdsSchema(connection); } finally { connection.release(); }
    const owner = randomUUID();
    await query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic',1,1)", [owner, owner]);
    await query("INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,$2,1,1) ON CONFLICT DO NOTHING", [owner, owner]);
    const tag = (await query("INSERT INTO tag_platforms(name,created_at) VALUES('concurrency',1) RETURNING id")).rows[0].id;
    const one = Number((await query(`INSERT INTO players(platform_id,owner_user_id,provider,player_name,account_data,total_balance,created_at,updated_at)
      VALUES($1,$2,'OB','one','{"token":"synthetic"}',0,1,1) RETURNING id`, [tag, owner])).rows[0].id);
    const balance = async () => Number((await query("SELECT total_balance FROM players WHERE id=$1", [one])).rows[0].total_balance);
    await cache.loadAccountsForUserStrict(owner);

    await check("S1: delayed balance metadata sync cannot overwrite newer Client_UpdateBalance", async () => {
      const original = api.updateAccountForUser, entered = gate(), release = gate();
      api.updateAccountForUser = async (...args) => {
        if (args[2]?.balance === 10) { entered.resolve(); await release.promise; }
        return original(...args);
      };
      try {
        await db.updatePlayerBalanceRow(one, 10, owner);
        const older = account.syncAccountRowInKv(one, { balance: 10, currency: "CNY", totalProfit: 10 }, owner);
        await bounded(entered.promise);
        assert.equal((await account.handleUpdateBalance({ playerId: one, balance: 20 }, owner)).ok, true);
        release.resolve(); const synced = await older;
        assert.equal(await balance(), 20);
        assert.equal(synced.balance, 20);
        assert.equal(synced.totalProfit, 20);
        assert.equal(cache.listAccountsForUser(owner).find(row => row.accountId === one).balance, 20);
      }
      finally { release.resolve(); api.updateAccountForUser = original; }
    });

    await check("S1/PF: late ledger publication keeps the latest amount and settled profit", async () => {
      const pf = await import("../../server/backend/core/integrations/predictfun/pf_player_account.js");
      const id = Number((await query(`INSERT INTO players(platform_id,owner_user_id,provider,player_name,total_balance,created_at,updated_at)
        VALUES($1,$2,'PredictFun','pf',40,1,1) RETURNING id`, [tag, owner])).rows[0].id);
      const row = await pf.syncAccountRowInKv(id, { balance: 10, totalProfit: 3, credit: 0, currency: "USDT" }, owner);
      assert.equal(row.balance, 40);
      assert.equal(row.totalProfit, 3);
      const response = await pf.publishPfBalanceKnown(id, owner, 10);
      assert.equal(response.ok, true);
      assert.equal(response.info.balance, 40);
      assert.equal(response.info.totalProfit, 0); // No synthetic orders: settled PNL is zero, not the balance.
    });

    await check("S2: recharge and account patch both commit without profile/FK deadlock", async () => {
      const playerLocked = gate(), release = gate(); let held = false, profileHeld = false, patchPid;
      const restore = await instrument(async (client, raw, args) => {
        const sql = String(args[0]);
        if (sql === "BEGIN") { await raw("SET deadlock_timeout='100ms'"); await raw("SET lock_timeout='3s'"); }
        const ownerLock = sql.includes("SELECT id FROM profiles") && sql.includes("FOR UPDATE");
        if (ownerLock) patchPid = client.processID;
        const result = await raw(...args);
        if (ownerLock) profileHeld = true;
        if (!held && sql.includes("FROM players") && sql.includes("WHERE id = $1 AND deleted_at") && sql.includes("FOR UPDATE")) {
          held = true; playerLocked.resolve(); await release.promise;
        }
        return result;
      });
      let operations;
      try {
        const before = await balance();
        const recharge = db.rechargePlayerBalanceWithMoneyLogRow({ playerId: one, ownerUserId: owner, amount: 1 });
        await bounded(playerLocked.promise);
        const patch = cache.updateAccountForUser(owner, one, { currency: "USDT" });
        operations = Promise.allSettled([recharge, patch]);
        await bounded((async () => {
          for (;;) {
            if (profileHeld) return;
            if (patchPid && (await query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [patchPid])).rows[0]?.wait_event_type === "Lock") return;
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        })());
        release.resolve(); const outcomes = await bounded(operations);
        assert.equal(outcomes[0].status, "fulfilled");
        assert.equal(outcomes[0].value.ok, true, outcomes[0].value.msg);
        assert.equal(outcomes[1].status, "fulfilled", outcomes[1].reason?.message);
        assert.equal(await balance(), before + 1);
        assert.equal(Number((await query("SELECT count(*) FROM money_logs WHERE user_id=$1 AND player_id=$2", [owner, one])).rows[0].count), 1);
      }
      finally { release.resolve(); if (operations) await operations; restore(); }
    });

    await check("S2/reverse: recharge waits before locking players when ACCOUNT already owns the profile", async () => {
      const ownerLocked = gate(), release = gate(), rechargeStarted = gate(); let held = false, rechargePid;
      const restore = await instrument(async (client, raw, args) => {
        const sql = String(args[0]);
        if (sql.includes("FROM profiles") && sql.includes("FOR KEY SHARE")) {
          rechargePid = client.processID; rechargeStarted.resolve();
        }
        const result = await raw(...args);
        if (!held && sql.includes("SELECT id FROM profiles") && sql.includes("FOR UPDATE")) {
          held = true; ownerLocked.resolve(); await release.promise;
        }
        return result;
      });
      let operations;
      try {
        const before = await balance();
        const patch = cache.updateAccountForUser(owner, one, { reverseMarker: true });
        await bounded(ownerLocked.promise);
        const recharge = db.rechargePlayerBalanceWithMoneyLogRow({ playerId: one, ownerUserId: owner, amount: 2 });
        operations = Promise.all([patch, recharge]);
        await bounded(rechargeStarted.promise);
        await bounded((async () => {
          while ((await query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [rechargePid])).rows[0]?.wait_event_type !== "Lock")
            await new Promise(resolve => setTimeout(resolve, 5));
        })());
        release.resolve(); const [, result] = await operations;
        assert.equal(result.ok, true, result.msg);
        assert.equal(await balance(), before + 2);
      }
      finally { release.resolve(); if (operations) await operations; restore(); }
    });

    await check("S2/atomicity: concurrent recharges add once each; a failed log insert rolls back the amount", async () => {
      const before = await balance();
      const outcomes = await Promise.all(Array.from({ length: 4 }, () =>
        db.rechargePlayerBalanceWithMoneyLogRow({ playerId: one, ownerUserId: owner, amount: 1 })));
      assert(outcomes.every(row => row.ok));
      assert.equal(await balance(), before + 4);
      const count = async () => Number((await query("SELECT count(*) FROM money_logs WHERE user_id=$1", [owner])).rows[0].count);
      const logs = await count();
      const restore = await instrument(async (_client, raw, args) => {
        if (String(args[0]).includes("INSERT INTO money_logs")) throw new Error("injected log failure");
        return raw(...args);
      });
      try {
        const failed = await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: one, ownerUserId: owner, amount: 9 });
        assert.equal(failed.ok, false);
        assert.equal(await balance(), before + 4);
        assert.equal(await count(), logs);
      }
      finally { restore(); }
      assert.equal((await db.rechargePlayerBalanceWithMoneyLogRow({ playerId: one, ownerUserId: owner, amount: 1 })).ok, true);
    });

    await check("S2/create: full replacement keeps the profile lock and cannot prune a concurrent new account", async () => {
      const ownerLocked = gate(), release = gate(); let held = false;
      const restore = await instrument(async (_client, raw, args) => {
        const result = await raw(...args);
        if (!held && String(args[0]).includes("SELECT id FROM profiles") && String(args[0]).includes("FOR UPDATE")) {
          held = true; ownerLocked.resolve(); await release.promise;
        }
        return result;
      });
      let saving, creating;
      const creator = await pool.connect();
      try {
        const current = await db.fetchAccountRecordsByOwnerStrict(owner);
        saving = cache.saveAccountsTransactionForUser(owner, current, ({ existing }) => existing);
        await bounded(ownerLocked.promise);
        creating = creator.query(`INSERT INTO players(platform_id,owner_user_id,provider,player_name,created_at,updated_at)
          VALUES($1,$2,'OB','created-concurrently',1,1) RETURNING id`, [tag, owner]);
        await bounded((async () => {
          while ((await query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [creator.processID])).rows[0]?.wait_event_type !== "Lock")
            await new Promise(resolve => setTimeout(resolve, 5));
        })());
        release.resolve(); await saving;
        const created = (await creating).rows[0].id;
        assert.equal((await query("SELECT deleted_at FROM players WHERE id=$1", [created])).rows[0].deleted_at, null);
      }
      finally { release.resolve(); await Promise.allSettled([saving, creating].filter(Boolean)); creator.release(); restore(); }
    });

    await check("S3: delayed committed snapshot cannot resurrect a deleted account in cache", async () => {
      await cache.loadAccountsForUserStrict(owner);
      const committed = gate(), release = gate(); let held = false;
      const restore = await instrument(async (_client, raw, args) => {
        const result = await raw(...args);
        if (!held && args[0] === "COMMIT") { held = true; committed.resolve(); await release.promise; }
        return result;
      });
      let patch;
      try {
        patch = cache.updateAccountForUser(owner, one, { concurrencyMarker: true });
        await bounded(committed.promise);
        assert.equal((await account.handleDeletePlayer({ playerId: one, description: "concurrency regression" }, owner)).ok, true);
        assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === one), false);
        release.resolve(); assert.equal(await patch, null);
        assert.equal(cache.listAccountsForUser(owner).some(row => row.accountId === one), false);
        assert((await query("SELECT deleted_at FROM players WHERE id=$1", [one])).rows[0].deleted_at);
      }
      finally { release.resolve(); if (patch) await patch; restore(); }
    });
    console.log(JSON.stringify({ passed: passed.length === 7, localOnly: true, checks: passed.length, cases: passed }, null, 2));
  }
  finally { await pool.end(); }
});
