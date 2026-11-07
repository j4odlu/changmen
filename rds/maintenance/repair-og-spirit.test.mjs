import { expect, it, vi } from "vitest";
import { planEndedKeyRepairs, planOgMatchRepair, repairOgSpirit } from "./repair-og-spirit.mjs";

const match = (extra = {}) => ({ id: "9189", game_id: "3", title: "Team Spirit vs BC.Game Esports",
  merge_key: "match:id:3:100215:101039", home_gb_team_id: "100215", away_gb_team_id: "101039",
  matchs: { Polymarket: "1285216", RAY: "38465328", IA: "390887" }, reverse: [], ended_at: null,
  pm_sport: { homeTeam: "OG", awayTeam: "BC.Game Esports" },
  bets: [{ ID: 12, HomeName: "Team Spirit", AwayName: "BC.Game Esports",
    Sources: { Polymarket: { HomeID: "token1", AwayID: "token2", HomeOdds: 1.2, AwayOdds: 4.7 } } },
  { ID: 13, HomeName: "大", AwayName: "小" }], ...extra });

it("repairs OG identity and names while preserving source odds, tokens and unrelated markets", () => {
  const row = match(), before = structuredClone(row);
  const patch = planOgMatchRepair(row);
  expect(patch).toMatchObject({ id: "9189", title: "OG vs BC.Game Esports",
    merge_key: "match:id:3:100931:101039", home_gb_team_id: "100931", away_gb_team_id: "101039" });
  expect(patch.bets[0]).toEqual({ ...row.bets[0], HomeName: "OG" });
  expect(patch.bets[1]).toEqual(row.bets[1]);
  expect(row).toEqual(before);
});

it("projects PM orientation and preserves ended-key suffixes", () => {
  const patch = planOgMatchRepair(match({ title: "BC.Game Esports vs Team Spirit",
    home_gb_team_id: "101039", away_gb_team_id: "100215", reverse: ["Polymarket"],
    merge_key: "match:id:3:100215:101039@ended:9167", ended_at: "123",
    bets: [{ HomeName: "BC.Game Esports", AwayName: "Team Spirit", Sources: {} }] }));
  expect(patch).toMatchObject({ title: "BC.Game Esports vs OG", away_gb_team_id: "100931",
    merge_key: "match:id:3:100931:101039@ended:9167", bets: [{ AwayName: "OG" }] });
});

it("keeps name-based merge keys and already-correct OG rows", () => {
  expect(planOgMatchRepair(match({ merge_key: "match:name:3:bcgame:og" })).merge_key).toBe("match:name:3:bcgame:og");
  expect(planOgMatchRepair(match({ home_gb_team_id: "100931", title: "OG vs BC.Game Esports",
    merge_key: "match:id:3:100931:101039" }))).toBeNull();
  expect(planOgMatchRepair(match({ home_gb_team_id: "100931", title: "OG vs BC.Game Esports" })))
    .toMatchObject({ merge_key: "match:id:3:100931:101039" });
});

it.each([
  { pm_sport: { homeTeam: "Spirit", awayTeam: "BC.Game Esports" } },
  { pm_sport: { homeTeam: "Spirit HU", awayTeam: "BC.Game Esports" } },
  { game_id: "2" }, { pm_sport: null },
])("leaves true Spirit, other games and unproven history unchanged: %j", extra => {
  expect(planOgMatchRepair(match(extra))).toBeNull();
});

it("frees a historical pair key without deleting the old match", () => {
  const patch = planOgMatchRepair(match());
  const old = { id: "1415", ended_at: "123", merge_key: patch.merge_key,
    home_gb_team_id: "101039", away_gb_team_id: "100931" };
  expect(planEndedKeyRepairs([patch], [old])).toEqual([{ id: "1415", merge_key: "match:id:3:100931:101039@ended:1415" }]);
  expect(() => planEndedKeyRepairs([patch], [{ ...old, ended_at: null }])).toThrow("Active match");
  expect(() => planEndedKeyRepairs([patch], [{ ...old, home_gb_team_id: "100215" }])).toThrow("Different team pair");
});

