import { expect, it, vi } from "vitest";
import { removeSingleVenueBasketball } from "./remove-single-venue-basketball.mjs";

function fixture({ row = {}, references = 0, sourceLost = false } = {}) {
  const match = { id: "8746", game_id: "10001", title: "A vs B", ended_at: null,
    matchs: { Polymarket: "1210293" }, ...row };
  const platform = { platform: "Polymarket", source_match_id: "1210293", match_id: "8746", home: "A", away: "B" };
  const events = [];
  const client = { query: vi.fn(async (sql) => {
    events.push(sql);
    if (sql.startsWith("SELECT * FROM client_matches")) return { rows: [match] };
    if (sql.includes("FROM platform_matches WHERE match_id")) return { rows: [platform] };
    if (sql.includes("FROM pg_constraint")) return { rows: [
      { relation: "platform_matches", definition: "FOREIGN KEY (match_id) REFERENCES client_matches(id) ON DELETE SET NULL" },
      { relation: "client_match_platform_overrides", definition: "FOREIGN KEY (client_match_id) REFERENCES client_matches(id) ON DELETE CASCADE" },
    ] };
    if (sql.startsWith("SELECT COUNT(*)")) return { rows: [{ count: sql.includes("FROM orders ") ? references : 0 }] };
    if (sql.startsWith("DELETE")) return { rowCount: 1, rows: [{ id: "8746" }] };
    if (sql.includes("FROM platform_matches WHERE platform=")) return { rows: sourceLost ? [] : [{ ...platform, match_id: null }] };
    return { rows: [] };
  }) };
  const saveBackup = vi.fn(async data => { events.push("BACKUP"); expect(data.clientMatches).toEqual([match]); return "/backup.json"; });
  return { client, saveBackup, events };
}

it("defaults to read only and does not delete or create a backup", async () => {
  const { client, saveBackup, events } = fixture();
  expect(await removeSingleVenueBasketball(client, { saveBackup })).toMatchObject({ readOnly: true, ids: [8746], deleted: 0 });
  expect(saveBackup).not.toHaveBeenCalled();
  expect(events[0]).toBe("BEGIN READ ONLY");
  expect(events.some(sql => sql.startsWith("DELETE") || sql.includes("FOR UPDATE"))).toBe(false);
});

it("backs up before deleting and verifies that the venue row survives with its binding cleared", async () => {
  const { client, saveBackup, events } = fixture();
  expect(await removeSingleVenueBasketball(client, { apply: true, saveBackup })).toMatchObject({ deleted: 1, preservedSources: 1, backup: "/backup.json" });
  expect(events.indexOf("BACKUP")).toBeLessThan(events.findIndex(sql => sql.startsWith("DELETE")));
  expect(events.at(-1)).toBe("COMMIT");
});

it.each([
  { row: { game_id: "3" } },
  { row: { ended_at: 123 } },
  { row: { matchs: { Polymarket: "1210293", RAY: "ray1" } } },
  { references: 1 },
])("refuses changed matches or order references before deletion: %j", async options => {
  const { client, saveBackup, events } = fixture(options);
  await expect(removeSingleVenueBasketball(client, { apply: true, saveBackup })).rejects.toThrow();
  expect(saveBackup).not.toHaveBeenCalled();
  expect(events.some(sql => sql.startsWith("DELETE"))).toBe(false);
  expect(events.at(-1)).toBe("ROLLBACK");
});

it("refuses deletion without a backup writer", async () => {
  const { client, events } = fixture();
  await expect(removeSingleVenueBasketball(client, { apply: true })).rejects.toThrow("Backup is required");
  expect(events.some(sql => sql.startsWith("DELETE"))).toBe(false);
});

it("rolls back if source preservation cannot be verified", async () => {
  const { client, saveBackup, events } = fixture({ sourceLost: true });
  await expect(removeSingleVenueBasketball(client, { apply: true, saveBackup })).rejects.toThrow("Source data changed");
  expect(events.at(-1)).toBe("ROLLBACK");
});
