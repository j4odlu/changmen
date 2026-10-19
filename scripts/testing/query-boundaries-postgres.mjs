import assert from "node:assert/strict";
import { test } from "node:test";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";

await withTemporaryPostgres(async () => {
  process.env.DATABASE_POOL_MAX = "1";
  const db = await import("../../server/db/index.js");
  const { createValueSignalDashboardReader } = await import("../../server/db/value_signals.js");
  const { findSportRelayUserId } = await import("../../server/db/relay_identity.js");
  const { signJwt, JWT_ACCESS_TTL_SEC } = await import("../../server/db/jwt.js");
  const existingJwt = await import("../../server/db/rds/jwt.js");
  const pool = db.getPgPool();
  const read = () => createValueSignalDashboardReader()();
  try {
    const client = await pool.connect();
    try { await applyRdsSchema(client); } finally { client.release(); }
    await test("empty signal tables remain available with empty results", async () => {
      assert.deepEqual(await read(), { dbAvailable: true, signals: [], stats: [], platformDist: [] });
    });
    await pool.query("INSERT INTO value_signals(match_id,sharp_platform,soft_platform,soft_side,edge,status) SELECT n,'PB',CASE WHEN n<=70 THEN 'OB' ELSE 'IM' END,'Home',n::numeric/1000,'open' FROM generate_series(1,105) AS n");
    await pool.query("INSERT INTO value_signals(match_id,sharp_platform,soft_platform,soft_side,edge,status) VALUES (106,'PB','OB','Away',0.5,'closed'),(107,'PB','IM','Away',0.7,'closed')");
    await test("open signals retain descending order, top-100 limit and PostgreSQL field types", async () => {
      const result = await read(); assert.equal(result.dbAvailable, true); assert.equal(result.signals.length, 100);
      assert.equal(result.signals[0].edge, "0.10500"); assert.equal(result.signals[99].edge, "0.00600");
      assert.equal(typeof result.signals[0].id, "string"); assert.equal(typeof result.signals[0].match_id, "string");
      assert(result.signals.every(row => row.status === "open"));
    });
    await test("status aggregates include closed rows and retain numeric strings", async () => {
      assert.deepEqual((await read()).stats, [
        {status:"closed",count:2,avg_edge:"0.60000",max_edge:"0.70000"},
        {status:"open",count:105,avg_edge:"0.05300",max_edge:"0.10500"},
      ]);
    });
    await test("platform aggregates include all open rows beyond the signal page", async () => {
      assert.deepEqual((await read()).platformDist,[{soft_platform:"OB",count:70,avg_edge:"0.03550"},{soft_platform:"IM",count:35,avg_edge:"0.08800"}]);
    });
    await test("missing signal table retains unavailable fallback", async () => {
      await pool.query("ALTER TABLE value_signals RENAME TO value_signals_fixture_hidden");
      try { assert.deepEqual(await read(), {dbAvailable:false,signals:[],stats:[],platformDist:[]}); }
      finally { await pool.query("ALTER TABLE value_signals_fixture_hidden RENAME TO value_signals"); }
    });
    await test("other SQL failures still reject instead of looking empty", async () => {
      await pool.query("ALTER TABLE value_signals RENAME COLUMN edge TO fixture_edge");
      try { await assert.rejects(read(), error => error.code === "42703"); }
      finally { await pool.query("ALTER TABLE value_signals RENAME COLUMN fixture_edge TO edge"); }
    });
    await test("relay identity is empty when no profile exists", async () => { assert.equal(await findSportRelayUserId(), ""); });
    const small="00000000-0000-0000-0000-000000000001", large="00000000-0000-0000-0000-000000000002";
    for (const [id,name] of [[large,"synthetic_later"],[small,"synthetic_first"]]) {
      await pool.query("INSERT INTO users(id,user_name,password_hash,created_at,updated_at) VALUES($1,$2,'synthetic-not-a-login-hash',1,1)",[id,name]);
      await db.insertProfile(id,{user_name:name,accounts:[],preferences:{},betting_config:{},collect_config:{},created_at:1,updated_at:1});
    }
    await test("relay lookup keeps ascending profile ID selection independent of insertion order", async () => {
      assert.equal(await findSportRelayUserId(),small);
    });
    await test("new public signer is exactly the existing implementation", async () => {
      assert.equal(signJwt, existingJwt.signJwt);assert.equal(JWT_ACCESS_TTL_SEC,existingJwt.JWT_ACCESS_TTL_SEC);
      const token=signJwt({sub:small,typ:"access",session_id:"sport-predictfun-fetch"},"synthetic-secret",120);
      const claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url"));
      assert.equal(claims.sub,small);assert.equal(claims.session_id,"sport-predictfun-fetch");assert.equal(claims.exp-claims.iat,120);
    });
    await test("both ports work in a read-only transaction without altering rows", async () => {
      await pool.query("BEGIN READ ONLY");
      try {
        assert.equal((await pool.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
        assert.equal((await read()).stats.find(row=>row.status==="open").count,105);
        assert.equal(await findSportRelayUserId(),small);
      } finally { await pool.query("ROLLBACK"); }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM value_signals")).rows[0].n,107);
    });
    await test("relay identity SQL errors propagate to the caller's existing fallback", async () => {
      await pool.query("ALTER TABLE profiles RENAME TO profiles_fixture_hidden");
      try { await assert.rejects(findSportRelayUserId(),error=>error.code==="42P01"); }
      finally { await pool.query("ALTER TABLE profiles_fixture_hidden RENAME TO profiles"); }
    });
  } finally { await pool.end(); }
});
