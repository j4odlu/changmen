#!/usr/bin/env node
"use strict";

const { tryLoadSession, fetchAllSports } = require("../session.js");

async function main() {
  const session = tryLoadSession();
  if (!session) {
    console.error("缺少 STAKE_ACCESS_TOKEN（或 platforms.json Stake）");
    process.exit(1);
  }
  const rows = await fetchAllSports(session);
  console.log(JSON.stringify({ count: rows.length, matches: rows }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
