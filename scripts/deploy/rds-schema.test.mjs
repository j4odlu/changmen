import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { compatibleSchema } from "../../server/backend/scripts/rds-schema-compatibility.mjs";
import { readSchemaBaseline, schemaDifferences, verifyRdsSchema, migrationChecksum } from "../../server/backend/scripts/rds-schema-check.mjs";
const baseline = readSchemaBaseline();
const clone = () => structuredClone(baseline.schema);
const errors = actual => schemaDifferences(compatibleSchema(actual, baseline.schema).schema, baseline.schema);
function legacy() {
  const actual = clone();
  const replacements = {
    "client_matches_history.archived_at": ["bigint", true, "((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint"],
    "client_matches_history.bo": ["smallint", false, null],
    "client_matches_history.built_at": ["bigint", false, null],
    "client_matches_history.id": ["integer", false, null],
    "client_matches_history.reverse": ["jsonb", false, null],
    "client_matches_history.round": ["smallint", false, null],
    "client_matches_history.title": ["text", false, null],
    "platform_matches_history.archived_at": ["bigint", true, "((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint"],
    "platform_matches_history.away": ["text", false, null],
    "platform_matches_history.home": ["text", false, null],
    "platform_matches_history.match_id": ["integer", false, null],
    "platform_matches_history.synced_at": ["bigint", false, null],
    "platform_matches_history.teams": ["jsonb", false, "'[]'::jsonb"],
  };
  for (const [key, [type, notNull, defaultValue]] of Object.entries(replacements))
    actual.columns[key] = { ...actual.columns[key], type, notNull, default: defaultValue };
  for (const [kind, name, oldName] of [
    ["constraints", "team_venue_maps.team_venue_maps_gb_team_id_fkey", "team_venue_maps.team_platform_maps_canonical_id_fkey"],
    ["constraints", "team_venue_maps.team_venue_maps_pkey", "team_venue_maps.team_platform_maps_pkey"],
    ["indexes", "team_venue_maps.team_venue_maps_pkey", "team_venue_maps.team_platform_maps_pkey"],
    ["sequences", "team_venue_maps_id_seq", "team_platform_maps_id_seq"],
  ]) {
    actual[kind][oldName] = actual[kind][name]; delete actual[kind][name];
    if (kind === "indexes") actual[kind][oldName].definition = actual[kind][oldName].definition.replace("INDEX team_venue_maps_pkey ON", "INDEX team_platform_maps_pkey ON");
  }
  actual.sequenceOwners = { team_platform_maps_id_seq: { table: "team_venue_maps", column: "id", dependency: "i" } };
  return actual;
}
test("canonical schema and every migration checksum remain required", () => {
  assert.deepEqual(errors(clone()), []);
  for (const [name, checksum] of Object.entries(baseline.migrations))
    assert.equal(migrationChecksum(readFileSync(new URL(`../../server/backend/db/migrations/${name}`, import.meta.url), "utf8")), checksum);
});
test("17 known differences are explicit compatibility, not dropped requirements", () => {
  const actual = legacy(), before = structuredClone(actual);
  assert.equal(schemaDifferences(actual, baseline.schema).length, 17);
  assert.deepEqual(errors(actual), []);
  assert.equal(compatibleSchema(actual, baseline.schema).accepted.length, 17);
  assert.deepEqual(actual, before, "catalog comparison must not mutate its input");
});
for (const [label, mutate] of [
  ["missing owner constraint", a => { delete a.constraints["players.players_active_requires_owner"]; }],
  ["wrong balance type", a => { a.columns["players.total_balance"].type = "text"; }],
  ["invalid account uniqueness index", a => { a.indexes["players.players_venue_account_key_all"].valid = false; }],
  ["renamed primary key still required", a => { delete a.constraints["team_venue_maps.team_platform_maps_pkey"]; }],
  ["renamed foreign key must be validated", a => { a.constraints["team_venue_maps.team_platform_maps_canonical_id_fkey"].validated = false; }],
  ["renamed index must be unique", a => { a.indexes["team_venue_maps.team_platform_maps_pkey"].definition = a.indexes["team_venue_maps.team_platform_maps_pkey"].definition.replace("UNIQUE ", ""); }],
  ["sequence must belong to the identity column", a => { a.sequenceOwners.team_platform_maps_id_seq.column = "other"; }],
  ["sequence settings remain required", a => { a.sequences.team_platform_maps_id_seq.increment = "-1"; }],
  ["unsupported archive timestamp default", a => { a.columns["client_matches_history.archived_at"].default = "0"; }],
  ["missing archive column", a => { delete a.columns["platform_matches_history.synced_at"]; }],
  ["missing certificate registry", a => { delete a.tables.client_certificates; }],
  ["missing certificate session binding", a => { delete a.columns["auth_sessions.cert_fingerprint"]; }],
]) test(`compatibility fails closed: ${label}`, () => { const actual = legacy(); mutate(actual); assert(errors(actual).length > 0); });

function catalogClient(actual = clone(), ledger = []) {
  const queries = [];
  return { queries, async query(sql) {
    queries.push(sql);
    const kind = sql.includes("pg_attribute a JOIN") ? "columns"
      : sql.includes("FROM pg_constraint") ? "constraints"
        : sql.includes("FROM pg_index") ? "indexes"
          : sql.includes("FROM pg_sequence") ? "sequences"
            : sql.includes("FROM pg_class s") ? "sequenceOwners"
              : sql.includes("FROM pg_proc") ? "functions"
                : sql.includes("FROM pg_trigger") ? "triggers"
                  : sql.includes("FROM pg_class c JOIN") ? "tables" : null;
    if (kind) return { rows: Object.entries(actual[kind] || {}).map(([key, value]) => ({ key, value })) };
    if (sql.startsWith("SELECT to_regclass")) return { rows: [{ name: ledger.length ? "changmen_schema_migrations" : null }] };
    if (sql.startsWith("SELECT name,checksum")) return { rows: ledger };
    return { rows: [] };
  } };
}
test("verification runs in a bounded read-only transaction and reports compatibility", async () => {
  const client = catalogClient(legacy());
  const result = await verifyRdsSchema(client, { log: () => {} });
  assert.equal(result.readOnly, true); assert.equal(result.compatibility.length, 17);
  assert.equal(client.queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(client.queries.at(-1), "COMMIT");
  for (const sql of client.queries) assert.match(sql, /^(SELECT |BEGIN |SET LOCAL |COMMIT$)/);
  assert(client.queries.includes("SET LOCAL statement_timeout = '15s'"));
});
test("missing structures and altered migration checksums abort without ledger writes", async () => {
  const missing = clone(); delete missing.columns["players.total_balance"];
  for (const client of [catalogClient(missing), catalogClient(clone(), [{ name: "001_baseline.sql", checksum: "tampered" }])]) {
    await assert.rejects(verifyRdsSchema(client, { log: () => {} }));
    assert.equal(client.queries.at(-1), "ROLLBACK");
    assert(!client.queries.includes("COMMIT"));
  }
});
