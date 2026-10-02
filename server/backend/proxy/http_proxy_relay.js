import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import { URL } from "node:url";
import zlib from "node:zlib";
import { resolvePmRelayL2Headers } from "./pm_relay_l2.js";
import { requireHttpUser } from "../core/auth/http_identity.js";

const require = createRequire(import.meta.url);

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "")
    return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envList(name, fallback = []) {
  const raw = String(process.env[name] || "").trim();
  if (!raw)
    return fallback;
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

const RELAY_REQUIRE_TOKEN = envFlag("HTTP_RELAY_REQUIRE_TOKEN", false);
const RELAY_ALLOW_PRIVATE = envFlag("HTTP_RELAY_ALLOW_PRIVATE", false);
const RELAY_ALLOWED_HOSTS = envList("HTTP_RELAY_ALLOWED_HOSTS");
const RELAY_ALLOWED_PATH_PREFIXES = envList("HTTP_RELAY_ALLOWED_PATH_PREFIXES", ["/"]);

function sendRelayError(res, status, msg) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ success: 0, msg }));
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host)
    return true;
  if (host === "localhost" || host.endsWith(".localhost"))
    return true;
  const ipVersion = net.isIP(host);
  if (!ipVersion)
    return false;
  if (ipVersion === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 169 && parts[1] === 254)
      || parts[0] === 0;
  }
  return host === "::1"
    || host === "::"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || host.startsWith("fe80:");
}

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!RELAY_ALLOWED_HOSTS.length)
    return true;
  return RELAY_ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function pathAllowed(pathname) {
  if (!RELAY_ALLOWED_PATH_PREFIXES.length)
    return true;
  return RELAY_ALLOWED_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix.startsWith("/") ? prefix : `/${prefix}`));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 5e6) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function createDispatcher(proxyUrl) {
  if (!proxyUrl)
    return null;
  try {
    const { SocksProxyAgent } = require("socks-proxy-agent");
    return new SocksProxyAgent(proxyUrl);
  }
  catch {
    return null;
  }
}

function nodeFetch(url, options = {}) {
  if (isPolymarketUpstream(url) && typeof globalThis.fetch === "function")
    return nodeFetchViaFetch(url, options);
  return nodeFetchViaHttp(url, options);
}

function nodeFetchViaFetch(url, options = {}) {
  return (async () => {
    const rawHeaders = options.headers || {};
    const headerObj = Array.isArray(rawHeaders)
      ? Object.fromEntries(rawHeaders.map(([k, v]) => [k, String(v)]))
      : rawHeaders;
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: headerObj,
      body: options.body ?? undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, headers, body };
  })();
}

function nodeFetchViaHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      parsed,
      {
        method: options.method || "GET",
        headers: upstreamHeadersForNodeHttp(url, options.headers || {}),
        agent: options.dispatcher || undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body)
      req.write(options.body);
    req.end();
  });
}

function resolveTargetUrl(proxyUrlHeader, baseOrigin) {
  if (!proxyUrlHeader)
    return null;
  if (/^https?:\/\//i.test(proxyUrlHeader))
    return proxyUrlHeader;
  const path = proxyUrlHeader.startsWith("/") ? proxyUrlHeader : `/${proxyUrlHeader}`;
  return `${baseOrigin}${path}`;
}

function validateTargetUrl(targetUrl, opts = {}) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  }
  catch {
    return { ok: false, status: 400, msg: "invalid proxy target url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return { ok: false, status: 400, msg: "proxy target protocol not allowed" };
  if (isPolymarketUpstream(targetUrl))
    return { ok: false, status: 403, msg: "Polymarket 已迁出 http-relay，请用 Pm_HttpRequest" };
  const allowedLocalPath = opts.relative && (parsed.pathname === "/IP" || parsed.pathname === "/IP/Address");
  if (!RELAY_ALLOW_PRIVATE && !allowedLocalPath && isPrivateHostname(parsed.hostname))
    return { ok: false, status: 403, msg: "proxy target private host not allowed" };
  if (!hostAllowed(parsed.hostname))
    return { ok: false, status: 403, msg: "proxy target host not allowed" };
  if (!pathAllowed(parsed.pathname))
    return { ok: false, status: 403, msg: "proxy target path not allowed" };
  return { ok: true };
}

const RELAY_STRIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "x-proxy",
  "x-proxy-url",
  "x-proxy-referer",
  "x-proxy-useragent",
  "x-proxy-origin",
  "x-pm-account-id",
  "x-pm-l2-path",
  // 浏览器 fetch 会带 gzip；relay 只回写 Content-Type 时会导致压缩体无法解压
  "accept-encoding",
  // changmen JWT（仅用于 relay 鉴权，不可转发到上游）
  "token",
  "cookie",
  // 浏览器同源请求会带 changmen 的 referer/origin，与扩展直连 PM 不一致
  "referer",
  "origin",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "priority",
  "x-requested-with",
]);

