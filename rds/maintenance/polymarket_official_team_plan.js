/** One-time conversion of the historical PM name-ID format. No collector/runtime hooks. */
function legacyKey(game, name) {
  const key = String(name ?? "").normalize("NFKC").trim().toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4E00-\u9FFF]+/gi, "-").replace(/^-+|-+$/g, "");
  return key ? `${game}:${key}` : "";
}

const gameOf = league => ({ csgo: "cs2", dota2: "dota2", kog: "kog", lol: "lol", valorant: "valorant" })[league]
  || (String(league).startsWith("bk") ? "basketball" : null);
const gameOfMap = game => game === "CS:GO" ? "cs2" : game;
const idOf = team => String(team?.id ?? team?.TeamID ?? "");

export function buildPolymarketOfficialTeamPlan({ maps, teams, evidence = [] }) {
  const index = new Map(), observed = new Map();
  const add = (key, team) => {
    if (!key || !/^[1-9]\d*$/.test(idOf(team))) return;
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(idOf(team), team);
  };
  for (const team of teams) {
    const game = gameOf(team.league);
    if (game) for (const label of [team.name, team.alias]) add(legacyKey(game, label), team);
  }
  for (const item of evidence) {
    if (!item.resolvedTeams) continue;
    for (const [i, side] of ["home", "away"].entries()) {
      const key = String(item.source[`${side}_id`] || "");
      const resolved = item.resolvedTeams[i];
      const official = item.event.teams.find(t => idOf(t) === resolved.TeamID);
      if (!key || !official) continue;
      if (!observed.has(key)) observed.set(key, new Map());
      observed.get(key).set(idOf(official), official);
    }
  }
  const entries = [], unresolved = [], errors = [];
  for (const row of maps) {
    if (/^[1-9]\d*$/.test(row.venue_team_id)) continue;
    const game = gameOfMap(row.game);
    let candidates = observed.get(row.venue_team_id), reason = "event";
    if (!candidates?.size) {
      candidates = index.get(row.venue_team_id) || index.get(legacyKey(game, row.venue_name));
      reason = "official_name";
    }
    if (!candidates?.size && row.canonical_name) {
      candidates = index.get(legacyKey(game, row.canonical_name)); reason = "canonical_name";
    }
    if (candidates?.size > 1 && row.pandascore_id != null) {
      const exact = [...candidates.values()].filter(t => String(t.providerId) === String(row.pandascore_id));
      if (exact.length === 1) { candidates = new Map(exact.map(t => [idOf(t), t])); reason = "existing_provider_id"; }
    }
    if (candidates?.size !== 1) {
      unresolved.push({ oldId: row.venue_team_id, gbTeamId: row.gb_team_id, name: row.venue_name,
        reason: candidates?.size ? "ambiguous" : "not_found", candidates: [...(candidates?.keys() || [])] });
      continue;
    }
    const team = [...candidates.values()][0];
    entries.push({ oldId: row.venue_team_id, newId: idOf(team), name: String(team.name).trim(), game,
      reason, expected: { id: row.id, gb_team_id: row.gb_team_id, venue_name: row.venue_name,
        game: row.game, source: row.source, confidence: row.confidence } });
  }
  const targets = new Map();
  for (const entry of entries) {
    if (!targets.has(entry.newId)) targets.set(entry.newId, []);
    targets.get(entry.newId).push(entry);
  }
  for (const [id, group] of targets) {
    const canonical = new Set(group.map(e => e.expected.gb_team_id).filter(v => v != null).map(String));
    if (canonical.size > 1) errors.push({ officialId: id, reason: "conflicting_canonical_ids", canonicalIds: [...canonical] });
  }
  const byOld = new Map(entries.map(entry => [entry.oldId, entry]));
  const matches = [];
  for (const item of evidence.filter(e => e.isCurrent)) {
    if (!item.resolvedTeams) { errors.push({ sourceMatchId: item.source.source_match_id, reason: "missing_event_teams" }); continue; }
    for (const [i, side] of ["home", "away"].entries()) {
      const entry = byOld.get(item.source[`${side}_id`]);
      if (entry && entry.newId !== item.resolvedTeams[i].TeamID)
        errors.push({ sourceMatchId: item.source.source_match_id, oldId: entry.oldId, reason: "source_identity_conflict" });
    }
    matches.push({ sourceMatchId: item.source.source_match_id, game: item.source.source_game_id,
      before: { home_id: item.source.home_id, away_id: item.source.away_id, home: item.source.home, away: item.source.away },
      teams: item.resolvedTeams });
  }
  return { version: 1, createdAt: new Date().toISOString(), entries, matches, unresolved, errors };
}
