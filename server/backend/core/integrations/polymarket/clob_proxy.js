/**
 * Polymarket HTTP 代理（VPS 直连，不经 http-relay）
 */
import { buildPolymarketL2HeadersFromToken } from "./clob_l2.js";

const PM_CLOB_USER_AGENT = "@polymarket/clob-client";
const PM_CLOB_FETCH_TIMEOUT_MS = 60_000;
/** POST /order 只等 ACK（官方 delayed 立刻返回）；须小于客户端 Pm_SubmitOrder 30s */
export const PM_SUBMIT_ORDER_POST_TIMEOUT_MS = 20_000;
const POLY_HEADER_NAMES = [
  "POLY_ADDRESS",
  "POLY_SIGNATURE",
  "POLY_TIMESTAMP",
  // Required by CLOB L1 create/derive api-key authentication.
  "POLY_NONCE",
  "POLY_API_KEY",
  "POLY_PASSPHRASE",
];

export function isAllowedPolymarketUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:")
      return false;
    const host = parsed.hostname.toLowerCase();
    return host === "polymarket.com" || host.endsWith(".polymarket.com");
  }
  catch {
    return false;
  }
}

function polymarketSdkTransportHeaders(method) {
  const out = {
    "User-Agent": PM_CLOB_USER_AGENT,
    "Accept": "*/*",
    "Connection": "keep-alive",
  };
  if (String(method || "GET").toUpperCase() === "GET")
    out["Accept-Encoding"] = "gzip";
  return out;
}

async function fetchClobServerTimeFromUrl(url) {
  try {
    const origin = new URL(url).origin;
    const res = await fetch(`${origin}/time`, { signal: AbortSignal.timeout(8000) });
    const ts = Number(String(await res.text()).trim());
    return Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : undefined;
  }
  catch {
    return undefined;
  }
}

function normalizeRequestBody(body) {
  if (body === undefined || body === null)
    return "";
  if (typeof body === "string")
    return body;
  return JSON.stringify(body);
}

export function pickPolymarketPolyHeaders(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const out = {};
  for (const name of POLY_HEADER_NAMES) {
    const value = raw[name] ?? raw[name.toLowerCase()];
    if (value != null && String(value).trim())
      out[name] = String(value);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param {{
 *   method?: string,
 *   url: string,
 *   l2Path?: string,
 *   accountToken?: string,
 *   polyHeaders?: Record<string, string> | null,
 *   body?: unknown,
 *   timeoutMs?: number,
 * }} input
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function executePolymarketHttpRequest(input) {
  const url = String(input?.url ?? "").trim();
  if (!url)
    throw new Error("url 必填");
  if (!isAllowedPolymarketUrl(url))
    throw new Error("URL 不在 Polymarket 允许列表");

  const method = String(input?.method || "GET").toUpperCase();
  const bodyText = normalizeRequestBody(input?.body);
  const l2Path = String(input?.l2Path ?? "").trim();
  const timeoutMs = Number(input?.timeoutMs);
  const fetchTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : PM_CLOB_FETCH_TIMEOUT_MS;

  let authHeaders = null;
  if (l2Path && input?.accountToken) {
    const timestamp = await fetchClobServerTimeFromUrl(url);
    authHeaders = buildPolymarketL2HeadersFromToken(
      input.accountToken,
      method,
      l2Path,
      bodyText,
      timestamp,
    );
    if (!authHeaders)
      throw new Error("PM L2 凭据不完整");
  }
  else {
    authHeaders = pickPolymarketPolyHeaders(input?.polyHeaders);
  }

  const headers = {
    ...polymarketSdkTransportHeaders(method),
    ...(authHeaders || {}),
  };
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
    headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyText || undefined,
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  const text = await res.text();
  // Public response metadata only; do not forward cookies/auth headers.
  const responseHeaders = {};
  for (const name of ["retry-after", "x-trace-id"]) {
    const value = res.headers?.get?.(name);
    if (value)
      responseHeaders[name] = value;
  }
  return { status: res.status, text, ...(Object.keys(responseHeaders).length ? { headers: responseHeaders } : {}) };
}
