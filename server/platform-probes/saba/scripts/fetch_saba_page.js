#!/usr/bin/env node
"use strict";

const { tryLoadSession, resolveWsConfig } = require("../session.js");

async function main() {
  const session = tryLoadSession();
  if (!session) {
    console.error("缺少 SABA_GATEWAY + SABA_TOKEN");
    process.exit(1);
  }
  const wsConfig = await resolveWsConfig(session);
  console.log(JSON.stringify({ session: { gateway: session.gateway, pageUrl: session.pageUrl }, wsConfig }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
