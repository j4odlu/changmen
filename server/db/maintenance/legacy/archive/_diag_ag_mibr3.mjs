#!/usr/bin/env node
import { ensurePgPoolReady } from "@changmen/db";
const pool = await ensurePgPoolReady();

const r = await pool.query(`
  SELECT id, gb_team_id, name, game FROM canonical_teams
  WHERE gb_team_id IN ('100692','100693') OR id IN ('35816','35817','35828')
  OR name ILIKE '%AG.AL%' AND game='valorant'
  OR name ILIKE '%MIBR.LOS%' OR name ILIKE '%MIBR LOS%'
`);
for (const row of r.rows) console.log(JSON.stringify(row));

await pool.end();
