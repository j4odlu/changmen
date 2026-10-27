#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { authGetUser, getPgPool } from "@changmen/db";
import { signJwt, JWT_SECRET, JWT_ACCESS_TTL_SEC } from "../../db/rds/jwt.js";

loadChangmenEnv();

const userId = process.argv[2] || "6ae8c38e-c4a2-4b2d-9896-733196115322";
const accountId = process.argv[3] || "47";

const pool = getPgPool();
const { rows } = await pool.query(
  "SELECT metadata->>'active_session_id' AS sid FROM users WHERE id = $1::uuid",
  [userId],
);
const sessionId = rows[0]?.sid;
if (!sessionId) {
  console.error("no active session for", userId);
  process.exit(1);
}

const token = signJwt(
  { sub: userId, typ: "access", session_id: String(sessionId) },
  JWT_SECRET,
  JWT_ACCESS_TTL_SEC,
);
const auth = await authGetUser(token);
console.log("auth", auth);

const targetUrl = "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL&signature_type=3";
const relayRes = await fetch("http://127.0.0.1:3456/esport/http-relay", {
  headers: {
    token,
    "x-proxy-url": targetUrl,
    "x-proxy-referer": "https://polymarket.com/",
    "x-proxy-origin": "https://polymarket.com",
    "x-pm-account-id": accountId,
    "x-pm-l2-path": "/balance-allowance",
  },
});
const text = await relayRes.text();
console.log("relay", relayRes.status, text.slice(0, 200));