it.each([
  { title: "Another team vs BC.Game Esports" }, { matchs: {} },
  { pm_sport: { homeTeam: "OG", awayTeam: "OG" } }, { merge_key: "match:id:3:unexpected" },
])("refuses contradictory evidence: %j", extra => {
  expect(() => planOgMatchRepair(match(extra))).toThrow();
});

function fixture({ changedSource = false } = {}) {
  const row = match();
  const teams = [{ id: "1", gb_team_id: "100215", game: "cs2", name: "Team Spirit" },
    { id: "2", gb_team_id: "100931", game: "cs2", name: "OG" }];
  const maps = [["PredictFun", "cs2:og"], ["OB", "296331008519292"], ["RAY", "21646168"],
    ["PB", "og@cs2"], ["IA", "16009"], ["Polymarket", "176470"]].map(([venue, pid], i) =>
    ({ id: String(i + 1), venue, venue_team_id: pid, repair_team_id: pid, venue_name: "OG",
      game: "cs2", gb_team_id: "100215", source: "manual" }));
  const events = [];
  let mapRead = 0;
  const client = { query: vi.fn(async (sql, params) => {
    events.push(sql);
    if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "venue_team_id" }] };
    if (sql.startsWith("SELECT * FROM canonical_teams")) return { rows: teams };
    if (sql.includes("FROM team_venue_maps")) return { rows: mapRead++ === 0 ? maps : maps.map(m => ({ ...m, gb_team_id: "100931" })) };
    if (sql.includes("FROM client_matches") && sql.includes("WHERE game_id")) return { rows: [row] };
    if (sql.startsWith("SELECT * FROM client_matches WHERE id=")) return { rows: params[0].length === 0 ? [] : [{ ...row, ...planOgMatchRepair(row),
      ...(changedSource ? { matchs: {} } : {}) }] };
    if (sql.startsWith("UPDATE")) return { rowCount: 1, rows: [] };
    return { rows: [] };
  }) };
  const saveBackup = vi.fn(async () => { events.push("BACKUP"); return "/backup.json"; });
  return { client, saveBackup, events };
}

it("defaults to a consistent read-only plan without writes or backups", async () => {
  const { client, saveBackup, events } = fixture();
  const result = await repairOgSpirit(client, { saveBackup });
  expect(result.readOnly).toBe(true);
  expect(result.maps).toHaveLength(6);
  expect(result.matches).toEqual([{ id: "9189", title: "OG vs BC.Game Esports" }]);
  expect(saveBackup).not.toHaveBeenCalled();
  expect(events.some(sql => /^(UPDATE|LOCK)/.test(sql))).toBe(false);
});

it("backs up before writing and verifies preserved fields before committing", async () => {
  const { client, saveBackup, events } = fixture();
  expect(await repairOgSpirit(client, { apply: true, saveBackup })).toMatchObject({ backup: "/backup.json", readOnly: false });
  expect(events.indexOf("BACKUP")).toBeLessThan(events.findIndex(sql => sql.startsWith("UPDATE")));
  expect(events.at(-1)).toBe("COMMIT");
});

it("rolls back when a preserved field changes", async () => {
  const { client, saveBackup, events } = fixture({ changedSource: true });
  await expect(repairOgSpirit(client, { apply: true, saveBackup })).rejects.toThrow();
  expect(events.at(-1)).toBe("ROLLBACK");
});

it("refuses any write if backup creation fails", async () => {
  const { client, events } = fixture();
  await expect(repairOgSpirit(client, { apply: true, saveBackup: async () => { throw Error("disk full"); } })).rejects.toThrow("disk full");
  expect(events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
  expect(events.at(-1)).toBe("ROLLBACK");
});
