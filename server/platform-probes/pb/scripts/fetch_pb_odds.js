#!/usr/bin/env node
import { describePlatformGame } from "@changmen/shared/catalog/game_catalog";
import { parseEuroOddsPayload } from "../core.js";
import { loadSession, fetchEuroOdds, fetchBalance, buildAuthHeaders } from "../session.js";

async function main() {
  const cmd = process.argv[2] || "list";

  if (cmd === "headers") {
    const session = loadSession();
    console.log(JSON.stringify(buildAuthHeaders(session), null, 2));
    return;
  }

  if (cmd === "balance") {
    const session = loadSession();
    const bal = await fetchBalance(session);
    console.log(JSON.stringify(bal, null, 2));
    return;
  }

  const session = loadSession();
  const payload = await fetchEuroOdds(session);
  const parsed = parseEuroOddsPayload(payload);

  if (cmd === "match") {
    const matchId = process.argv[3];
    if (!matchId) {
      console.error("Usage: node fetch_pb_odds.js match <matchId>");
      process.exit(1);
    }
    const match = parsed.matches.find((m) => m.matchId === String(matchId));
    if (!match) {
      console.error(`δ�ҵ����� ${matchId}`);
      process.exit(1);
    }
    const game = describePlatformGame("PB", match.gameId);
    console.log(
      JSON.stringify(
        {
          gateway: session.gateway,
          matchId: match.matchId,
          gameId: match.gameId,
          gameCode: game.gameCode,
          home: match.home.name,
          away: match.away.name,
          startTime: match.startTime,
          isLive: match.isLive,
          detail: parsed.byMatch[match.matchId],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        gateway: session.gateway,
        matchCount: parsed.matches.length,
        matches: parsed.matches.map((m) => {
          const game = describePlatformGame("PB", m.gameId);
          const detail = parsed.byMatch[m.matchId];
          return {
            matchId: m.matchId,
            gameId: m.gameId,
            gameCode: game.gameCode,
            home: m.home.name,
            away: m.away.name,
            startTime: m.startTime,
            isLive: m.isLive,
            bo: m.bo,
            stageCount: detail?.stages?.length || 0,
            winHome: detail?.winHome,
            winAway: detail?.winAway,
          };
        }),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
