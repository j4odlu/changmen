import { hasDatabaseUrlConfig, initDatabaseUrl } from "../resolve_database_url.js";
import { getPgPool } from "../pg_pool.js";

/** [changmen 扩展] Keep the existing first-profile choice; relay token policy belongs to the caller. */
export async function findSportRelayUserId() {
  if (!hasDatabaseUrlConfig()) return "";
  await initDatabaseUrl();
  const pool = getPgPool("sport-pf-relay");
  if (!pool) return "";
  const { rows } = await pool.query("SELECT p.id::text AS id FROM profiles p ORDER BY p.id LIMIT 1");
  return String(rows[0]?.id || "").trim();
}
