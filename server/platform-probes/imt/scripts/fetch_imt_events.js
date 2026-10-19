#!/usr/bin/env node
"use strict";

const { loadSession, fetchAllLiveEvents } = require("../session.js");
const Core = require("../core.js");

async function main() {
  const session = loadSession();
  const data = await fetchAllLiveEvents(session, session.sportIds);
  const parsed = Core.normalizeFullPayload(data);
  console.log(
    JSON.stringify(
      {
        gateway: session.gateway,
        sportIds: session.sportIds,
        matchCount: parsed.matches.length,
        delta: parsed.delta ? "present" : null,
        sample: parsed.matches.slice(0, 2),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
