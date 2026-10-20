/**
 * team_venue_maps 列名兼容：031 迁移前为 venue_id，之后为 venue_team_id。
 */

import { getPgPool } from "./common.js";

let venueTeamIdColumn = null;

export async function resolveVenueTeamIdColumn(pool = getPgPool()) {
  if (venueTeamIdColumn)
    return venueTeamIdColumn;
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'team_venue_maps'
       AND column_name IN ('venue_team_id', 'venue_id')`,
  );
  const names = new Set(rows.map(r => r.column_name));
  if (names.has("venue_team_id"))
    venueTeamIdColumn = "venue_team_id";
  else if (names.has("venue_id"))
    venueTeamIdColumn = "venue_id";
  else
    throw new Error("team_venue_maps 缺少 venue_team_id / venue_id 列");
  return venueTeamIdColumn;
}

export function readVenueTeamId(row) {
  if (row?.venue_team_id != null && row.venue_team_id !== "")
    return String(row.venue_team_id);
  if (row?.venue_id != null && row.venue_id !== "")
    return String(row.venue_id);
  return "";
}
