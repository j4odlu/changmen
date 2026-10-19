#!/usr/bin/env node

import { RayWsClient } from "../ws.js";

async function main() {
  const client = new RayWsClient();
  let n = 0;
  client.onOdds((odds) => {
    console.log("[odds]", JSON.stringify(odds).slice(0, 300));
    n += 1;
  });
  client.onMatch((match) => {
    console.log("[match]", JSON.stringify(match).slice(0, 300));
  });
  const ok = await client.connect();
  console.log("connected:", ok);
  if (!ok && client.lastError) {
    console.log("error:", client.lastError.message || client.lastError);
  }
  await new Promise((r) => setTimeout(r, 15000));
  console.log("messages:", n);
  client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
