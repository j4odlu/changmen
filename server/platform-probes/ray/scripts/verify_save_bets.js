#!/usr/bin/env node

/**
 * 校验 RAY SaveBet 行 Map 分布（对比 live odds API）。
 * Usage: node verify_save_bets.js [matchId]
 */

import { nativeSourcesByMap } from "../../../../server/match/matcher/compose/normalize/native_bets.js";
import { fetchOdds, login } from "../session.js";
import { groupRayOddsToSaveBets } from "../shared/save_bets.js";

async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error("Usage: node verify_save_bets.js <matchId>");
    process.exit(1);
  }
  const session = await login();
  const payload = await fetchOdds(session, matchId);
  const bets = groupRayOddsToSaveBets(payload, /^获胜者$/);
  const stored = {
    [`RAY:${matchId}`]: { provider: "RAY", matchId, bets },
  };
  const clientSources = nativeSourcesByMap("RAY", matchId, stored, "cs2");

  console.log(
    JSON.stringify(
      {
        matchId,
        saveBetRows: bets.map(b => ({ Map: b.Map, BetName: b.BetName, SourceBetID: b.SourceBetID })),
        composerSources: [...clientSources.entries()].map(([map, source]) => ({
          Map: map,
          BetID: source.BetID,
        })),
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
