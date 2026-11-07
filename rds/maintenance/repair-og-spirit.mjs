/** [changmen 扩展] 拆开误归入 CS2 Spirit 的 OG 映射；默认只读，不进入启动或部署。 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVenueTeamIdColumn } from "../rds/team_venue_maps_cols.js";

const SPIRIT = "100215", OG = "100931";
const ogIds = new Map([
  ["PredictFun", "cs2:og"], ["OB", "296331008519292"], ["RAY", "21646168"],
  ["PB", "og@cs2"], ["IA", "16009"], ["Polymarket", "176470"],
]);
const isOg = name => /^(?:team\s+)?og$/i.test(String(name || "").trim());

export function planOgMatchRepair(row) {
  if (String(row.game_id) !== "3") return null;
  const parts = String(row.title || "").split(/\s+vs\s+/i);
  const pmNames = [row.pm_sport?.homeTeam, row.pm_sport?.awayTeam];
  if (!pmNames.some(isOg)) return null;
  assert.equal(pmNames.filter(isOg).length, 1, `Ambiguous OG sides: ${row.id}`);
  assert(row.matchs?.Polymarket, `Missing PM binding: ${row.id}`);
  // PM 原始槽位按已生效 reverse 投影，不假设平台主客等于系统主客。
  if ((row.reverse || []).includes("Polymarket")) pmNames.reverse();
  const side = isOg(pmNames[0]) ? "home" : "away";
  const column = `${side}_gb_team_id`;
  const oldIdentity = String(row[column]) === SPIRIT;
  if (!oldIdentity && String(row[column]) !== OG) return null;
  assert.equal(parts.length, 2, `Invalid title: ${row.id}`);
  const index = side === "home" ? 0 : 1;
  assert(oldIdentity ? /^(?:team\s+)?spirit$/i.test(parts[index].trim()) : isOg(parts[index]), `Unexpected title side: ${row.id}`);
  parts[index] = "OG";
  const home = side === "home" ? OG : String(row.home_gb_team_id);
  const away = side === "away" ? OG : String(row.away_gb_team_id);
  assert(home && away && home !== away, `Invalid team pair: ${row.id}`);
  let mergeKey = row.merge_key;
  if (String(mergeKey || "").startsWith("match:id:3:")) {
    assert(/^match:id:3:\d+:\d+(?:@ended:\d+)?$/.test(mergeKey), `Unexpected key: ${row.id}`);
    const pair = [home, away].sort((a, b) => Number(a) - Number(b));
    mergeKey = `match:id:3:${pair.join(":")}${mergeKey.match(/@ended:\d+$/)?.[0] || ""}`;
  }
  assert(Array.isArray(row.bets), `Invalid bets: ${row.id}`);
  const betName = side === "home" ? "HomeName" : "AwayName";
  const bets = row.bets.map(bet => {
    if (!/^(?:team\s+)?spirit$/i.test(String(bet[betName] || "").trim())) return bet;
    return { ...bet, [betName]: "OG" };
  });
  // 映射修复前已在途的 composer 可能只把旧 merge_key 写回来；重跑时也收敛该情况。
  if (!oldIdentity && mergeKey === row.merge_key) return null;
  return { id: row.id, title: parts.join(" vs "), merge_key: mergeKey,
    home_gb_team_id: home, away_gb_team_id: away, bets };
}

export function planEndedKeyRepairs(patches, occupied) {
  const byKey = new Map(patches.map(p => [p.merge_key, p]));
  assert.equal(byKey.size, patches.length, "Duplicate proposed merge keys");
  return occupied.filter(row => String(byKey.get(row.merge_key)?.id) !== String(row.id)).map(row => {
    assert(row.ended_at != null, `Active match already owns target key: ${row.id}`);
    assert(!String(row.merge_key).includes("@ended:"), `Archived key collision: ${row.id}`);
    const patch = byKey.get(row.merge_key);
    assert.deepEqual([String(row.home_gb_team_id), String(row.away_gb_team_id)].sort(),
      [patch.home_gb_team_id, patch.away_gb_team_id].sort(), `Different team pair: ${row.id}`);
    return { id: row.id, merge_key: `${row.merge_key}@ended:${row.id}` };
  });
}

export async function repairOgSpirit(client, { apply = false, saveBackup } = {}) {
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    // 在一次事务内备份、改映射和比赛，阻止同时写入产生半修复状态。
    if (apply) await client.query("LOCK TABLE canonical_teams, team_venue_maps, client_matches IN SHARE ROW EXCLUSIVE MODE");
    const pidCol = await resolveVenueTeamIdColumn(client);
    const { rows: teams } = await client.query("SELECT * FROM canonical_teams WHERE gb_team_id=ANY($1::bigint[]) ORDER BY id", [[SPIRIT, OG]]);
    for (const [id, name] of [[SPIRIT, "Team Spirit"], [OG, "OG"]]) {
      const team = teams.filter(t => String(t.gb_team_id) === id);
      assert.equal(team.length, 1, `Missing/duplicate canonical: ${id}`);
      assert.equal(team[0].game, "cs2");
      assert.equal(team[0].name, name);
    }
    const { rows: maps } = await client.query(`SELECT *, ${pidCol} AS repair_team_id FROM team_venue_maps
      WHERE gb_team_id=ANY($1::bigint[]) ORDER BY id`, [[SPIRIT, OG]]);
    const targets = maps.filter(m => ogIds.get(m.venue) === String(m.repair_team_id));
    assert.equal(targets.length, ogIds.size, "OG mapping set changed");
    for (const map of targets) {
      assert(isOg(map.venue_name), `Unexpected venue name: ${map.id}`);
      assert.equal(map.game, "cs2");
      assert([SPIRIT, OG].includes(String(map.gb_team_id)), `Unexpected mapping: ${map.id}`);
    }
    const { rows: matches } = await client.query(`SELECT * FROM client_matches
      WHERE game_id::text='3' AND (home_gb_team_id=ANY($1::bigint[]) OR away_gb_team_id=ANY($1::bigint[])) ORDER BY id`, [[SPIRIT, OG]]);
    const patches = matches.map(planOgMatchRepair).filter(Boolean);
    const { rows: occupied } = await client.query("SELECT * FROM client_matches WHERE merge_key=ANY($1::text[]) ORDER BY id", [patches.map(p => p.merge_key)]);
    const endedKeys = planEndedKeyRepairs(patches, occupied);
    const changedMaps = targets.filter(m => String(m.gb_team_id) === SPIRIT);
    let backup = null;
    if (apply && (changedMaps.length || patches.length)) {
      assert.equal(typeof saveBackup, "function", "Backup writer required");
      backup = await saveBackup({ createdAt: new Date().toISOString(), teams, maps,
        clientMatches: matches.filter(row => patches.some(p => p.id === row.id)), patches,
        occupied: occupied.filter(row => endedKeys.some(p => p.id === row.id)), endedKeys });
      for (const patch of endedKeys) {
        const result = await client.query("UPDATE client_matches SET merge_key=$2 WHERE id=$1 AND ended_at IS NOT NULL", [patch.id, patch.merge_key]);
        assert.equal(result.rowCount, 1);
      }
      for (const map of changedMaps) {
        const result = await client.query("UPDATE team_venue_maps SET gb_team_id=$1, source='manual' WHERE id=$2 AND gb_team_id=$3", [OG, map.id, SPIRIT]);
        assert.equal(result.rowCount, 1);
      }
      for (const patch of patches) {
        const result = await client.query(`UPDATE client_matches SET title=$2, merge_key=$3,
          home_gb_team_id=$4, away_gb_team_id=$5, bets=$6::jsonb WHERE id=$1`,
        [patch.id, patch.title, patch.merge_key, patch.home_gb_team_id, patch.away_gb_team_id, JSON.stringify(patch.bets)]);
        assert.equal(result.rowCount, 1);
      }
      // 逐行核验只改指定字段，包含赔率、选项 ID、反转、PM 状态与结束状态的保留。
      const { rows: afterMaps } = await client.query(`SELECT *, ${pidCol} AS repair_team_id FROM team_venue_maps
        WHERE gb_team_id=ANY($1::bigint[]) ORDER BY id`, [[SPIRIT, OG]]);
      assert.deepEqual(afterMaps, maps.map(m => changedMaps.some(t => t.id === m.id)
        ? { ...m, gb_team_id: OG, source: "manual" } : m));
      const { rows: afterMatches } = await client.query("SELECT * FROM client_matches WHERE id=ANY($1::bigint[]) ORDER BY id", [patches.map(p => p.id)]);
      assert.deepEqual(afterMatches, matches.filter(m => patches.some(p => p.id === m.id))
        .map(m => ({ ...m, ...patches.find(p => p.id === m.id) })));
      const { rows: afterEnded } = await client.query("SELECT * FROM client_matches WHERE id=ANY($1::bigint[]) ORDER BY id", [endedKeys.map(p => p.id)]);
      assert.deepEqual(afterEnded, occupied.filter(m => endedKeys.some(p => p.id === m.id))
        .map(m => ({ ...m, ...endedKeys.find(p => p.id === m.id) })));
    }
    await client.query("COMMIT");
    return { readOnly: !apply, maps: changedMaps.map(m => ({ venue: m.venue, teamId: m.repair_team_id, from: SPIRIT, to: OG })),
      matches: patches.map(p => ({ id: p.id, title: p.title })), endedKeys, backup };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === "--apply"), "Only --apply is supported; default is read only");
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady(), client = await pool.connect();
  try {
    console.log(JSON.stringify(await repairOgSpirit(client, { apply: args.includes("--apply"), saveBackup: async data => {
      const directory = fileURLToPath(new URL("../../output/og-spirit-repair/", import.meta.url));
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, `backup-${Date.now()}.json`);
      await writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
      return file;
    } }), null, 2));
  } finally { client.release(); await pool.end(); }
}
