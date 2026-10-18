// [changmen 扩展] Maintenance assets belong to this data package; no backend fallback.
import { readFileSync, readdirSync } from "node:fs";

const migrations = new URL("../assets/migrations/", import.meta.url);
export const readRdsSchemaBaseline = () => JSON.parse(readFileSync(new URL("../assets/schema-baseline.json", import.meta.url), "utf8"));
export const listRdsMigrationNames = () => readdirSync(migrations)
  .filter(name => /^\d+_.*\.sql$/.test(name) && name !== "002_prune_pg_cron.sql").sort();
export function readRdsMigrationSql(name) {
  if (typeof name !== "string" || !/^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)) throw new Error("Invalid RDS migration asset name");
  return readFileSync(new URL(name, migrations), "utf8");
}
