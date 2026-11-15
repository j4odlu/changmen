import store from "../core/esport-api/store.js";
import { requirePlatform } from "../core/shared/adapter_paths.js";
import { rayApiUrl } from "../core/shared/ray_paths.js";

const { rayHeaders } = requirePlatform("RAY", "node", "session.js");
const { getRayA8CollectCredentials } = requirePlatform("RAY", "node", "collect_credentials.js");

const ALLOWED = new Set(["match", "odds"]);

function originFromReferer(referer) {
  if (!referer)
    return undefined;
  try {
    return new URL(referer).origin;
  }
  catch {
    return String(referer).replace(/\/+$/, "");
  }
}

/** platforms.json → A8 写死采集凭证 → 环境变量 → ACCOUNT（下注账号，非采集） */
function resolveRayCredentials() {
  const row = store.getPlatform("RAY") || {};
  const a8 = getRayA8CollectCredentials();
  const gateway = row.gateway || a8.gateway || process.env.RAY_GATEWAY || "";
  const token = row.token || a8.token || process.env.RAY_TOKEN || process.env.RAY_WS_TOKEN || "";
  const origin = process.env.RAY_ORIGIN;

  return {
    gateway: String(gateway || "").trim(),
    token: String(token || "").trim(),
    origin,
  };
}

/**
 * Frontve：代发 RAY v2 API（Authorization 来自 platforms.json）。
 * GET /esport/ray/proxy?path=match&query=match_type=2&page=1
 */
async function tryRayHttpProxy(req, res) {
  const pathname = req.url.split("?")[0];
  if (pathname !== "/esport/ray/proxy")
    return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return true;
  }

  const params = new URL(req.url, "http://127.0.0.1").searchParams;
  const apiPath = (params.get("path") || "").replace(/^\//, "");
  if (!ALLOWED.has(apiPath)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid RAY api path" }));
    return true;
  }

  const cred = resolveRayCredentials();
  if (!cred.gateway || !cred.token) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "RAY not configured",
        hint: "Set RAY_TOKEN, platforms.json RAY token, or add a RAY account in ACCOUNT",
      }),
    );
    return true;
  }

  const query = params.get("query") || "";
  const target = `${rayApiUrl(cred.gateway, apiPath)}${query ? `?${query}` : ""}`;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: rayHeaders(cred.token, cred.origin),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    res.writeHead(upstream.status, { "Content-Type": ct });
    res.end(body);
  }
  catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message || "RAY proxy failed" }));
  }
  return true;
}

export { resolveRayCredentials, tryRayHttpProxy };