/** Node 会把入站 header 小写化；Polymarket L2 期望 POLY_* 大写 */
const POLY_HEADER_CANONICAL = {
  "poly_address": "POLY_ADDRESS",
  "poly_signature": "POLY_SIGNATURE",
  "poly_timestamp": "POLY_TIMESTAMP",
  "poly_nonce": "POLY_NONCE",
  "poly_api_key": "POLY_API_KEY",
  "poly_passphrase": "POLY_PASSPHRASE",
};

const POLY_UPSTREAM_HEADERS = [
  "POLY_ADDRESS",
  "POLY_SIGNATURE",
  "POLY_TIMESTAMP",
  "POLY_NONCE",
  "POLY_API_KEY",
  "POLY_PASSPHRASE",
];

function headerValue(value) {
  if (value == null)
    return undefined;
  if (Array.isArray(value))
    return String(value[0] ?? "").trim() || undefined;
  const text = String(value).trim();
  return text || undefined;
}

function isPolymarketUpstream(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return host === "polymarket.com" || host.endsWith(".polymarket.com");
  }
  catch {
    return false;
  }
}

/** 对齐 @polymarket/clob-client-v2 http-helpers overloadHeaders（Node 非浏览器） */
const PM_CLOB_USER_AGENT = "@polymarket/clob-client";

function polymarketSdkTransportHeaders(req, method) {
  const out = {
    "User-Agent": headerValue(req.headers["x-proxy-useragent"]) || PM_CLOB_USER_AGENT,
    Accept: "*/*",
    Connection: "keep-alive",
    "Content-Type": "application/json",
  };
  if (String(method || "GET").toUpperCase() === "GET")
    out["Accept-Encoding"] = "gzip";
  return out;
}

/** relay L2 签名路径原先只带 POLY_*；缺 SDK transport 头时 Cloudflare 会 400 */
function mergePolymarketUpstreamHeaders(req, authHeaders, method) {
  return {
    ...polymarketSdkTransportHeaders(req, method),
    ...authHeaders,
  };
}

/** 对齐扩展 background axios 直连 PM：L1 四头 + L2 五头 + Host */
function forwardPolymarketHeaders(req, targetUrl) {
  const raw = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (RELAY_STRIP_HEADERS.has(lower))
      continue;
    const outKey = POLY_HEADER_CANONICAL[lower] || key;
    const text = headerValue(value);
    if (text)
      raw[outKey] = text;
  }
  const out = {};
  for (const name of POLY_UPSTREAM_HEADERS) {
    const text = raw[name];
    if (text)
      out[name] = text;
  }
  try {
    out.Host = new URL(targetUrl).host;
  }
  catch {
    /* ignore */
  }
  return out;
}

/**
 * Node http.request 用对象传 headers 会把键名小写化；Polymarket L2 期望 POLY_* 大写。
 * 对 PM 上游改用 [name, value] 数组格式保留大小写（见 Node _http_client.js）。
 */
function upstreamHeadersForNodeHttp(targetUrl, headersObj) {
  const entries = Object.entries(headersObj || {})
    .filter(([, value]) => value != null && String(value).length);
  if (!isPolymarketUpstream(targetUrl))
    return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
  return entries.map(([key, value]) => [key, String(value)]);
}

function isPredictFunUpstream(targetUrl) {
  try {
    const host = new URL(String(targetUrl || "")).hostname.toLowerCase();
    return host === "api.predict.fun" || host === "api-testnet.predict.fun";
  }
  catch {
    return false;
  }
}

function injectPredictFunApiKey(headers, targetUrl) {
  if (!isPredictFunUpstream(targetUrl))
    return headers;
  const hasKey = Boolean(
    headerValue(headers["x-api-key"])
    || headerValue(headers["X-Api-Key"])
    || headerValue(headers["X-API-KEY"]),
  );
  if (hasKey)
    return headers;
  const serverKey = String(process.env.PREDICT_FUN_API_KEY || process.env.VITE_PREDICT_FUN_API_KEY || "").trim();
  if (!serverKey)
    return headers;
  return { ...headers, "x-api-key": serverKey };
}

