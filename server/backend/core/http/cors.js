/**
 * 步骤 2：页面站 → API 子域跨源（https://changmen.fun → https://api.changmen.fun）。
 * 仅当请求带 Origin 且命中白名单时回 CORS 头；同源相对路径不带 Origin，无影响。
 */
import { jsonResponse } from "./body.js";

const DEFAULT_ALLOWED = [
  "https://changmen.fun",
  "https://www.changmen.fun",
];

/** @returns {Set<string>} */
export function getCorsAllowedOrigins() {
  const raw = String(process.env.CORS_ALLOWED_ORIGINS || "").trim();
  const list = raw
    ? raw.split(/[,;\s]+/).map(s => s.trim().replace(/\/+$/, "")).filter(Boolean)
    : DEFAULT_ALLOWED;
  return new Set(list);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {string|null} 回显用的 Origin，未允许则 null
 */
export function resolveCorsAllowOrigin(req) {
  const origin = String(req.headers.origin || "").trim().replace(/\/+$/, "");
  if (!origin)
    return null;
  return getCorsAllowedOrigins().has(origin) ? origin : null;
}

/**
 * 在尚未 writeHead 前挂上 CORS（与后续 writeHead 合并）。
 * @returns {boolean} 是否对当前 Origin 放行
 */
export function applyCorsHeaders(req, res) {
  const allow = resolveCorsAllowOrigin(req);
  if (!allow)
    return false;
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "token",
      "Token",
      "Authorization",
      "X-Requested-With",
      "X-CSRF-Token",
      // http-relay / 采集代理常用
      "x-proxy-url",
      "x-proxy-origin",
      "x-proxy-token",
    ].join(", "),
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  return true;
}

/**
 * OPTIONS 预检：放行则 204；有 Origin 但不在白名单则 403；无 Origin 则不当作 CORS 预检。
 * @returns {boolean} 已处理并结束响应
 */
export function tryHandleCorsPreflight(req, res) {
  if (String(req.method || "").toUpperCase() !== "OPTIONS")
    return false;
  const origin = String(req.headers.origin || "").trim();
  if (!origin)
    return false;
  if (!applyCorsHeaders(req, res)) {
    jsonResponse(res, 403, { error: "cors origin not allowed" });
    return true;
  }
  res.writeHead(204);
  res.end();
  return true;
}
