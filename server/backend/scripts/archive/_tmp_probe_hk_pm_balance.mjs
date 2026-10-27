#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { pullProfilesFromDb, loadAccountsForUser } from "../core/db/store.js";
import store from "../core/esport-api/store.js";
import { buildPolymarketL2HeadersFromToken } from "../core/integrations/polymarket/clob_l2.js";

loadChangmenEnv();
await pullProfilesFromDb();

const uid = String(process.argv[2] || "6ae8c38e-c4a2-4b2d-9896-733196115322");
const acctId = String(process.argv[3] || "47");
const hk = String(process.argv[4] || "http://47.57.10.202").replace(/\/+$/, "");

await loadAccountsForUser(uid);
const account = store.getAccountsForUser(uid).find((a) =>
  String(a.accountId ?? a.AccountId ?? "") === acctId);
if (!account?.token) {
  console.error("no account");
  process.exit(1);
}

const sigType = 3;
const targetUrl = `https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL&signature_type=${sigType}`;
const ts = Math.floor(Number(String(await (await fetch("https://clob.polymarket.com/time")).text()).trim()));
const headers = buildPolymarketL2HeadersFromToken(account.token, "GET", "/balance-allowance", "", ts);

const direct = await fetch(targetUrl, { headers });
console.log("direct_l2", direct.status, (await direct.text()).slice(0, 120));

const { getPgPool } = await import("@changmen/db");
const { JWT_SECRET, signJwt, JWT_ACCESS_TTL_SEC } = await import("../../db/rds/jwt.js");
const pool = getPgPool();
const { rows: userRows } = await pool.query(
  "SELECT metadata->>'active_session_id' AS sid FROM users WHERE id = $1::uuid",
  [uid],
);
const sessionId = userRows[0]?.sid;
if (!sessionId) {
  console.error("no active session for", uid);
  process.exit(1);
}
const jwt = signJwt({ sub: uid, typ: "access", session_id: String(sessionId) }, JWT_SECRET, JWT_ACCESS_TTL_SEC);

const relayRes = await fetch(`${hk}/esport/http-relay`, {
  headers: {
    token: jwt,
    "x-proxy-url": targetUrl,
    "x-proxy-referer": "https://polymarket.com/",
    "x-proxy-origin": "https://polymarket.com",
    "x-pm-account-id": acctId,
    "x-pm-l2-path": "/balance-allowance",
  },
});
const relayText = await relayRes.text();
console.log("hk_relay_l2", relayRes.status, relayText.slice(0, 200));

const timeRes = await fetch(`${hk}/esport/http-relay`, {
  headers: {
    token: jwt,
    "x-proxy-url": "https://clob.polymarket.com/time",
    "x-proxy-referer": "https://polymarket.com/",
    "x-proxy-origin": "https://polymarket.com",
  },
});
const timeText = await timeRes.text();
console.log("hk_relay_time", timeRes.status, timeText.slice(0, 120));

for (const base of ["http://127.0.0.1:3560", "http://127.0.0.1:3456"]) {
  try {
    const localRes = await fetch(`${base}/esport/http-relay`, {
      headers: {
        token: jwt,
        "x-proxy-url": targetUrl,
        "x-proxy-referer": "https://polymarket.com/",
        "x-proxy-origin": "https://polymarket.com",
        "x-pm-account-id": acctId,
        "x-pm-l2-path": "/balance-allowance",
      },
      signal: AbortSignal.timeout(15000),
    });
    const localText = await localRes.text();
    console.log("local_relay", base, localRes.status, localText.slice(0, 200));
  }
  catch (err) {
    console.log("local_relay", base, "ERR", err instanceof Error ? err.message : String(err));
  }
}
