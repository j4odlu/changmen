#!/usr/bin/env node
"use strict";

const { tryLoadSession, fetchBalance } = require("../session.js");

async function main() {
  const session = tryLoadSession();
  if (!session) {
    console.error("缺少 HG_GATEWAY + HG_TOKEN（JSON: uid, ver）");
    process.exit(1);
  }
  const account = await fetchBalance(session);
  console.log(JSON.stringify(account, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
