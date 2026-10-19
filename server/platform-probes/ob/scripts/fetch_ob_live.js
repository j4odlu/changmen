#!/usr/bin/env node
/**
 * OB batch snapshot: login → game/index → game/view (multiple matches) → getTimer.
 */

import * as Core from "../core.js";
import { login, obGet } from "../session.js";

function formatTime(tsSec) {
  if (!tsSec) return "";
  return new Date(tsSec * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function parseArgs(argv) {
  const out = { maxMatches: 8 };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--max-matches") out.maxMatches = Number(argv[i + 1]) || 8;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const session = await login();
  const { gateway, token, lang, mqtt } = session;

  const index = await obGet(gateway, "/game/index?game_id=0&flag=1&day=1", token, lang);
  if (index.json.status === "false") {
    console.error(JSON.stringify({ error: "token_invalid", message: index.json.data, gateway }, null, 2));
    process.exit(1);
  }

  const matches = Core.normalizeGameIndex(index.json);
  const now = Date.now();
  const upcoming = matches.filter((m) => m.startTime <= now + 3600 * 1000);

  const markets = [];
  const maxMatches = Math.min(upcoming.length, args.maxMatches);
  for (let i = 0; i < maxMatches; i++) {
    const m = upcoming[i];
    const bo = m.bo || 1;
    const stages = bo === 1 ? [0] : Array.from({ length: bo + 1 }, (_, n) => n);
    for (const stageId of stages) {
      try {
        const view = await obGet(
          gateway,
          `/game/view?match_id=${m.matchId}&stage_id=${stageId}`,
          token,
          lang,
        );
        markets.push(...Core.normalizeGameView(m.matchId, stageId, view.json));
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        /* skip failed stage */
      }
    }
  }

  let timer = null;
  try {
    const t = await obGet(gateway, "/game/getTimer", token, lang);
    timer = t.json.status === "true" ? t.json.data : null;
  } catch {
    /* optional */
  }

  const report = {
    fetchedAt: new Date().toISOString(),
    provider: "OB",
    gateway,
    mqtt,
    tokenPreview: token.slice(0, 6) + "..." + token.slice(-4),
    summary: {
      totalMatches: matches.length,
      within1Hour: upcoming.length,
      marketsFetched: markets.length,
      oddsCount: markets.reduce((n, mk) => n + mk.odds.length, 0),
    },
    matches: upcoming.map((m) => ({
      matchId: m.matchId,
      gameId: m.gameId,
      bo: m.bo,
      startTime: m.startTime,
      startTimeText: formatTime(m.startTime / 1000),
      home: m.home.name,
      away: m.away.name,
      tournament: m.raw.tournament_cn_name?.replace(/&nbsp;/g, " ") || "",
    })),
    markets: markets.map((mk) => ({
      matchId: mk.matchId,
      marketId: mk.marketId,
      name: mk.marketName,
      round: mk.round,
      locked: mk.locked,
      odds: mk.odds.map((o) => ({ oddsId: o.oddsId, side: o.side, name: o.name, odd: o.odd })),
    })),
    timers: timer,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
