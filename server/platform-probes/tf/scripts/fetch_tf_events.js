#!/usr/bin/env node
import * as Core from "../core.js";
import { loadSession, fetchTodayEvents, fetchEventMarkets } from "../session.js";

async function main() {
  const session = loadSession();
  const betNameRegex = Core.compileBetName(session);
  console.log("[tf] gateway:", session.gateway);
  console.log("[tf] games:", session.gameIds.join(", ") || "*");

  const list = await fetchTodayEvents(session);
  const filter = { gameIds: session.gameIds, horizonMs: 3600 * 1000 };
  const matches = list
    .map((row) => Core.normalizeListEvent(row, filter))
    .filter(Boolean);

  console.log(`[tf] today events (filtered): ${matches.length}`);
  for (const match of matches.slice(0, 5)) {
    console.log(`  ${match.matchId} ${match.gameName} ${match.home.name} vs ${match.away.name}`);
    const results = await fetchEventMarkets(session, match.matchId, { marketOption: "MATCH" });
    const built = Core.extractWinMarketsFromResults(results, betNameRegex);
    for (const stage of built.stages) {
      console.log(
        `    stage ${stage.stageId} ${stage.label}: ${stage.winHome} / ${stage.winAway} locked=${stage.winLocked}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
