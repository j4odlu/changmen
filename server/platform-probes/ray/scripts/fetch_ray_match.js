#!/usr/bin/env node

import { login, fetchMatchPage } from "../session.js";
import * as Core from "../core.js";

async function main() {
  const session = await login();
  console.log(JSON.stringify({ gateway: session.gateway, origin: session.origin }, null, 2));
  const rows = await fetchMatchPage(session, 1);
  const matches = rows
    .map((r) => Core.normalizeMatchListItem(r, { gameIds: session.gameIds }))
    .filter(Boolean);
  console.log(`matches: ${matches.length} (page 1 raw ${rows.length})`);
  console.log(JSON.stringify(matches.slice(0, 5), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
