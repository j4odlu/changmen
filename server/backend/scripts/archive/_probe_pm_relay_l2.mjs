#!/usr/bin/env node
/** One-off: PM HK relay L2 balance probe (VPS) */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { loadAccountsForUser, listProfileRows, pullProfilesFromDb } from "../core/db/store.js";
import store from "../core/esport-api/store.js";
import { buildPolymarketL2HeadersFromToken } from "../core/integrations/polymarket/clob_l2.js";

loadChangmenEnv();

await pullProfilesFromDb();

const userId = String(process.argv[2] || "").trim();
const accountId = String(process.argv[3] || "").trim();

async function fetchClobServerTime() {
  const res = await fetch("https://clob.polymarket.com/time", { signal: AbortSignal.timeout(8000) });
  return Math.floor(Number(String(await res.text()).trim()));
}

async function main() {
  let uid = userId;
  let acctId = accountId;
  let account;

  if (uid && acctId) {
    await loadAccountsForUser(uid);
    account = store.getAccountsForUser(uid).find((row) => {
      const id = String(row.accountId ?? row.AccountId ?? "").trim();
      const provider = String(row.provider ?? "").trim().toLowerCase();
      return id === acctId && provider === "polymarket";
    });
  }
  else {
    const { getPgPool } = await import("@changmen/db");
    const pool = getPgPool();
    const { rows } = await pool.query(
      `SELECT id, owner_user_id, provider FROM players
       WHERE deleted_at IS NULL AND lower(provider) = 'polymarket'
       ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
    );
    for (const row of rows) {
      uid = String(row.owner_user_id);
      acctId = String(row.id);
      await loadAccountsForUser(uid);
      account = store.getAccountsForUser(uid).find((a) =>
        String(a.accountId ?? a.AccountId ?? "") === acctId);
      if (account?.token) break;
    }
    if (!account?.token) {
      for (const prow of listProfileRows().slice(0, 200)) {
        const id = String(prow.id ?? prow.userId ?? "").trim();
        if (!id) continue;
        await loadAccountsForUser(id);
        const pm = store.getAccountsForUser(id).find((row) =>
          String(row.provider ?? "").trim().toLowerCase() === "polymarket" && row.token);
        if (pm) {
          uid = id;
          acctId = String(pm.accountId ?? pm.AccountId ?? "");
          account = pm;
          break;
        }
      }
    }
  }

  if (!account?.token) {
    console.error("no polymarket account found");
    process.exit(1);
  }

  const sigType = 3;
  const targetUrl = `https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL&signature_type=${sigType}`;
  const ts = await fetchClobServerTime();
  const headers = buildPolymarketL2HeadersFromToken(account.token, "GET", "/balance-allowance", "", ts);
  if (!headers) {
    console.error("L2 creds missing in token");
    process.exit(1);
  }

  console.log("userId", uid, "accountId", acctId, "poly_address", headers.POLY_ADDRESS?.slice(0, 12));

  const direct = await fetch(targetUrl, { headers });
  const directText = await direct.text();
  console.log("direct_clob", direct.status, directText.slice(0, 160));

  const relayRes = await fetch("http://127.0.0.1:3456/esport/http-relay", {
    headers: {
      token: process.env.PROBE_TOKEN || "probe-no-token",
      "x-proxy-url": targetUrl,
      "x-proxy-referer": "https://polymarket.com/",
      "x-proxy-origin": "https://polymarket.com",
      "x-pm-account-id": acctId,
      "x-pm-l2-path": "/balance-allowance",
    },
  });
  const relayText = await relayRes.text();
  console.log("relay_l2", relayRes.status, relayText.slice(0, 160));

  const { JWT_SECRET, signJwt, JWT_ACCESS_TTL_SEC } = await import("@changmen/db/rds/jwt.js");
  if (JWT_SECRET) {
    const jwt = signJwt({ sub: uid, typ: "access", session_id: "probe" }, JWT_SECRET, JWT_ACCESS_TTL_SEC);
    const relayOk = await fetch("http://127.0.0.1:3456/esport/http-relay", {
      headers: {
        token: jwt,
        "x-proxy-url": targetUrl,
        "x-proxy-referer": "https://polymarket.com/",
        "x-proxy-origin": "https://polymarket.com",
        "x-pm-account-id": acctId,
        "x-pm-l2-path": "/balance-allowance",
      },
    });
    const relayOkText = await relayOk.text();
    console.log("relay_l2_signed", relayOk.status, relayOkText.slice(0, 160));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
