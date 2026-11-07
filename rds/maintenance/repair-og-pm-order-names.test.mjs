import { expect, it, vi } from "vitest";
import { ogOrderTokenNames, planOgOrderName, repairOgPmOrderNames } from "./repair-og-pm-order-names.mjs";

const match = { id: "9189", title: "OG vs BC.Game Esports", matchs: { Polymarket: "1285216" },
  home_gb_team_id: "100931", away_gb_team_id: "101039", bets: [{ HomeName: "OG", AwayName: "BC.Game Esports",
    Sources: { Polymarket: { HomeID: "og-token", AwayID: "bc-token" } } }] };
const order = (extra = {}) => ({ id: "1", provider: "Polymarket", order_id: "original-order", link: "123",
  match: "Team Spirit vs BC.Game Esports", item: "BC.Game Esports", bet: "[地图2] 获胜",
  bet_money: 97, money: -97, status: "Lose", raw: { venueMatchId: "1285216", pmTokenId: "bc-token",
    match: "Team Spirit vs BC.Game Esports", item: "BC.Game Esports", pmShares: 32.488373,
    pmMatchResult: "lose", pmSubmission: { signed: "original" } }, ...extra });

it("changes only stored display names and preserves the financial and signed submission data", () => {
  const row = order(), before = structuredClone(row);
  const patch = planOgOrderName(row, ogOrderTokenNames(match));
  expect(patch).toEqual({ id: "1", match: match.title, item: row.item, raw: { ...row.raw, match: match.title } });
  expect(row).toEqual(before);
});

it("corrects the OG selection label according to its existing token", () => {
  const row = order();
  row.item = row.raw.item = "Team Spirit";
  row.raw.pmTokenId = "og-token";
  expect(planOgOrderName(row, ogOrderTokenNames(match))).toMatchObject({ item: "OG", raw: { item: "OG", pmTokenId: "og-token" } });
});

it.each([
  { provider: "RAY" }, { raw: { venueMatchId: "different", pmTokenId: "bc-token" } },
  { raw: { venueMatchId: "1285216", pmTokenId: "unknown-token" } },
  { item: "Team Spirit" }, { match: "Team Spirit vs Another team" },
])("rejects a different event, provider or contradictory token/name: %j", extra => {
  expect(() => planOgOrderName(order(extra), ogOrderTokenNames(match))).toThrow();
});

it("is idempotent after repair", () => {
  const row = order(), names = ogOrderTokenNames(match);
  expect(planOgOrderName({ ...row, ...planOgOrderName(row, names) }, names)).toBeNull();
});

function fixture({ changedMoney = false, corrected = false } = {}) {
  let row = order();
  if (corrected) row = { ...row, ...planOgOrderName(row, ogOrderTokenNames(match)) };
  const events = [];
  const client = { query: vi.fn(async (sql, params) => {
    events.push(sql);
    if (sql.includes("FROM client_matches")) return { rows: [match] };
    if (sql.startsWith("SELECT * FROM orders WHERE provider=")) return { rows: [structuredClone(row)] };
    if (sql.startsWith("UPDATE orders")) {
      row = { ...row, match: params[1], item: params[2], raw: JSON.parse(params[3]) };
      return { rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM orders WHERE id=")) return { rows: [{ ...row, ...(changedMoney ? { money: 0 } : {}) }] };
    return { rows: [] };
  }) };
  const saveBackup = vi.fn(async () => { events.push("BACKUP"); return "/backup.json"; });
  return { client, saveBackup, events };
}

it("defaults to read only without a backup or writes", async () => {
  const { client, saveBackup, events } = fixture();
  expect(await repairOgPmOrderNames(client, { saveBackup })).toMatchObject({ readOnly: true, changed: 1 });
  expect(saveBackup).not.toHaveBeenCalled();
  expect(events.some(sql => sql.startsWith("UPDATE") || sql.includes("FOR UPDATE"))).toBe(false);
});

it("backs up before changing names and commits after verifying all other fields", async () => {
  const { client, saveBackup, events } = fixture();
  expect(await repairOgPmOrderNames(client, { apply: true, saveBackup })).toMatchObject({ changed: 1, backup: "/backup.json" });
  expect(events.indexOf("BACKUP")).toBeLessThan(events.findIndex(sql => sql.startsWith("UPDATE")));
  expect(events.at(-1)).toBe("COMMIT");
});

it("rolls back any unexpected change to financial fields", async () => {
  const { client, saveBackup, events } = fixture({ changedMoney: true });
  await expect(repairOgPmOrderNames(client, { apply: true, saveBackup })).rejects.toThrow("Non-name order fields changed");
  expect(events.at(-1)).toBe("ROLLBACK");
});

it("does not write if a backup cannot be created", async () => {
  const { client, events } = fixture();
  await expect(repairOgPmOrderNames(client, { apply: true })).rejects.toThrow("Backup writer required");
  expect(events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
});

it("does not back up or write already corrected orders", async () => {
  const { client, saveBackup, events } = fixture({ corrected: true });
  expect(await repairOgPmOrderNames(client, { apply: true, saveBackup })).toMatchObject({ changed: 0, backup: null });
  expect(saveBackup).not.toHaveBeenCalled();
  expect(events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
});