function forwardHeaders(req, targetUrl) {
  if (isPolymarketUpstream(targetUrl))
    return forwardPolymarketHeaders(req, targetUrl);

  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (RELAY_STRIP_HEADERS.has(lower))
      continue;
    const outKey = POLY_HEADER_CANONICAL[lower] || key;
    const text = headerValue(value);
    if (text)
      out[outKey] = text;
  }
  const referer = req.headers["x-proxy-referer"];
  if (referer)
    out.Referer = referer;
  const origin = req.headers["x-proxy-origin"];
  if (origin) {
    out.Origin = origin;
  }
  else if (referer) {
    try {
      out.Origin = new URL(String(referer)).origin;
    }
    catch {
      /* ignore */
    }
  }
  const ua = req.headers["x-proxy-useragent"];
  if (ua)
    out["User-Agent"] = ua;
  else if (req.headers["user-agent"])
    out["User-Agent"] = String(req.headers["user-agent"]);
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth)
    out.Authorization = String(auth);
  try {
    out.Host = new URL(targetUrl).host;
  }
  catch {
    /* ignore */
  }
  // 浏览器未带 Key 时，用 VPS PREDICT_FUN_API_KEY 补齐（预检 orderbook 主网强制鉴权）
  return injectPredictFunApiKey(out, targetUrl);
}

const RELAY_PATH = "/esport/http-relay";

/**
 * A8 mr.get/post/test：向 relay 发请求，用 x-proxy-url 指定真实目标 URL。
 */
async function tryHttpProxyRelay(req, res, baseOrigin) {
  const pathname = req.url.split("?")[0];
  if (pathname !== RELAY_PATH)
    return false;

  if (RELAY_REQUIRE_TOKEN || req.headers["x-changmen-auth"] === "cookie") {
    const auth = await requireHttpUser(req, { alwaysCsrf: true });
    if (auth.error) {
      sendRelayError(res, auth.error.status, auth.error.body.error);
      return true;
    }
  }

  const proxyTarget = req.headers["x-proxy-url"];
  if (!proxyTarget)
    return false;

  const proxyTargetString = String(proxyTarget);
  const relativeTarget = !/^https?:\/\//i.test(proxyTargetString);
  const targetUrl = resolveTargetUrl(proxyTargetString, baseOrigin);
  if (!targetUrl)
    return false;
  const targetCheck = validateTargetUrl(targetUrl, { relative: relativeTarget });
  if (!targetCheck.ok) {
    sendRelayError(res, targetCheck.status, targetCheck.msg);
    return true;
  }

  const dispatcher = createDispatcher(req.headers["x-proxy"]);
  const requestBody = req.method !== "GET" && req.method !== "HEAD" ? await readRequestBody(req) : undefined;
  const bodyText = requestBody ? requestBody.toString("utf8") : "";
  const pmL2 = await resolvePmRelayL2Headers(req, {
    method: req.method,
    targetUrl,
    body: bodyText,
  });
  if (pmL2?.error) {
    sendRelayError(res, pmL2.error.status, pmL2.error.msg);
    return true;
  }
  const authHeaders = pmL2?.headers ?? forwardHeaders(req, targetUrl);
  const headers = isPolymarketUpstream(targetUrl)
    ? mergePolymarketUpstreamHeaders(req, authHeaders, req.method)
    : authHeaders;

  try {
    const upstream = await nodeFetch(targetUrl, {
      method: req.method,
      headers,
      body: requestBody,
      dispatcher,
    });
    let responseBody = upstream.body;
    const encoding = String(upstream.headers["content-encoding"] || "").toLowerCase();
    if (encoding.includes("gzip")) {
      try {
        responseBody = zlib.gunzipSync(responseBody);
      }
      catch {
        /* keep raw body */
      }
    }
    else if (encoding.includes("deflate")) {
      try {
        responseBody = zlib.inflateSync(responseBody);
      }
      catch {
        /* keep raw body */
      }
    }
    else if (responseBody.length >= 2 && responseBody[0] === 0x1F && responseBody[1] === 0x8B) {
      // 上游 gzip 但未带 Content-Encoding（部分 CDN）
      try {
        responseBody = zlib.gunzipSync(responseBody);
      }
      catch {
        /* keep raw body */
      }
    }
    const ct = upstream.headers["content-type"] || "application/json; charset=utf-8";
    res.writeHead(upstream.status, { "Content-Type": ct });
    res.end(responseBody);
    return true;
  }
  catch (err) {
    sendRelayError(res, 502, err.message || "proxy relay failed");
    return true;
  }
}

export { RELAY_PATH, tryHttpProxyRelay };
