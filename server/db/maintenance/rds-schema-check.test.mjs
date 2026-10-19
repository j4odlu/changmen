import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RDS_MIGRATIONS } from "./apply-rds-schema.mjs";
import { migrationChecksum, readSchemaBaseline, schemaDifferences, verifyRdsSchema } from "./rds-schema-check.mjs";

const baseline = readSchemaBaseline();
describe("read-only numbered-schema verification", () => {
  it("pins every active migration and includes fields, constraints, indexes, sequences and triggers", () => {
    expect(Object.keys(baseline.migrations)).toEqual(RDS_MIGRATIONS);
    for (const name of RDS_MIGRATIONS)
      expect(migrationChecksum(readFileSync(new URL(`../assets/migrations/${name}`, import.meta.url), "utf8"))).toBe(baseline.migrations[name]);
    expect(Object.keys(baseline.schema.columns)).toHaveLength(373);
    expect(baseline.schema.columns["platform_bets.line_id"].type).toBe("bigint");
    expect(baseline.schema.constraints["players.players_active_requires_owner"]).toBeDefined();
  });

  it.each(Object.keys(baseline.schema))("rejects a missing required %s object", kind => {
    const actual = structuredClone(baseline.schema), key = Object.keys(actual[kind])[0];
    delete actual[kind][key];
    expect(schemaDifferences(actual, baseline.schema)).toContain(`${kind}.${key}: missing`);
  });

  it.each([
    ["columns", "players.total_balance", "type", "text"],
    ["columns", "players.total_balance", "notNull", false],
    ["columns", "players.total_balance", "default", "999"],
    ["indexes", "players.players_venue_account_key_all", "valid", false],
    ["indexes", "players.players_venue_account_key_all", "ready", false],
    ["constraints", "players.players_active_requires_owner", "validated", false],
    ["sequences", "client_matches_id_seq", "increment", "-1"],
    ["triggers", "canonical_teams.canonical_teams_before_insert_trg", "enabled", "D"],
    ["functions", "next_manual_gb_team_id()", "body", "SELECT 1;"],
  ])("rejects changed %s/%s/%s", (kind, key, field, value) => {
    const actual = structuredClone(baseline.schema);
    expect(actual[kind][key][field]).not.toEqual(value);
    actual[kind][key][field] = value;
    expect(schemaDifferences(actual, baseline.schema).some(error => error.startsWith(`${kind}.${key}: incompatible`))).toBe(true);
  });

  it("allows independent runtime tables while retaining every numbered requirement", () => {
    const actual = structuredClone(baseline.schema);
    actual.tables.client_certificates = { kind: "r" };
    expect(schemaDifferences(actual, baseline.schema)).toEqual([]);
  });

  function catalogClient({ missing = false, badChecksum = false } = {}) {
    const responses = [[], [], ...Object.entries(baseline.schema).map(([kind, objects]) =>
      Object.entries(objects).filter(([key]) => !(missing && kind === "columns" && key === "platform_bets.line_id"))
        .map(([key, value]) => ({ key, value }))), [{ name: badChecksum ? "changmen_schema_migrations" : null }]];
    if (badChecksum) responses.push([{ name: RDS_MIGRATIONS[0], checksum: "modified" }]);
    return { query: vi.fn(async () => ({ rows: responses.shift() || [] })) };
  }

  it("uses one read-only snapshot without creating a ledger or executing data SQL", async () => {
    const client = catalogClient();
    expect(await verifyRdsSchema(client, { log: () => {} })).toEqual({ verified: true, readOnly: true, migrationsReplayed: 0 });
    expect(client.query.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(client.query.mock.calls.at(-1)[0]).toBe("COMMIT");
    for (const [sql] of client.query.mock.calls)
      expect(sql).toMatch(/^(SELECT |BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$|SET LOCAL search_path|COMMIT$)/);
  });

  it("rejects missing fields without committing, repairing, or adopting a migration ledger", async () => {
    const client = catalogClient({ missing: true });
    await expect(verifyRdsSchema(client)).rejects.toThrow("columns.platform_bets.line_id: missing");
    expect(client.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
    expect(client.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
  });

  it("still rejects a changed historical checksum when a ledger already exists", async () => {
    const client = catalogClient({ badChecksum: true });
    await expect(verifyRdsSchema(client)).rejects.toThrow("已执行的迁移内容发生变化");
    expect(client.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
  });
});
