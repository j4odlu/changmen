import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const canonicalId = value => value == null ? null : String(value);
function assertOldMap(row, expected) {
  for (const field of ["id", "gb_team_id", "venue_name", "game", "source", "confidence"])
    assert.equal(canonicalId(row[field]), canonicalId(expected[field]), `Mapping changed: ${row.venue_team_id}.${field}`);
}

/** One-time maintenance only; defaults to read-only and requires a durable backup before any write. */
export async function migratePolymarketOfficialTeamIds(client, plan, { apply = false, saveBackup } = {}) {
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.errors, [], "Resolve migration conflicts first");
  assert(!plan.unresolved.some(e => e.gbTeamId != null), "Recognized mappings remain unresolved");
  assert(plan.entries.length && plan.matches.length, "Empty migration plan");
  const oldIds = plan.entries.map(e => e.oldId), newIds = [...new Set(plan.entries.map(e => e.newId))];
  assert.equal(new Set(oldIds).size, oldIds.length, "Duplicate old IDs");
  assert(plan.entries.every(e => /^[1-9]\d*$/.test(e.newId) && !/^[1-9]\d*$/.test(e.oldId)), "Invalid ID transition");
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const { rows: maps } = await client.query(`SELECT * FROM team_venue_maps
      WHERE venue='Polymarket' AND venue_team_id=ANY($1::text[]) ORDER BY id${apply ? " FOR UPDATE" : ""}`, [[...oldIds, ...newIds]]);
    const { rows: matches } = await client.query(`SELECT * FROM platform_matches
      WHERE platform='Polymarket' ORDER BY source_match_id${apply ? " FOR UPDATE" : ""}`);
    const { rows: bets } = await client.query("SELECT * FROM platform_bets WHERE platform='Polymarket' ORDER BY source_match_id,source_bet_id");
    const byId = new Map(maps.map(m => [m.venue_team_id, m]));
    const groups = new Map();
    for (const entry of plan.entries) {
      const old = byId.get(entry.oldId), current = byId.get(entry.newId);
      if (old) assertOldMap(old, entry.expected);
      else assert(current, `Old mapping disappeared without an official replacement: ${entry.oldId}`);
      if (!groups.has(entry.newId)) groups.set(entry.newId, []);
      groups.get(entry.newId).push(entry);
    }
    const replacements = [];
    for (const [id, group] of groups) {
      const existing = byId.get(id);
      const expectedIds = new Set(group.map(e => canonicalId(e.expected.gb_team_id)).filter(Boolean));
      if (existing?.gb_team_id != null) expectedIds.add(String(existing.gb_team_id));
      assert(expectedIds.size <= 1, `Conflicting canonical mappings for official team ${id}`);
      const original = group.find(e => e.expected.gb_team_id != null)?.expected || group[0].expected;
      const metadata = existing?.gb_team_id != null || original.gb_team_id == null ? existing ?? original : original;
      replacements.push({ id, gb: [...expectedIds][0] ?? null, name: group[0].name,
        game: group[0].game, source: metadata.source, confidence: metadata.confidence });
    }
    const byMatch = new Map(plan.matches.map(m => [m.sourceMatchId, m]));
    assert.equal(byMatch.size, plan.matches.length, "Duplicate source matches");
    const updates = [];
    for (const match of matches) {
      const target = byMatch.get(match.source_match_id);
      assert(target, `New source match needs fresh evidence: ${match.source_match_id}`);
      assert.equal(match.source_game_id, target.game);
      for (const [i, side] of ["home", "away"].entries()) {
        const id = match[`${side}_id`];
        assert([target.before[`${side}_id`], target.teams[i].TeamID].includes(id), `Source identity changed: ${match.source_match_id}.${side}`);
      }
      const teams = target.teams.map((team, i) => ({ ...(match.teams?.[i] || {}), ...team }));
      updates.push({ id: match.source_match_id, home_id: teams[0].TeamID, away_id: teams[1].TeamID,
        home: teams[0].Name, away: teams[1].Name, teams });
    }
    const remove = maps.filter(m => oldIds.includes(m.venue_team_id));
    const legacyTargets = new Map(plan.entries.map(e => [e.oldId, e.newId]));
    const replacedTargets = new Set(remove.map(old => legacyTargets.get(old.venue_team_id)));
    const requiredTargets = replacements.filter(m => !byId.has(m.id) || replacedTargets.has(m.id));
    const changedSources = updates.filter(u => {
      const old = matches.find(m => m.source_match_id === u.id);
      return old.home_id !== u.home_id || old.away_id !== u.away_id || old.home !== u.home || old.away !== u.away
        || JSON.stringify(old.teams) !== JSON.stringify(u.teams);
    });
    let backup = null;
    if (apply && (remove.length || requiredTargets.length || changedSources.length)) {
      assert.equal(typeof saveBackup, "function", "Backup is required");
      const { rows: fks } = await client.query("SELECT conrelid::regclass::text AS relation FROM pg_constraint WHERE contype='f' AND confrelid='team_venue_maps'::regclass");
      assert.equal(fks.length, 0, "Mapping row IDs have dependent records");
      backup = await saveBackup({ createdAt: new Date().toISOString(), plan, mappings: maps, platformMatches: matches, platformBets: bets });
      assert(backup, "Backup path missing");
      await client.query("DELETE FROM team_venue_maps WHERE venue='Polymarket' AND id=ANY($1::bigint[])", [remove.map(r => r.id)]);
      await client.query(`INSERT INTO team_venue_maps(venue,venue_team_id,gb_team_id,venue_name,game,source,confidence)
        SELECT 'Polymarket',r.id,r.gb::bigint,r.name,r.game,r.source,r.confidence::numeric
        FROM jsonb_to_recordset($1::jsonb) AS r(id text,gb text,name text,game text,source text,confidence text)
        ON CONFLICT(venue,venue_team_id) DO UPDATE SET
          source=CASE WHEN team_venue_maps.gb_team_id IS NULL AND EXCLUDED.gb_team_id IS NOT NULL
            THEN EXCLUDED.source ELSE team_venue_maps.source END,
          confidence=CASE WHEN team_venue_maps.gb_team_id IS NULL AND EXCLUDED.gb_team_id IS NOT NULL
            THEN EXCLUDED.confidence ELSE team_venue_maps.confidence END,
          gb_team_id=COALESCE(team_venue_maps.gb_team_id,EXCLUDED.gb_team_id),
          venue_name=EXCLUDED.venue_name,game=EXCLUDED.game`, [JSON.stringify(requiredTargets)]);
      await client.query(`UPDATE platform_matches AS pm SET home_id=r.home_id,away_id=r.away_id,
        home=r.home,away=r.away,teams=r.teams FROM jsonb_to_recordset($1::jsonb)
        AS r(id text,home_id text,away_id text,home text,away text,teams jsonb)
        WHERE pm.platform='Polymarket' AND pm.source_match_id=r.id`, [JSON.stringify(changedSources)]);
      const { rows: afterBets } = await client.query("SELECT * FROM platform_bets WHERE platform='Polymarket' ORDER BY source_match_id,source_bet_id");
      assert.deepEqual(afterBets, bets, "Betting tokens/odds changed");
      const { rows: afterMatches } = await client.query("SELECT * FROM platform_matches WHERE platform='Polymarket' ORDER BY source_match_id");
      for (const before of matches) {
        const after = afterMatches.find(m => m.source_match_id === before.source_match_id);
        const target = updates.find(u => u.id === before.source_match_id);
        assert.deepEqual(after, { ...before, home_id: target.home_id, away_id: target.away_id,
          home: target.home, away: target.away, teams: target.teams }, "Unexpected source data change");
      }
      const { rows: afterMaps } = await client.query("SELECT * FROM team_venue_maps WHERE venue='Polymarket' AND venue_team_id=ANY($1::text[])", [newIds]);
      for (const replacement of replacements) {
        const after = afterMaps.find(m => m.venue_team_id === replacement.id);
        assert(after, `Missing official map: ${replacement.id}`);
        assert.equal(canonicalId(after.gb_team_id), replacement.gb, "Canonical binding changed");
      }
    }
    await client.query("COMMIT");
    return { readOnly: !apply, oldMappings: remove.length, officialMappings: replacements.length,
      mappedBindings: plan.entries.filter(e => e.expected.gb_team_id != null).length,
      sourceMatches: changedSources.length, unresolved: plan.unresolved.length, backup };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  const planArg = args.find(a => a.startsWith("--plan="));
  assert(planArg && args.every(a => a === "--apply" || a.startsWith("--plan=")), "Use --plan=/absolute/plan.json [--apply]");
  const plan = JSON.parse(await fs.readFile(path.resolve(planArg.slice(7)), "utf8"));
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady(), client = await pool.connect();
  try {
    const result = await migratePolymarketOfficialTeamIds(client, plan, { apply,
      saveBackup: async data => {
        const directory = fileURLToPath(new URL("../../output/pm-official-team-migration/", import.meta.url));
        await fs.mkdir(directory, { recursive: true });
        const file = path.join(directory, `backup-${Date.now()}.json`);
        await fs.writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600, flush: true });
        return file;
      } });
    console.log(JSON.stringify(result));
  } finally { client.release(); await pool.end(); }
}
