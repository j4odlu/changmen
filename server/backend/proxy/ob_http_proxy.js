import store from "../core/esport-api/store.js";
import { requirePlatform } from "../core/shared/adapter_paths.js";

const { obHeaders } = requirePlatform("OB", "node", "session.js");

const ALLOWED_PREFIX = "/game/";

/**
 * Frontve / 跨域控制台：代发 OB gateway GET（凭证来自 platforms.json）。
 * GET /esport/ob/proxy?path=game/index&query=game_id=0&flag=1&day=1
 */
export async function tryObHttpProxy(req, res) {
  const pathname = req.url.split("?")[0];
  if (pathname !== "/esport/ob/proxy")
    return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return true;
  }

  const params = new URL(req.url, "http://127.0.0.1").searchParams;
  let apiPath = params.get("path") || "";
  if (!apiPath.startsWith("/"))
    apiPath = `/${apiPath}`;
  if (!apiPath.startsWith(ALLOWED_PREFIX)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid OB api path" }));
    return true;
  }

  const row = store.getPlatform("OB");
  if (!row?.gateway || !row?.token) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "OB not configured",
        hint: "Sync OB session via platform_sync or platforms.json",
      }),
    );
    return true;
  }

  const gateway = String(row.gateway).replace(/\/+$/, "");
  const query = params.get("query") || "";
  const target = `${gateway}${apiPath}${query ? (apiPath.includes("?") ? "&" : "?") + query : ""}`;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: obHeaders(row.token, "cn"),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    res.writeHead(upstream.status, { "Content-Type": ct });
    res.end(body);
  }
  catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message || "OB proxy failed" }));
  }
  return true;
}
