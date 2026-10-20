import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
await withTemporaryPostgres(async () => {
  const db = await import("../../rds/index.js");
  const cache = await import("../../server/backend/core/db/store.js");
  const account = await import("../../server/backend/core/account/account_service.js");
  const api = (await import("../../server/backend/core/esport-api/store.js")).default;
  const pool = db.getPgPool(); const checks = [];
  const query = pool.query.bind(pool);
  async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
  try {
    const connection = await pool.connect();
    try { await applyRdsSchema(connection); } finally { connection.release(); }
    const owner = randomUUID(), other = randomUUID();
    for (const id of [owner, other]) {
      await query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic',1,1)", [id, id]);
      await query(`INSERT INTO profiles(id,user_name,betting_config,created_at,updated_at)
        VALUES($1,$2,'{"base":1}',1,1) ON CONFLICT(id) DO UPDATE SET betting_config='{"base":1}'`, [id, id]);
    }
    const tag = (await query("INSERT INTO tag_platforms(name,created_at) VALUES('review-fix',1) RETURNING id")).rows[0].id;
    async function createPlayer(uid, name, provider = "OB") {
      return Number((await query(`INSERT INTO players(platform_id,provider,owner_user_id,player_name,total_balance,account_data,created_at,updated_at)
        VALUES($1,$2,$3,$4,0,'{"token":"old"}',1,1) RETURNING id`, [tag, provider, uid, name])).rows[0].id);
    }
    const one = await createPlayer(owner, "one"), two = await createPlayer(owner, "two");
    const foreign = await createPlayer(other, "foreign");
    const row = id => ({ accountId: id, provider: "OB", platformId: Number(tag), playerName: `p${id}`, token: "old", balance: 0 });
    const stored = async id => (await query("SELECT account_data,total_balance,deleted_at FROM players WHERE id=$1", [id])).rows[0];
    await check("default batch rolls back all existing rows when one requested row is missing", async () => {
      await assert.rejects(db.saveAccountRecordsForOwner(owner, [{ ...row(one), token: "partial" }, row(99999999)]), /未全部确认/);
      assert.equal((await stored(one)).account_data.token, "old");
    });
    await cache.loadAccountsForUserStrict(owner);
    await check("A8 full ACCOUNT save preserves the newer confirmed balance and still accepts changed config", async () => {
      const wire = cache.listAccountsForUser(owner).map(row => ({ ...row }));
      await db.updatePlayerBalanceRow(one, 123, owner);
      assert.equal((await account.handleSaveAccounts(wire, owner)).ok, true);
      assert.equal((await stored(one)).total_balance, 123);
      wire[0].token = "new-credential";
      assert.equal((await account.handleSaveAccounts(wire, owner)).ok, true);
      assert.equal((await stored(one)).total_balance, 123);
      assert.equal((await stored(one)).account_data.token, "new-credential");
      assert.equal(cache.listAccountsForUser(owner).find(row => row.accountId === one).balance, 123);
    });
    await check("unchanged ACCOUNT still validates ownership but avoids a redundant player UPDATE", async () => {
      await query(`CREATE FUNCTION review_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected UPDATE'; END $$;
        CREATE TRIGGER review_reject_update BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION review_reject_update()`);
      try {
        assert.equal((await account.handleSaveAccounts(cache.listAccountsForUser(owner), owner)).ok, true);
        await assert.rejects(account.handleSaveAccounts(cache.listAccountsForUser(owner).map(row => ({ ...row, playerName: "changed" })), owner), /unexpected UPDATE/);
      }
      finally { await query("DROP TRIGGER review_reject_update ON players; DROP FUNCTION review_reject_update()"); }
    });
    await check("concurrent partial edits read current rows inside the lock and preserve both updates", async () => {
      await Promise.all([
        cache.updateAccountForUser(owner, one, { token: "first-token" }),
        cache.updateAccountForUser(owner, two, { token: "second-token" }),
      ]);
      assert.equal((await stored(one)).account_data.token, "first-token");
      assert.equal((await stored(two)).account_data.token, "second-token");
      assert.equal((await stored(one)).deleted_at, null); assert.equal((await stored(two)).deleted_at, null);
      assert.equal(await cache.updateAccountForUser(owner, foreign, { token: "forged" }), null);
      assert.equal((await stored(foreign)).account_data.token, "old");
    });
    await check("legacy DB partial-patch entry also serializes concurrent changes to the same record", async () => {
      await Promise.all([
        db.patchPlayerAccountRecord(owner, one, { currency: "USDT" }),
        db.patchPlayerAccountRecord(owner, one, { reviewMarker: "kept" }),
      ]);
      const data = (await stored(one)).account_data;
      assert.equal(data.currency, "USDT"); assert.equal(data.reviewMarker, "kept");
    });
    await check("concurrent actual sport-account requests preserve each credential and the esport token", async () => {
      const sport = id => ({ accountId: id, token: `abcdef0123456789${id}`, gateway: "https://synthetic.invalid", venueMemberId: "1234567890123456789", venueAccountName: `sport${id}` });
      const results = await Promise.all([account.handleSaveSportAccount(sport(one), owner), account.handleSaveSportAccount(sport(two), owner)]);
      assert(results.every(result => result.ok));
      assert.equal((await stored(one)).account_data.sportOb.token, sport(one).token);
      assert.equal((await stored(two)).account_data.sportOb.token, sport(two).token);
      assert.equal((await stored(one)).account_data.token, "first-token");
    });
    await check("failed partial edit rolls back, keeps the cache, and does not poison the next edit", async () => {
      const before = cache.listAccountsForUser(owner);
      await query(`CREATE FUNCTION review_fail_patch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.account_data->>'token'='reject' THEN RAISE EXCEPTION 'patch rejected'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER review_fail_patch BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION review_fail_patch()`);
      try {
        await assert.rejects(cache.updateAccountForUser(owner, one, { token: "reject" }), /patch rejected/);
        assert.deepEqual(cache.listAccountsForUser(owner), before);
        await cache.updateAccountForUser(owner, two, { token: "after-failure" });
      }
      finally { await query("DROP TRIGGER review_fail_patch ON players; DROP FUNCTION review_fail_patch()"); }
      assert.equal((await stored(one)).account_data.token, "first-token");
      assert.equal((await stored(two)).account_data.token, "after-failure");
    });
    await check("a partial edit never UPDATEs unrelated player rows", async () => {
      await query(`CREATE FUNCTION review_no_unrelated_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id=${two} THEN RAISE EXCEPTION 'unrelated player touched'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER review_no_unrelated_update BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION review_no_unrelated_update()`);
      try { await cache.updateAccountForUser(owner, one, { currency: "USDT" }); }
      finally { await query("DROP TRIGGER review_no_unrelated_update ON players; DROP FUNCTION review_no_unrelated_update()"); }
    });
    await check("older profile read finishes before a queued commit and cannot erase its fields", async () => {
      const entered = deferred(), release = deferred(); let hold = true;
      pool.query = async (...args) => {
        const result = await query(...args);
        if (hold && typeof args[0] === "string" && args[0].includes("SELECT p.*") && args[0].includes("WHERE p.id")) {
          hold = false; entered.resolve(); await release.promise;
        }
        return result;
      };
      try {
        const loading = cache.loadProfileById(owner); await entered.promise;
        const saving = cache.updateProfileSetting(owner, { saved: 2 });
        release.resolve(); await Promise.all([loading, saving]);
        await cache.updateProfileSetting(owner, { next: 3 });
        assert.deepEqual(cache.getProfileById(owner).setting, { base: 1, saved: 2, next: 3 });
        assert.deepEqual((await query("SELECT betting_config FROM profiles WHERE id=$1", [owner])).rows[0].betting_config, { base: 1, saved: 2, next: 3 });
      }
      finally { release.resolve(); pool.query = query; }
    });
    await check("cold list outage fails instead of returning successful empty, then recovers to confirmed empty", async () => {
      pool.query = async (...args) => {
        if (typeof args[0] === "string" && args[0].includes("client_matches")) throw Error("review injected outage");
        return query(...args);
      };
      try { await assert.rejects(api.buildMatchList(), /赛事列表暂不可用/); }
      finally { pool.query = query; }
      assert.deepEqual(await api.buildMatchList(), []);
    });
    await check("empty and foreign ACCOUNT saves remain rejected; explicit removal still prunes", async () => {
      assert.equal((await account.handleSaveAccounts([], owner)).ok, false);
      assert.equal((await account.handleSaveAccounts([row(foreign)], owner)).ok, false);
      assert.equal((await account.handleSaveAccounts(cache.listAccountsForUser(owner).filter(row => row.accountId === one), owner)).ok, true);
      assert((await stored(two)).deleted_at);
    });
    await check("partial PF edit publishes SQL-protected balance instead of an uncommitted planned balance", async () => {
      const pf = await createPlayer(other, "pf", "PredictFun");
      await db.updatePlayerBalanceRow(pf, 50, other);
      const edited = await cache.updateAccountForUser(other, pf, { balance: 1, currency: "USDT" });
      assert.equal((await stored(pf)).total_balance, 50);
      assert.equal(edited.balance, 50);
    });
    console.log(JSON.stringify({ passed: true, localOnly: true, checks: checks.length, cases: checks }, null, 2));
  }
  finally { pool.query = query; await pool.end(); }
});
