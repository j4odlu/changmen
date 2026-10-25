import assert from "node:assert/strict";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { maintainPlatformPmSportSchema } from "../../rds/maintenance/platform-pm-sport-schema.mjs";

await withTemporaryPostgres(async () => {
  const db = await import("@changmen/db");
  const pool = db.getPgPool();
  try {
    await pool.query(`CREATE TABLE platform_matches(
      platform text, source_match_id text, match_id bigint, source_game_id text, start_time bigint,
      home_id text, home text, away_id text, away text, bo smallint, is_live smallint,
      rot_num text, teams jsonb, synced_at bigint, PRIMARY KEY(platform, source_match_id));
      CREATE TABLE client_matches(id bigint, ended_at bigint)`);
    await pool.query(`INSERT INTO platform_matches(platform,source_match_id,match_id) VALUES
      ('Polymarket','pm1',NULL),('Polymarket','pm2',42),('OB','other',NULL),('OB','pm1',NULL);
      INSERT INTO client_matches VALUES(42,NULL)`);
    assert.equal((await db.fetchPlatformPmSports(["pm1"])).size, 0);
    const maintenance = await pool.connect();
    try {
      assert.equal((await maintainPlatformPmSportSchema(maintenance)).ready, false);
      assert.equal((await maintainPlatformPmSportSchema(maintenance, { apply: true })).added, true);
      assert.equal((await maintainPlatformPmSportSchema(maintenance, { apply: true })).added, false);
      assert.equal((await maintainPlatformPmSportSchema(maintenance)).readOnly, true);
    } finally { maintenance.release(); }
    assert.equal((await pool.query("SELECT to_regclass('public.pm_event_states') AS name")).rows[0].name, null);
    const state = (eventId, source, updatedAt, status = "running") => ({ eventId, source, updatedAt, status });
    const read = async id => (await db.fetchPlatformPmSports([id])).get(id);
    assert.equal(await db.writePlatformPmSports([state("pm1", "gamma", 200, "scheduled")]), 1);
    assert.equal((await read("pm1")).status, "scheduled");
    await db.writePlatformPmSports([state("pm1", "ws", 100)]);
    assert.equal((await read("pm1")).source, "ws");
    await db.writePlatformPmSports([state("pm1", "gamma", 300, "scheduled"), state("unknown", "ws", 1), state("other", "ws", 1)]);
    assert.equal((await read("pm1")).status, "running");
    assert.equal(await read("unknown"), undefined);
    assert.equal(await read("other"), undefined);
    await db.writePlatformPmSports([state("pm1", "ws", 90, "scheduled")]);
    assert.equal((await read("pm1")).updatedAt, 100);
    await db.writePlatformPmSports([state("pm1", "ws", 110, "finished")]);
    assert.equal((await read("pm1")).status, "finished");
    await Promise.all([
      db.writePlatformPmSports([state("pm2", "gamma", 400, "scheduled")]),
      db.writePlatformPmSports([state("pm2", "ws", 350)]),
    ]);
    assert.equal((await read("pm2")).source, "ws");
    // 普通采集只刷新赛事信息，不得清除状态列或覆盖既有匹配关联。
    await db.writePlatformMatchesAsync("Polymarket", ["pm1", "pm2"].map(id => ({
      SourceMatchID: id, SourceGameID: "cs2", StartTime: Date.now(), Home: "Alpha", Away: "Beta",
      HomeID: "a", AwayID: "b", Teams: [],
    })));
    assert.equal((await read("pm1")).status, "finished");
    assert.equal((await read("pm2")).source, "ws");
    assert.deepEqual((await pool.query("SELECT source_match_id,match_id FROM platform_matches WHERE platform='Polymarket' ORDER BY source_match_id")).rows,
      [{ source_match_id: "pm1", match_id: null }, { source_match_id: "pm2", match_id: "42" }]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM platform_matches WHERE platform='OB' AND pm_sport IS NOT NULL")).rows[0].n, 0);
    assert.deepEqual((await pool.query("SELECT * FROM client_matches")).rows, [{ id: "42", ended_at: null }]);
    console.log("PM platform status: isolated PostgreSQL persistence, WS priority, stale/concurrent writes, collector refresh and unchanged matching verified.");
  }
  finally { await pool.end(); }
});
