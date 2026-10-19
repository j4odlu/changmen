#!/usr/bin/env node
import * as Core from "../core.js";
import { loadSession, fetchGameList, fetchPointsList } from "../session.js";

async function main() {
  const session = loadSession();
  const betNameRegex = Core.compileBetName(session);
  const list = await fetchGameList(session);
  const filtered = list.filter((row) => Core.normalizeListEvent(row, { gameIds: session.gameIds }));

  console.log(`IA matches: ${filtered.length} (gateway=${session.gateway})`);
  const sample = filtered.slice(0, 3);
  for (const row of sample) {
    const match = Core.normalizeListEvent(row, { gameIds: session.gameIds });
    const plays = await fetchPointsList(session, match.matchId);
    const stages = Core.extractStagesFromPlays(plays, betNameRegex);
    console.log(JSON.stringify({ match, stageCount: stages.length, stages }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
