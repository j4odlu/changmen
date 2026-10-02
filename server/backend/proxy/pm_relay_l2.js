/**
 * PM HK 出口：L2 签名在 VPS 完成（对齐官方文档「Never expose API secret in client-side」）。
 * 客户端只传 x-pm-account-id + x-pm-l2-path，relay 从 RDS 账号 token 构建 POLY_* 头。
 */
import { refreshAccountsFromRdsIfEmpty } from "../core/db/store.js";
import store from "../core/esport-api/store.js";
import { requireHttpUser } from "../core/auth/http_identity.js";
import { buildPolymarketL2HeadersFromToken } from "../core/integrations/polymarket/clob_l2.js";

function headerText(value) {
  if (value == null)
    return "";
  if (Array.isArray(value))
    return String(value[0] ?? "").trim();
  return String(value).trim();
}

async function fetchClobServerTime(targetUrl) {
  try {
    const origin = new URL(targetUrl).origin;
    const res = await fetch(`${origin}/time`, { signal: AbortSignal.timeout(5000) });
    const ts = Number(String(await res.text()).trim());
    return Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : undefined;
  }
  catch {
    return undefined;
  }
}

function findPolymarketAccount(accounts, accountId) {
  const want = String(accountId).trim();
  if (!want)
    return null;
  return accounts.find((row) => {
    const id = String(row.accountId ?? row.AccountId ?? "").trim();
    const provider = String(row.provider ?? "").trim().toLowerCase();
    return id === want && provider === "polymarket";
  }) ?? null;
}

/**
 * @returns {null | { headers: Record<string,string> } | { error: { status: number, msg: string } }}
 */
export async function resolvePmRelayL2Headers(req, { method, targetUrl, body = "" }) {
  const accountId = headerText(req.headers["x-pm-account-id"]);
  const l2Path = headerText(req.headers["x-pm-l2-path"]);
  if (!accountId || !l2Path)
    return null;

  const auth = await requireHttpUser(req, { alwaysCsrf: true });
  if (auth.error)
    return { error: { status: auth.error.status, msg: auth.error.body.error } };
  const user = auth.user;

  const userId = String(user.id ?? user.userId ?? "").trim();
  if (!userId)
    return { error: { status: 401, msg: "http-relay token invalid" } };

  await refreshAccountsFromRdsIfEmpty(userId);
  const account = findPolymarketAccount(store.getAccountsForUser(userId), accountId);
  if (!account?.token)
    return { error: { status: 403, msg: "pm account not found" } };

  const timestampOverride = await fetchClobServerTime(targetUrl);
  const headers = buildPolymarketL2HeadersFromToken(
    account.token,
    String(method || "GET").toUpperCase(),
    l2Path,
    body,
    timestampOverride,
  );
  if (!headers)
    return { error: { status: 403, msg: "pm L2 credentials missing in account token" } };

  return { headers };
}
