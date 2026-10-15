// [changmen 扩展] Named, bounded compatibility for pre-014 history tables and
// the 023/025 team_platform_maps rename. This never changes the database or SQL baseline.
const column = (type, notNull = false, defaultValue = null) => ({ type, default: defaultValue, notNull, identity: "", generated: "" });
const legacyColumns = {
  "client_matches_history.archived_at": column("bigint", true, "((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint"),
  "client_matches_history.bo": column("smallint"),
  "client_matches_history.built_at": column("bigint"),
  "client_matches_history.id": column("integer"),
  "client_matches_history.reverse": column("jsonb"),
  "client_matches_history.round": column("smallint"),
  "client_matches_history.title": column("text"),
  "platform_matches_history.archived_at": column("bigint", true, "((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint"),
  "platform_matches_history.away": column("text"),
  "platform_matches_history.home": column("text"),
  "platform_matches_history.match_id": column("integer"),
  "platform_matches_history.synced_at": column("bigint"),
  "platform_matches_history.teams": column("jsonb", false, "'[]'::jsonb"),
};
const aliases = [
  ["constraints", "team_venue_maps.team_venue_maps_gb_team_id_fkey", "team_venue_maps.team_platform_maps_canonical_id_fkey"],
  ["constraints", "team_venue_maps.team_venue_maps_pkey", "team_venue_maps.team_platform_maps_pkey"],
  ["indexes", "team_venue_maps.team_venue_maps_pkey", "team_venue_maps.team_platform_maps_pkey"],
  ["sequences", "team_venue_maps_id_seq", "team_platform_maps_id_seq"],
];
export const canonical = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : typeof value === "string" ? value.replaceAll("\r\n", "\n") : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function compatibleSchema(actual, expected) {
  const schema = structuredClone(actual), accepted = [];
  // Archive writers explicitly supply payload columns and omit archived_at;
  // readers order archived_at, without timestamp arithmetic. Both defaults preserve ordering.
  for (const [name, legacy] of Object.entries(legacyColumns)) {
    if (expected.columns[name] && !equal(schema.columns[name], expected.columns[name]) && equal(schema.columns[name], legacy)) {
      schema.columns[name] = expected.columns[name];
      accepted.push(`legacy-history:${name}`);
    }
  }
  for (const [kind, name, oldName] of aliases) {
    if (schema[kind]?.[name] || !schema[kind]?.[oldName]) continue;
    const value = structuredClone(schema[kind][oldName]);
    if (kind === "indexes")
      value.definition = value.definition.replace("CREATE UNIQUE INDEX team_platform_maps_pkey ON", "CREATE UNIQUE INDEX team_venue_maps_pkey ON");
    // A similarly named sequence is insufficient: verify its identity dependency.
    if (kind === "sequences" && !equal(actual.sequenceOwners?.[oldName], {
      table: "team_venue_maps", column: "id", dependency: "i",
    })) continue;
    if (equal(value, expected[kind][name])) {
      schema[kind][name] = value;
      accepted.push(`renamed-object:${oldName}->${name}`);
    }
  }
  return { schema, accepted };
}
