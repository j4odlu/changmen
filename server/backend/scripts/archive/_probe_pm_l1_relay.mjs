#!/usr/bin/env node
/**
 * 用真实 L1 签名探测 relay → CLOB /auth/api-key。
 * node scripts/_probe_pm_l1_relay.mjs [userId] [relayBase]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { getPgPool } from "@changmen/db";
import { signJwt, JWT_SECRET, JWT_ACCESS_TTL_SEC } from "../../db/rds/jwt.js";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createL1Headers, Chain } from "@polymarket/clob-client-v2";

loadChangmenEnv();

const userId = process.argv[2] || "6ae8c38e-c4a2-4b2d-9896-733196115322";
const relayBase = (process.argv[3] || "http://127.0.0.1:3456").replace(/\/+$/, "");
const gateway = "https://clob.polymarket.com";

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

const testKey = generatePrivateKey();
const account = privateKeyToAccount(testKey);
const signer = createWalletClient({ account, chain: polygon, transport: http() });
const l1 = Object.fromEntries(
  Object.entries(await createL1Headers(signer, Chain.POLYGON)).map(([k, v]) => [k, String(v)]),
);
console.log("signer", account.address);
console.log("l1 keys", Object.keys(l1));

async function call(label, url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  console.log(label, res.status, text.slice(0, 240));
}

await call("direct-post", `${gateway}/auth/api-key`, {
  method: "POST",
  headers: l1,
});

await call("relay-post", `${relayBase}/esport/http-relay`, {
  method: "POST",
  headers: {
    token,
    "x-proxy-url": `${gateway}/auth/api-key`,
    "x-proxy-referer": "https://polymarket.com/",
    "x-proxy-origin": "https://polymarket.com",
    ...l1,
  },
});

await call("relay-get-derive", `${relayBase}/esport/http-relay`, {
  method: "GET",
  headers: {
    token,
    "x-proxy-url": `${gateway}/auth/derive-api-key`,
    "x-proxy-referer": "https://polymarket.com/",
    "x-proxy-origin": "https://polymarket.com",
    ...l1,
  },
});
