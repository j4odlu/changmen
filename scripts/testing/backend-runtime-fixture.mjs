// [changmen 扩展] Test preload only. Real process entries and modules remain unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
assert.equal(process.platform, "linux");
assert.equal(process.env.CM_TEST_NETWORK_NAMESPACE, "1");
assert(Object.values(os.networkInterfaces()).flat().every(item => item.internal), "External network interface in runtime fixture");
assert.equal(process.env.DATABASE_URL_PUBLIC, ""); assert.equal(process.env.DATABASE_URL_INTERNAL, "");
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.searchParams.get("host"), process.env.CM_TEST_DATABASE_SOCKET, "Only the disposable Unix database socket is allowed");
} else assert.equal(process.env.CM_TEST_ALLOW_MISSING_DB, "1");
const requests = process.env.CM_TEST_REQUEST_LOG;
assert(requests && requests.startsWith("/tmp/changmen-linux-check-"));
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = String(options.method || input?.method || "GET").toUpperCase();
  const blockedOrder = /\/(?:order|orders|bet|bets)(?:\/|$)/i.test(url.pathname);
  fs.appendFileSync(requests, JSON.stringify({ hostname: url.hostname, pathname: url.pathname, method, mocked: true, blockedOrder }) + "\n");
  assert(!blockedOrder, "Order/bet requests are forbidden in startup fixture");
  let data = [];
  if (url.pathname.includes("/categories")) data = { data: [], cursor: null };
  else if (url.pathname.endsWith("/events/keyset")) data = { events: [], next_cursor: "" };
  else if (url.pathname.endsWith("/sports")) data = [{ sport: "cs2", series: "10310" }, { sport: "epl", series: "10188" }];
  else if (url.pathname.includes("market-types")) data = { market_types: ["moneyline", "child_moneyline"] };
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
};
