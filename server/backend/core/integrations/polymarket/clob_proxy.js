/**
 * Polymarket HTTP 代理（VPS 直连，不经 http-relay）
 */
import { buildPolymarketL2HeadersFromToken } from "./clob_l2.js";
import { clobTimestamp, prepareClobClock } from "./clob_clock.js";

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
 *   clientL2Timestamp?: number,
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

  const authStart = performance.now();
  let authHeaders = null;
  if (l2Path && input?.accountToken) {
    // POST /order 不得重新校时；冷启动准备由预检负责。
    if (!(method === "POST" && l2Path === "/order")) await prepareClobClock(url);
    let timestamp;
    if (input.clientL2Timestamp !== undefined) {
      if (method !== "POST" || l2Path !== "/order"
        || !Number.isSafeInteger(input.clientL2Timestamp) || input.clientL2Timestamp <= 0)
        throw new Error("PM 客户端签名时间无效");
      // 扩展在发出 HTTP 前断连：沿用该路径的客户端时钟，由服务端用所属账号重新生成 HMAC。
      timestamp = input.clientL2Timestamp;
    } else timestamp = clobTimestamp(url);
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

  const authMs = performance.now() - authStart;
  const postStart = performance.now();
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
  return { status: res.status, text, timing: { authMs, upstreamMs: performance.now() - postStart }, ...(Object.keys(responseHeaders).length ? { headers: responseHeaders } : {}) };
}
