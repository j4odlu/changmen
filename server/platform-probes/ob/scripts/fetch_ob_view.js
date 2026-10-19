#!/usr/bin/env node
/**
 * Fetch OB market snapshot from /game/view.
 */

import { login, fetchGameView } from "../session.js";

const DEFAULT_TOKEN = process.env.OB_TOKEN || "";

function parseArgs(argv) {
  if (argv[0] && !argv[0].startsWith("--")) {
    const url = new URL(argv[0]);
    return {
      gateway: `${url.protocol}//${url.host}`,
      matchId: url.searchParams.get("match_id"),
      stageId: Number(url.searchParams.get("stage_id") || 0),
      token: argv[1] || DEFAULT_TOKEN,
      skipLogin: Boolean(argv[1] || DEFAULT_TOKEN),
    };
  }

  const out = { token: DEFAULT_TOKEN, stageId: 0, skipLogin: Boolean(DEFAULT_TOKEN) };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--gateway") out.gateway = val;
    if (key === "--match") out.matchId = val;
    if (key === "--stage") out.stageId = Number(val);
    if (key === "--token") {
      out.token = val;
      out.skipLogin = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId) {
    console.error(
      "Usage: node fetch_ob_view.js --match ID [--stage N] [--token T]\n" +
        "   or: node fetch_ob_view.js <game/view url> [token]",
    );
    process.exit(1);
  }

  let session;
  if (args.skipLogin && args.gateway && args.token) {
    session = { gateway: args.gateway, token: args.token, lang: "cn" };
  } else {
    session = await login();
    if (args.gateway) session.gateway = args.gateway;
    if (args.token) session.token = args.token;
  }

  const { url, status, markets } = await fetchGameView(session, args.matchId, args.stageId);
  const report = {
    fetchedAt: new Date().toISOString(),
    provider: "OB",
    request: {
      url,
      httpStatus: status,
      matchId: args.matchId,
      stageId: args.stageId,
      gateway: session.gateway,
    },
    summary: {
      marketCount: markets.length,
      oddsCount: markets.reduce((n, m) => n + m.odds.length, 0),
      lockedCount: markets.filter((m) => m.locked).length,
      openCount: markets.filter((m) => !m.locked).length,
    },
    markets: markets.map((mk) => ({
      marketId: mk.marketId,
      oddTypeId: mk.oddTypeId,
      name: mk.marketName,
      round: mk.round,
      locked: mk.locked,
      status: mk.status,
      visible: mk.visible,
      suspended: mk.suspended,
      settleCount: mk.settleCount,
      marketStatus: mk.marketStatus,
      odds: mk.odds.map((o) => ({
        oddsId: o.oddsId,
        side: o.side,
        name: o.name,
        odd: o.odd,
      })),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, url: err.url }, null, 2));
  process.exit(1);
});
