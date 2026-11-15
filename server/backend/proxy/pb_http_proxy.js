import { requirePlatform } from "../core/shared/adapter_paths.js";

const { tryLoadSession, buildAuthHeaders } = requirePlatform("PB", "node", "session.js");

const PB_PATH_RE = /\/(sports-service|member-service|member-betslip|bet-placement)\//i;

function isPbApiUrl(url) {
  try {
    return PB_PATH_RE.test(new URL(url).pathname);
  }
  catch {
    return false;
  }
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

function pickForwardHeaders(reqHeaders, sessionHeaders) {
  const out = { ...(sessionHeaders || {}) };
  for (const [key, value] of Object.entries(reqHeaders || {})) {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-app-") || lower.startsWith("x-custid") || lower === "v-hucode") {
      continue;
    }
    if (["content-type", "accept", "accept-language"].includes(lower) && value) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 控制台 PB 下单/余额：Yn.get/post → 本地 Node 代发（凭证来自 platforms.json / PB_* env）。
 * GET|POST /esport/pb/proxy?url=<encoded upstream URL>
 */
async function tryPbHttpProxy(req, res) {
  const pathname = req.url.split("?")[0];
  if (pathname !== "/esport/pb/proxy")
    return false;

  const params = new URL(req.url, "http://127.0.0.1").searchParams;
  const targetUrl = params.get("url");
  if (!targetUrl || !isPbApiUrl(targetUrl)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid or missing PB api url" }));
    return true;
  }

  const session = tryLoadSession();
  if (!session) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "PB session not configured",
        hint: "Set PB_GATEWAY + PB_TOKEN or server/backend storage legacy esport platforms.json PB",
      }),
    );
    return true;
  }

  const authHeaders = buildAuthHeaders(session);
  if (!authHeaders) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "PB token invalid" }));
    return true;
  }

  const headers = pickForwardHeaders(req.headers, authHeaders);
  const body
    = req.method !== "GET" && req.method !== "HEAD" ? await readRequestBody(req) : undefined;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method || "GET",
      headers,
      body: body?.length ? body : undefined,
      signal: AbortSignal.timeout(Number(process.env.PB_PROXY_TIMEOUT_MS || 30000)),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(text);
    return true;
  }
  catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, errorMessage: err.message || "pb proxy failed" }));
    return true;
  }
}

export { isPbApiUrl, PB_PATH_RE, tryPbHttpProxy };
