#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { getPgPool } from "@changmen/db";
import { signJwt, JWT_SECRET, JWT_ACCESS_TTL_SEC } from "../../db/rds/jwt.js";
import { generatePrivateKey } from "viem/accounts";

loadChangmenEnv();

const userId = process.argv[2] || "6ae8c38e-c4a2-4b2d-9896-733196115322";
const apiBase = (process.argv[3] || "http://127.0.0.1:3456").replace(/\/+$/, "");

const pool = getPgPool();
const { rows } = await pool.query(
  "SELECT metadata->>'active_session_id' AS sid FROM users WHERE id = $1::uuid",
  [userId],
);
const sessionId = rows[0]?.sid;
if (!sessionId) {
  console.error("no session");
  process.exit(1);
}

const token = signJwt(
  { sub: userId, typ: "access", session_id: String(sessionId) },
  JWT_SECRET,
  JWT_ACCESS_TTL_SEC,
);
const privateKey = generatePrivateKey();

const res = await fetch(`${apiBase}/api/polymarket/clob/create-or-derive-api-creds`, {
  method: "POST",
  headers: { "Content-Type": "application/json", token },
  body: JSON.stringify({ privateKey }),
});
const text = await res.text();
console.log("status", res.status);
console.log(text.slice(0, 300));
