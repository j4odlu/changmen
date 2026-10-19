#!/usr/bin/env node

import { login, fetchOdds } from "../session.js";
import * as Core from "../core.js";

async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error("Usage: node fetch_ray_odds.js <matchId>");
    process.exit(1);
  }
  const session = await login();
  const payload = await fetchOdds(session, matchId);
  const built = Core.buildStagesFromOdds(
    payload,
    payload.team?.find((t) => t.pos === 1)?.team_id,
    payload.team?.find((t) => t.pos === 2)?.team_id,
  );
  console.log(
    JSON.stringify(
      {
        gateway: session.gateway,
        matchId,
        match: payload.match_name,
        marketCount: built.marketCount,
        winStages: built.stages.filter((s) => s.winHome != null || s.winAway != null),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
