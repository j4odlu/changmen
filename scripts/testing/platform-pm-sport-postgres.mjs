import assert from "node:assert/strict";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { maintainPlatformPmSportSchema } from "../../rds/maintenance/platform-pm-sport-schema.mjs";
import { inheritPlatformPmSports } from "../../rds/rds/platform_pm_sport.js";

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

    await pool.query(`ALTER TABLE client_matches
      ADD PRIMARY KEY(id), ADD COLUMN merge_key text, ADD COLUMN title text, ADD COLUMN game text,
      ADD COLUMN game_id text, ADD COLUMN start_time bigint, ADD COLUMN bo integer, ADD COLUMN round integer,
      ADD COLUMN round_start bigint, ADD COLUMN matchs jsonb, ADD COLUMN bets jsonb, ADD COLUMN reverse jsonb,
      ADD COLUMN built_at bigint, ADD COLUMN pm_sport jsonb,
      ADD COLUMN home_gb_team_id bigint, ADD COLUMN away_gb_team_id bigint`);
    const match = (id, matchs = { Polymarket: "pm1", OB: "ob1" }) => ({
      id, matchs, title: "Alpha vs Beta", game: "basketball", built_at: 1000,
      reverse: ["Polymarket"], bets: [{ fixture: true }],
    });
    const stored = async id => (await pool.query("SELECT * FROM client_matches WHERE id=$1", [id])).rows[0];
    const original = await read("pm1");
    // PM 状态先到，尚未匹配；合场提交后不需要再等下一条 WS / Gamma。
    await db.writeClientMatchesAsync({ activeRows: [match(100)], builtAt: 1000 });
    assert.deepEqual((await stored(100)).pm_sport, original);
    assert.deepEqual((await stored(100)).reverse, ["Polymarket"]);
    assert.deepEqual((await stored(100)).bets, [{ fixture: true }]);
    assert.equal((await stored(100)).ended_at, null);
    assert.equal((await pool.query("SELECT match_id FROM platform_matches WHERE platform='Polymarket' AND source_match_id='pm1'")).rows[0].match_id, null);
    // 已存在但缺状态的合场、只标结束的老合场和本拍新建的结束行都补齐。
    await pool.query("UPDATE client_matches SET pm_sport=NULL WHERE id=100");
    await db.writeClientMatchesAsync({ activeRows: [match(100)], builtAt: 1001 });
    assert.deepEqual((await stored(100)).pm_sport, original);
    await pool.query("UPDATE client_matches SET pm_sport=NULL WHERE id=100");
    await db.writeClientMatchesAsync({ markEndedIds: [100], builtAt: 1002 });
    assert.deepEqual((await stored(100)).pm_sport, original);
    assert.equal((await stored(100)).ended_at, "1002");
    await db.writeClientMatchesAsync({ endedRows: [{ ...match(101), ended_at: 1003 }], builtAt: 1003 });
    assert.deepEqual((await stored(101)).pm_sport, original);
    assert.equal((await stored(101)).ended_at, "1003");
    // 已有状态（包括 legacy / Gamma）一律保留，承接不改变原有来源优先级。
    for (const [index, existing] of [state("pm1", "ws", 500, "Final"), state("pm1", "gamma", 500),
      { eventId: "pm1", status: "Final", ended: true }].entries()) {
      const row = match(110 + index);
      await db.writeClientMatchesAsync({ activeRows: [{ ...row, pm_sport: existing }], builtAt: 1100 });
      await db.writeClientMatchesAsync({ activeRows: [row], builtAt: 1101 });
      assert.deepEqual((await stored(row.id)).pm_sport, existing);
    }
    // 精确身份、有效状态；没有快照时不猜未开赛，也不串到其他平台或比赛。
    await pool.query(`INSERT INTO platform_matches(platform,source_match_id,pm_sport) VALUES
      ('Polymarket','mismatched','{"eventId":"pm1","status":"Final"}'),
      ('Polymarket','empty','{"eventId":"empty","live":false,"ended":false}'),
      ('Polymarket','gamma','{"eventId":"gamma","source":"gamma","status":"Scheduled","updatedAt":17}')`);
    await db.writeClientMatchesAsync({ activeRows: [
      match(120, { Polymarket: "mismatched" }), match(121, { Polymarket: "empty" }),
      match(122, { Polymarket: "absent" }), match(123, { OB: "pm1" }),
      match(124, { Polymarket: "gamma" }),
    ], builtAt: 1200 });
    for (const id of [120, 121, 122, 123]) assert.equal((await stored(id)).pm_sport, null);
    assert.deepEqual((await stored(124)).pm_sport, { eventId: "gamma", source: "gamma", status: "Scheduled", updatedAt: 17 });

    // CTE 已读到旧平台快照后，另一连接写入新 WS；UPDATE 必须重新检查空值。
    await pool.query("INSERT INTO client_matches(id,matchs) VALUES(130,'{\"Polymarket\":\"pm1\"}')");
    const writer = await pool.connect();
    const inheritor = await pool.connect();
    try {
      await writer.query("BEGIN");
      const newer = state("pm1", "ws", 900, "Final");
      await writer.query("UPDATE client_matches SET pm_sport=$2::jsonb WHERE id=$1", [130, JSON.stringify(newer)]);
      const pending = inheritPlatformPmSports(inheritor, [130]);
      // 等待继承语句确实被该行锁阻塞，避免把顺序执行误当作并发覆盖测试。
      const deadline = Date.now() + 5000;
      while (!(await pool.query("SELECT $1 = ANY(pg_blocking_pids($2)) AS blocked", [writer.processID, inheritor.processID])).rows[0].blocked) {
        assert.ok(Date.now() < deadline, "inheritance did not reach the concurrent row lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await writer.query("COMMIT");
      assert.equal(await pending, 0);
      assert.deepEqual((await stored(130)).pm_sport, newer);
    } finally { await writer.query("ROLLBACK"); writer.release(); inheritor.release(); }

    // 继承和合场同事务，回滚时不能遗留半次状态或发布时间。
    const transaction = await pool.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("INSERT INTO client_matches(id,matchs) VALUES(140,'{\"Polymarket\":\"pm1\"}')");
      assert.equal(await inheritPlatformPmSports(transaction, [140]), 1);
      await transaction.query("ROLLBACK");
      assert.equal(await stored(140), undefined);
    } finally { transaction.release(); }
    // 滚动维护前不存在平台状态列时，合场仍能成功，不自动维护 schema。
    await pool.query("ALTER TABLE platform_matches DROP COLUMN pm_sport");
    await db.writeClientMatchesAsync({ activeRows: [match(150)], builtAt: 1500 });
    assert.equal((await stored(150)).pm_sport, null);
    console.log("PM late matching: active/ended inheritance, exact identity, original snapshots, existing/concurrent WS preservation, rollback and pre-maintenance schema verified.");
  }
  finally { await pool.end(); }
});
