import { requireHttpUser } from "./http_identity.js";
import { loadAccountsForUserStrict } from "../db/store.js";
import { jsonResponse } from "../http/body.js";
import { authGetUserStatus } from "@changmen/db";

/** [changmen 扩展] 插件只核验身份/PM 账号归属；不接收任何钱包材料。 */
export async function tryPmWalletIdentity(req, res) {
  if (String(req.url || "").split("?")[0] !== "/auth/pm-wallet-identity") return false;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { jsonResponse(res, 405, { code: "METHOD_NOT_ALLOWED" }); return true; }
  const auth = await requireHttpUser(req, {}, { authGetUserStatus: token => authGetUserStatus(token, { fresh: true }) });
  if (auth.error) { jsonResponse(res, auth.error.status, auth.error.body); return true; }
  if (!auth.identity?.loginEpoch) { jsonResponse(res, 401, { code: "AUTH_REQUIRED" }); return true; }
  try {
    const rows = await loadAccountsForUserStrict(auth.user.id);
    const accounts = rows.filter(row => ["polymarket", "pm"].includes(String(row.provider).trim().toLowerCase())).map(row => {
      let config = {};
      try { config = JSON.parse(String(row.token || "{}")); } catch { /* no address => cannot retain */ }
      const walletAddress = String(config.walletAddress || config.address || "").toLowerCase();
      return { accountId: Number(row.accountId), walletAddress: /^0x[0-9a-f]{40}$/.test(walletAddress) ? walletAddress : "" };
    });
    jsonResponse(res, 200, { userId: String(auth.user.id), loginEpoch: auth.identity.loginEpoch, accounts });
  } catch { jsonResponse(res, 503, { code: "TEMPORARY_UNAVAILABLE" }); }
  return true;
}
