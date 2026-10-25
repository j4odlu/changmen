import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { applyRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";
import { dropCurrentResultColumn } from "../../rds/maintenance/drop-client-match-current-result.mjs";

await withTemporaryPostgres(async () => {
  const db = await import("../../rds/index.js");
  const cache = await import("../../rds/client_match_snapshot.js");
  const backend = await import("../../server/backend/core/db/store.js");
  const collector = (await import("../../server/backend/core/esport-api/store.js")).default;
  const matcher = await import("../../server/match/matcher/ops/rds_snapshot_cache.js");
  const runtime = await import("../../server/match/matcher/runtime_ports.js");
  const writer = await import("../../server/match/matcher/compose/io/write.js");
  const { installBackendMatcherRuntime } = await import("../../server/backend/core/matcher/runtime.js");
  const pool = db.getPgPool();
  const checks = [];
  async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
  try {
    const client = await pool.connect();
    try {
      await applyRdsSchema(client);
      await client.query("ALTER TABLE client_matches ADD COLUMN current_result jsonb");
      assert.equal((await dropCurrentResultColumn(client)).exists, true);
      assert.equal((await dropCurrentResultColumn(client, { apply: true })).removed, true);
      assert.equal((await dropCurrentResultColumn(client, { apply: true })).removed, false);
    } finally { client.release(); }
    const version = (await pool.query("SHOW server_version")).rows[0].server_version;
    const row = id => ({ id, title: `Home${id} vs Away${id}`, game: "cs2", game_id: "1",
      start_time: 1700000000000, round_start: 0, bo: 3, round: 0, reverse: ["OB"],
      matchs: { OB: `ob${id}` }, bets: [], home_gb_team_id: 11, away_gb_team_id: 12, built_at: 100 });
    async function lists() {
      const wire = await backend.loadClientMatchesFromDb();
      const snapshot = await matcher.fetchMatcherRdsSnapshot();
      assert.equal(snapshot.clientMatchVersion, backend.getMemoryCacheStats().clientMatchesCacheKey);
      assert.deepEqual((wire || []).map(m => m.ID).sort(), snapshot.clientRows.map(m => Number(m.id)).sort());
      return { wire: wire || [], snapshot };
    }
    await check("confirmed empty list shares the same version across backend and standalone matcher", async () => {
      const { wire, snapshot } = await lists(); assert.deepEqual(wire, []); assert.deepEqual(snapshot.clientRows, []);
      assert.equal(snapshot.clientMatchVersion, (await db.fetchClientMatchesMeta()).version);
    });
    await db.writeClientMatchesAsync({ activeRows: [row(1), row(2)], builtAt: 100 });
    await check("one-statement rows and version retain native bigint strings and full matcher fields", async () => {
      const snapshot = await db.fetchClientMatches({ snapshot: true });
      assert.equal(snapshot.version, (await db.fetchClientMatchesMeta()).version);
      assert.equal(typeof snapshot.rows[0].id, "string");
      assert.equal(typeof snapshot.rows[0].home_gb_team_id, "string");
      assert.equal(snapshot.rows[0].home_gb_team_id, "11");
      assert.equal(snapshot.rows[0].row_revision, undefined);
      assert.deepEqual(snapshot.rows, await db.fetchClientMatches());
      const { wire } = await lists(); assert.deepEqual(wire[0].Reverse, ["OB"]);
    });
    await check("same-count and same-builtAt committed reversal invalidates the shared snapshot", async () => {
      const before = cache.getClientMatchSnapshotStats().version;
      await pool.query("UPDATE client_matches SET reverse='[]'::jsonb WHERE id=1");
      const meta = await db.fetchClientMatchesMeta(); assert.equal(meta.count, 2); assert.equal(meta.builtAt, 100);
      assert.notEqual(meta.version, before);
      const { wire, snapshot } = await lists();
      assert.deepEqual(wire.find(m => m.ID === 1).Reverse, []);
      assert.deepEqual(snapshot.clientRows.find(m => m.id === "1").reverse, []);
    });
    await check("PM update below the global maximum timestamp still refreshes both consumers", async () => {
      await pool.query(`UPDATE client_matches SET pm_sport=jsonb_build_object('updatedAt',CASE id WHEN 1 THEN 50 ELSE 100 END,'ended',false)`);
      const before = await lists();
      await pool.query(`UPDATE client_matches SET pm_sport='{"updatedAt":75,"ended":true,"slug":"pm1"}' WHERE id=1`);
      assert.equal((await db.fetchClientMatchesMeta()).pmSportRev, 100);
      const { wire, snapshot } = await lists();
      assert.notEqual(snapshot.clientMatchVersion, before.snapshot.clientMatchVersion);
      assert.equal(wire.find(m => m.ID === 1).PmSport.ended, true);
      assert.equal(snapshot.clientRows.find(m => m.id === "1").pm_sport.ended, true);
    });
    await check("embedded matcher uses the same PM and identity rows as standalone", async () => {
      const standalone = await lists();
      collector.hydrateCollectorHotSnapshot({ matchesRaw: { OB: [{ SourceMatchID: "hot-only", Home: "A" }] } });
      runtime.setEmbeddedMatcher(true);
      const embedded = await lists();
      assert.deepEqual(embedded.snapshot.clientRows, standalone.snapshot.clientRows);
      assert.equal(embedded.snapshot.matchesRaw.OB, undefined); // never resurrect a hot-only source
    });
    await check("successful writer publishes once after commit and preserves independently updated PM fields", async () => {
      const calls = [];
      runtime.configureMatcherRuntime({
        clientMatchesCommitted: async () => {
          assert.equal((await db.fetchClientMatchRow(1, "id,built_at")).built_at, "200");
          await backend.loadClientMatchesFromDb(); calls.push("published");
        },
        patchCollectorMatchClientIds: rows => { assert.equal(rows.length, 1); calls.push("patched"); },
      });
      await writer.writeClientMatches([{ ID: 1, Title: "Home1 vs Away1", GameID: 1,
        Matchs: { OB: "ob1" }, Reverse: [], Bets: [] }], 200);
      assert.deepEqual(calls, ["published", "patched"]);
      const { wire, snapshot } = await lists();
      assert.equal(wire.find(m => m.ID === 1).PmSport.ended, true);
      assert.equal(snapshot.clientRows.find(m => m.id === "1").pm_sport.ended, true);
      assert.equal(wire.length, 2); // an absent compose row is not implicitly ended
    });
    await check("unended matches keep their associations and locked markets in ordinary fields on both consumers", async () => {
      const matchs = { OB: "ob1", RAY: "absent" };
      const bets = [{ ID: 4096, Map: 0, Sources: { OB: { BetID: "ob-market", HomeID: "", AwayID: "", HomeOdds: 0, AwayOdds: 0, Status: "Locked" } } }];
      await db.writeClientMatchesAsync({ activeRows: [{ ...row(1), matchs, bets }], builtAt: 201 });
      const { wire, snapshot } = await lists();
      assert.deepEqual(wire.find(m => m.ID === 1).Matchs, matchs);
      assert.deepEqual(snapshot.clientRows.find(m => Number(m.id) === 1).bets, bets);
      assert.deepEqual(wire.map(m => m.ID).sort((a, b) => a - b), [1, 2]);
      assert.equal((await db.fetchClientMatchRow(1, "ended_at")).ended_at, null);
    });
    await check("replacing a venue mapping locks its previous native options while preserving canonical orientation", async () => {
      const bets = [{ ID: 4096, Map: 0, HomeName: "Home1", AwayName: "Away1", Sources: {
        OB: { BetID: "ob-market", HomeID: "h", AwayID: "a", HomeOdds: 1.5, AwayOdds: 2.5,
          HomeMarketID: "hm", AwayMarketID: "am", Status: "Normal" } } }];
      await db.writeClientMatchesAsync({ activeRows: [{ ...row(1), bets }], builtAt: 202 });
      await db.patchClientMatchMatchs(1, { OB: "replacement" });
      const { wire, snapshot } = await lists();
      const replaced = wire.find(m => m.ID === 1);
      assert.equal(replaced.Title, "Home1 vs Away1");
      assert.equal(replaced.Bets[0].HomeName, "Home1");
      assert.equal(replaced.Bets[0].AwayName, "Away1");
      assert.equal(replaced.Bets[0].Sources.OB.HomeMarketID, "hm");
      assert.deepEqual(replaced.Bets, snapshot.clientRows.find(m => Number(m.id) === 1).bets);
      assert.equal(replaced.Matchs.OB, "replacement");
      assert.equal(replaced.Bets[0].Sources.OB.HomeID, "");
      assert.equal(replaced.Bets[0].Sources.OB.Status, "Locked");
    });
    await check("result update failure rolls back identity changes and neither publishes nor patches collector links", async () => {
      let calls = 0;
      runtime.configureMatcherRuntime({ clientMatchesCommitted: () => calls++, patchCollectorMatchClientIds: () => calls++ });
      const before = await db.fetchClientMatches({ snapshot: true });
      await pool.query(`CREATE FUNCTION phase2_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.title = 'uncommitted' THEN RAISE EXCEPTION 'phase2 injected write failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER phase2_reject BEFORE UPDATE ON client_matches FOR EACH ROW EXECUTE FUNCTION phase2_reject()`);
      try { await assert.rejects(writer.writeClientMatches([{ ID: 1, Title: "uncommitted" }], 300), /phase2 injected/); }
      finally { await pool.query("DROP TRIGGER phase2_reject ON client_matches; DROP FUNCTION phase2_reject()"); }
      assert.equal(calls, 0); assert.deepEqual(await db.fetchClientMatches({ snapshot: true }), before);
    });
    installBackendMatcherRuntime(collector);
    await check("sticky ended row cannot return through composer publication", async () => {
      await db.forceEndClientMatch(1); runtime.removeClientMatchFromMemory(1);
      matcher.invalidateMatcherRdsSnapshot(["clientMatches"]);
      assert.deepEqual((await lists()).wire.map(m => m.ID), [2]);
      await writer.writeClientMatches([{ ID: 1, Title: "must stay ended", Matchs: { OB: "ob1" } }], 400);
      assert.deepEqual((await lists()).wire.map(m => m.ID), [2]);
    });
    await check("composer identity and align share full lifecycle rows including ended and PM fields", async () => {
      const { loadSnapshot } = await import("../../server/match/matcher/compose/io/snapshot.js");
      const lifecycle = await loadSnapshot({ registerTeams: false });
      assert.equal(lifecycle.clientRows, lifecycle.alignClientRows);
      assert.equal(lifecycle.clientMatchSnapshotScope, "all");
      const ended = lifecycle.clientRows.find(m => m.id === "1");
      assert(ended.ended_at); assert.equal(ended.pm_sport.ended, true);
      assert.equal(lifecycle.clientMatchSnapshotVersion, (await db.fetchClientMatchesAll({ snapshot: true })).version);
    });
    await check("manual restore locks old markets and retains identity while clearing only the end state", async () => {
      const before = await db.fetchClientMatchRow(1, "id,matchs,bets,reverse");
      await db.clearClientMatchEndedAt(1);
      assert.deepEqual((await lists()).wire.map(m => m.ID).sort((a, b) => a - b), [1, 2]);
      const after = await db.fetchClientMatchRow(1, "id,matchs,bets,reverse,ended_at");
      assert.deepEqual({ id: after.id, matchs: after.matchs, bets: after.bets, reverse: after.reverse }, before);
      assert.equal(after.ended_at, null);
    });
    await check("deletion down to empty clears backend and matcher caches", async () => {
      await pool.query("DELETE FROM client_matches");
      const { wire, snapshot } = await lists(); assert.deepEqual(wire, []); assert.deepEqual(snapshot.clientRows, []);
    });
    await check("a fresh process reloads the same committed snapshot without backend hydration", async () => {
      await db.writeClientMatchesAsync({ activeRows: [row(9)], builtAt: 500 });
      const expected = await cache.loadClientMatchSnapshot();
      const script = `const { loadClientMatchSnapshot } = await import('./rds/client_match_snapshot.js');
        const { getPgPool } = await import('./rds/pg_pool.js');
        try { console.log('SNAPSHOT=' + JSON.stringify(await loadClientMatchSnapshot())); } finally { await getPgPool()?.end(); }`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      const line = result.stdout.split(/\r?\n/).find(line => line.startsWith("SNAPSHOT="));
      assert.deepEqual(JSON.parse(line.slice(9)), expected);
    });
    await check("assembled matcher HTTP API rejects unauthenticated local requests", async () => {
      installBackendMatcherRuntime(collector);
      const { createMatcherApiApp } = await import("../../server/match/matcher/ui/create_matcher_api_app.js");
      const server = createServer(createMatcherApiApp());
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/debug`);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", login: "/login" });
      }
      finally { await new Promise(resolve => server.close(resolve)); }
    });
    console.log(JSON.stringify({ passed: true, localOnly: true, postgres: version, checks: checks.length, cases: checks }, null, 2));
  }
  finally { runtime.configureMatcherRuntime(); runtime.setEmbeddedMatcher(false); await pool.end(); }
});
