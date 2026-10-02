import { getPgPool } from "@changmen/db";
import { requireHttpUser } from "./core/auth/http_identity.js";
import { tryWebSessionRoutes } from "./core/auth/web_session_routes.js";
import { tryCertificateRoutes } from './core/certificates/routes.js';
import { getCatalogSummary } from "@changmen/shared/catalog/game_catalog";
import { getCatalogSummary as getMarketCatalogSummary } from "@changmen/shared/catalog/market_catalog";
import { getWsForwardStatus, isWsForwardHttpPath } from "@changmen/ws-forward";
import {
  handleChangmenInternalBroadcast,
  isChangmenRealtimeHttpPath,
} from "@changmen/realtime-hub";
import { canAccessAdminPanel } from "./core/auth/admin_auth.js";
import { countAccounts, getClientMatches, listProfiles } from "./core/db/store.js";
import { handleClientLogin, resolveCreditPlateUserName, tryEsportApi } from "./core/esport-api/router.js";
import { getHardcodedCredentials } from "./core/integrations/a8/config.js";
import {
  handlePolymarketRelayerSign,
  handlePolymarketRelayerStatus,
} from "./core/integrations/polymarket/relayer_http.js";
import { handlePolymarketClobL1ApiCreds } from "./core/integrations/polymarket/clob_l1_http.js";
import { buildPmMarketObservabilitySnapshot } from "./core/integrations/polymarket/pm_market_observability.js";
import { adapterRequire, requirePlatform } from "./core/shared/adapter_paths.js";
import { tryHttpProxyRelay } from "./proxy/http_proxy_relay.js";
import { tryIaHttpProxy } from "./proxy/ia_http_proxy.js";
import { tryObHttpProxy } from "./proxy/ob_http_proxy.js";
import { tryPbHttpProxy } from "./proxy/pb_http_proxy.js";
import { tryRayHttpProxy } from "./proxy/ray_http_proxy.js";
import { isFastStaticRequest } from "./static_files.js";
import { getEsportRequestTimingSnapshot } from "./core/shared/esport_request_timing.js";
import {
  buildMemoryDiagSnapshot,
  getProcessMemorySnapshot,
  writeHeapSnapshotFile,
} from "./core/shared/memory_diag.js";
import {
  catchErrors,
  compose,
  jsonResponse,
  readJsonBody,
  seedRequestContext,
  sendUnhandledError,
  withTiming,
  applyCorsHeaders,
  applySecurityHeaders,
  tryHandleCorsPreflight,
} from "./core/http/index.js";

const { listPlatforms } = adapterRequire("registry", "feeds.js");
const { fetchObLogin, DEFAULT_LOGIN_URL } = requirePlatform("OB", "node", "session.js");

let _tryHandleMatcherApi;
async function getTryHandleMatcherApi() {
  if (!_tryHandleMatcherApi) {
    ({ tryHandleMatcherApi: _tryHandleMatcherApi } = await import(
      "@changmen/matcher/ui/http_bridge.js",
    ));
  }
  return _tryHandleMatcherApi;
}

function isLoopbackAddress(value) {
  const addr = String(value || "").trim().toLowerCase();
  return addr === "127.0.0.1"
    || addr === "::1"
    || addr === "localhost"
    || addr === "::ffff:127.0.0.1";
}

function isLocalHostHeader(value) {
  const host = String(value || "").trim().toLowerCase().replace(/^\[/, "").replace(/\](:\d+)?$/, "");
  const hostWithoutPort = host.includes(":") && !host.includes("::") ? host.split(":")[0] : host;
  return !hostWithoutPort || isLoopbackAddress(hostWithoutPort);
}

function isLocalRequest(req) {
  if (!isLocalHostHeader(req.headers.host))
    return false;
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (forwardedFor.length)
    return forwardedFor.every(isLoopbackAddress);
  const realIp = req.headers["x-real-ip"];
  if (realIp)
    return isLoopbackAddress(realIp);
  return isLoopbackAddress(req.socket?.remoteAddress);
}

/**
 * Caddy mTLS 块应注入：
 *   header_up X-Changmen-Client-Cert 1
 *   header_up X-Changmen-Client-Subject {http.request.tls.client.subject}
 * HTTP 块须删除同名头，防止伪造。仅信任来自 loopback（Caddy→Node）的注入。
 */
function readClientCertStatus(req) {
  const fromLoopback = isLoopbackAddress(req.socket?.remoteAddress);
  if (!fromLoopback) {
    return { hasClientCert: false, subject: "" };
  }
  const flag = String(req.headers["x-changmen-client-cert"] || "").trim().toLowerCase();
  let subject = String(req.headers["x-changmen-client-subject"] || "").trim();
  // Caddy 未替换占位符时会原样传来 "{http.request.tls.client.subject}"
  if (subject.includes("{") || subject.includes("}"))
    subject = "";
  const hasClientCert = flag === "1" || flag === "true" || subject.length > 0;
  return { hasClientCert, subject: hasClientCert ? subject : "" };
}

function publicHealthResponse(req, res) {
  const accept = String(req.headers.accept || "");
  if (accept.includes("application/json")) {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("ok\n");
}

async function handleObDemoLogin(req, res) {
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return true;
  }
  try {
    const loginUrl = process.env.OB_LOGIN_URL || DEFAULT_LOGIN_URL;
    const { json } = await fetchObLogin(loginUrl);
    jsonResponse(res, 200, json);
  }
  catch (err) {
    jsonResponse(res, 502, {
      status: false,
      message: err.message || String(err),
      data: null,
    });
  }
  return true;
}

/**
 * esport / proxy / WS / 快速静态 early-return 之后的应用路由。
 * 阶段 1：逻辑与原先 if 链一致，仅挂到 compose 横切层。
 */
async function handleAppRoutes(req, res, serveStatic) {
  const url = req.pathname || String(req.url || "").split("?")[0];
  if (url === "/api/ob/demo-login") {
    await handleObDemoLogin(req, res);
    return;
  }
  if (url === "/api/a8/defaults") {
    const cred = getHardcodedCredentials();
    jsonResponse(res, 200, { userName: cred.userName, password: cred.password });
    return;
  }
  if (url === "/api/a8/credit-plate-user") {
    const auth = await requireHttpUser(req);
    if (auth.error) { jsonResponse(res, auth.error.status, auth.error.body); return; }
    const user = auth.user;
    const userName = resolveCreditPlateUserName(user);
    jsonResponse(res, 200, { userName });
    return;
  }
  if (url === "/api/polymarket/relayer/sign") {
    await handlePolymarketRelayerSign(req, res, readJsonBody);
    return;
  }
  if (url === "/api/polymarket/relayer/status") {
    await handlePolymarketRelayerStatus(req, res);
    return;
  }
  if (url === "/api/polymarket/clob/create-or-derive-api-creds") {
    await handlePolymarketClobL1ApiCreds(req, res, readJsonBody);
    return;
  }
  if (url === "/api/markets") {
    jsonResponse(res, 200, getMarketCatalogSummary());
    return;
  }
  if (url === "/api/games") {
    jsonResponse(res, 200, getCatalogSummary());
    return;
  }
  if (url === "/api/platforms") {
    jsonResponse(res, 200, { platforms: listPlatforms(), updatedAt: Date.now() });
    return;
  }
  if (url.toLowerCase() === "/api/proxy/status") {
    const ws = getWsForwardStatus();
    const hubs = { ...(ws.hubs || {}) };
    if (!hubs.pmMarket) {
      const [localPm, publicPm] = await Promise.all([
        fetchPmMarketHubStatusLocal(),
        fetchPmMarketHubStatusPublic(),
      ]);
      if (localPm)
        hubs.pmMarket = localPm;
      else if (publicPm)
        hubs.pmMarket = publicPm;
    }
    if (!hubs.predictFunMarket) {
      const remotePf = await fetchPredictFunMarketHubStatusRemote();
      if (remotePf)
        hubs.predictFunMarket = remotePf;
    }
    if (!hubs.sxBetMarket) {
      const remoteSx = await fetchSxBetMarketHubStatusRemote();
      if (remoteSx)
        hubs.sxBetMarket = remoteSx;
    }
    const platforms = [...(ws.platforms || [])];
    // 独立 hub 进程时本机 platforms 不含对应 id；对外状态仍应标明可用
    if (hubs.pmMarket && !platforms.includes("PM-MARKET"))
      platforms.push("PM-MARKET");
    if (hubs.predictFunMarket && !platforms.includes("PREDICTFUN-MARKET"))
      platforms.push("PREDICTFUN-MARKET");
    if (hubs.sxBetMarket && !platforms.includes("SXBET-MARKET"))
      platforms.push("SXBET-MARKET");
    jsonResponse(res, 200, {
      enabled: ws.enabled || Boolean(hubs.pmMarket) || Boolean(hubs.predictFunMarket) || Boolean(hubs.sxBetMarket),
      wsRelay: ws.wsForward || Boolean(hubs.pmMarket) || Boolean(hubs.predictFunMarket) || Boolean(hubs.sxBetMarket),
      wsForward: ws.wsForward || Boolean(hubs.pmMarket) || Boolean(hubs.predictFunMarket) || Boolean(hubs.sxBetMarket),
      platforms,
      platformStats: ws.platformStats,
      hubs,
      pmMarketHub: hubs.pmMarket
        ? { isolated: !ws.hubs?.pmMarket, port: Number(process.env.PM_MARKET_HUB_PORT || 3457) }
        : null,
      predictFunMarketHub: hubs.predictFunMarket
        ? { isolated: !ws.hubs?.predictFunMarket, port: Number(process.env.PREDICTFUN_MARKET_HUB_PORT || 3458) }
        : null,
      sxBetMarketHub: hubs.sxBetMarket
        ? { isolated: !ws.hubs?.sxBetMarket, port: Number(process.env.SXBET_MARKET_HUB_PORT || 3460) }
        : null,
    });
    return;
  }
  if (url === "/api/client-cert-status") {
    const status = readClientCertStatus(req);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({
      ok: true,
      hasClientCert: status.hasClientCert,
      subject: status.subject,
    }));
    return;
  }
  if (url === "/health/diag" || url === "/health/diag/heapdump") {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { success: 0, msg: "localhost only", info: null });
      return;
    }
    if (url === "/health/diag/heapdump") {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { success: 0, msg: "POST only", info: null });
        return;
      }
      try {
        const file = writeHeapSnapshotFile();
        jsonResponse(res, 200, { ok: true, file, memory: getProcessMemorySnapshot() });
      }
      catch (err) {
        jsonResponse(res, 500, { ok: false, msg: err.message || String(err) });
      }
      return;
    }
    if (req.method !== "GET") {
      jsonResponse(res, 405, { success: 0, msg: "GET only", info: null });
      return;
    }
    const diag = await buildMemoryDiagSnapshot();
    jsonResponse(res, 200, diag);
    return;
  }
  if (url === "/health/pm-market") {
    if (req.method !== "GET") {
      jsonResponse(res, 405, { success: 0, msg: "GET only", info: null });
      return;
    }
    const sendPmMarketHealth = async () => {
      const parsed = new URL(String(req.url || "/"), "http://localhost");
      const timeoutMs = Number(parsed.searchParams.get("timeoutMs") || parsed.searchParams.get("timeout") || 0);
      const data = await buildPmMarketObservabilitySnapshot({ timeoutMs });
      jsonResponse(res, data.status === "ok" ? 200 : 503, data);
    };
    if (isLocalRequest(req)) {
      await sendPmMarketHealth();
      return;
    }
    {
      const auth = await requireHttpUser(req);
      if (auth.error?.status === 503) { jsonResponse(res, 503, auth.error.body); return; }
      const user = auth.user;
      if (user && canAccessAdminPanel(user)) {
        await sendPmMarketHealth();
        return;
      }
    }
    jsonResponse(res, 403, { success: 0, msg: "无管理权限", info: null });
    return;
  }
  if (url === "/health") {
    const sendFullHealth = async () => {
      const healthData = await buildHealthData();
      const accept = String(req.headers.accept || "");
      if (accept.includes("text/html")) {
        res.writeHead(healthData.db.connected ? 200 : 503, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHealthPage(healthData));
      }
      else {
        jsonResponse(res, healthData.db.connected ? 200 : 503, healthData);
      }
    };
    if (isLocalRequest(req)) {
      await sendFullHealth();
      return;
    }
    {
      const auth = await requireHttpUser(req);
      if (auth.error?.status === 503) { jsonResponse(res, 503, auth.error.body); return; }
      const user = auth.user;
      if (user && canAccessAdminPanel(user)) {
        await sendFullHealth();
        return;
      }
    }
    publicHealthResponse(req, res);
    return;
  }
  if (await (await getTryHandleMatcherApi())(req, res))
    return;
  serveStatic(req, res);
}

export function createHttpHandler({ port, serveStatic }) {
  // 仅覆盖 early-return 之后的路径；proxy/WS 不包 timing，避免干扰已写响应
  const runApp = compose(
    withTiming,
    catchErrors,
    async (req, res) => {
      await handleAppRoutes(req, res, serveStatic);
    },
  );

  return async function handleHttp(req, res) {
    seedRequestContext(req);
    try {
      applySecurityHeaders(req, res);
      // 步骤 2：页面站 → api. 子域；无 Origin（同源）时 no-op
      applyCorsHeaders(req, res);
      if (tryHandleCorsPreflight(req, res))
        return;

      const url = req.pathname;
      if (await tryWebSessionRoutes(req, res, { login: handleClientLogin }))
        return;
      if (await tryCertificateRoutes(req,res))
        return;
      // Socket.IO 握手由 ws_forward / realtime-hub 处理，勿走 esport-api / 静态文件
      if (isWsForwardHttpPath(url))
        return;
      if (isChangmenRealtimeHttpPath(url))
        return;
      if (url === "/esport/internal/broadcast/pm-sport") {
        await handleChangmenInternalBroadcast(req, res, () => readJsonBody(req));
        return;
      }
      if (isFastStaticRequest(url, req.method)) {
        serveStatic(req, res);
        return;
      }
      const baseOrigin = `http://127.0.0.1:${port}`;
      if (await tryHttpProxyRelay(req, res, baseOrigin))
        return;
      if (await tryPbHttpProxy(req, res))
        return;
      if (await tryObHttpProxy(req, res))
        return;
      if (await tryRayHttpProxy(req, res))
        return;
      if (await tryIaHttpProxy(req, res))
        return;
      if (await tryEsportApi(req, res))
        return;
      await runApp(req, res);
    }
    catch (err) {
      // early-return 路径（proxy/esport 等）的兜底；app 路径由 catchErrors 处理
      sendUnhandledError(req, res, err);
    }
  };
}

async function buildHealthData() {
  const pool = getPgPool();
  let db = false;
  let dbLatencyMs = -1;
  const poolStats = { total: 0, idle: 0, waiting: 0 };
  if (pool) {
    const t0 = Date.now();
    try { await pool.query("SELECT 1"); db = true; dbLatencyMs = Date.now() - t0; }
    catch { /* */ }
    poolStats.total = pool.totalCount ?? 0;
    poolStats.idle = pool.idleCount ?? 0;
    poolStats.waiting = pool.waitingCount ?? 0;
  }
  const mem = getProcessMemorySnapshot();
  const profiles = listProfiles();
  const matches = getClientMatches();
  const ws = getWsForwardStatus();
  const hubs = { ...(ws.hubs || {}) };
  // 独立 Market hub：软拉本机，其次 202 公网 health（失败不拖垮 /health）
  const localPm = hubs.pmMarket
    ? hubs.pmMarket
    : await fetchPmMarketHubStatusPreferred();
  if (localPm)
    hubs.pmMarket = localPm;
  if (!hubs.predictFunMarket) {
    const remotePf = await fetchPredictFunMarketHubStatusRemote();
    if (remotePf)
      hubs.predictFunMarket = remotePf;
  }
  if (!hubs.sxBetMarket) {
    const remoteSx = await fetchSxBetMarketHubStatusRemote();
    if (remoteSx)
      hubs.sxBetMarket = remoteSx;
  }
  const platforms = [...(ws.platforms || [])];
  if (hubs.pmMarket && !platforms.includes("PM-MARKET"))
    platforms.push("PM-MARKET");
  if (hubs.predictFunMarket && !platforms.includes("PREDICTFUN-MARKET"))
    platforms.push("PREDICTFUN-MARKET");
  if (hubs.sxBetMarket && !platforms.includes("SXBET-MARKET"))
    platforms.push("SXBET-MARKET");
  return {
    status: db ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    version: "1.0.2",
    db: { connected: db, latencyMs: dbLatencyMs, pool: poolStats },
    memory: mem,
    data: {
      users: profiles.length,
      accounts: countAccounts(),
      clientMatches: matches?.length ?? 0,
    },
    wsForward: {
      enabled: ws.enabled || Boolean(hubs.pmMarket) || Boolean(hubs.predictFunMarket) || Boolean(hubs.sxBetMarket),
      platforms,
      platformStats: ws.platformStats,
      hubs,
    },
    esportApi: getEsportRequestTimingSnapshot(),
  };
}

/** @returns {Promise<object | null>} */
async function fetchHubHealthJson(url, timeoutMs) {
  const target = String(url || "").trim();
  if (!target)
    return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(target, { signal: ac.signal });
    if (!res.ok)
      return null;
    const json = await res.json();
    return json?.hub && typeof json.hub === "object" ? json.hub : null;
  }
  catch {
    return null;
  }
  finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<object | null>} */
async function fetchPmMarketHubStatusLocal() {
  const port = Number(process.env.PM_MARKET_HUB_PORT || 3457);
  if (!Number.isFinite(port) || port <= 0)
    return null;
  return fetchHubHealthJson(`http://127.0.0.1:${port}/health`, 300);
}

function primaryPmMarketHubHealthUrl() {
  const raw = String(process.env.MARKET_HUB_PRIMARY_HEALTH_URL ?? "").trim();
  if (raw === "0" || raw.toLowerCase() === "off")
    return "";
  if (raw)
    return raw;
  const origin = String(process.env.MARKET_HUB_PRIMARY_ORIGIN || "https://ws.changmen.fun").trim().replace(/\/+$/, "");
  return origin ? `${origin}/health/pm-market` : "";
}

async function fetchPmMarketHubStatusPublic() {
  return fetchHubHealthJson(primaryPmMarketHubHealthUrl(), 800);
}

async function fetchPmMarketHubStatusPreferred() {
  return await fetchPmMarketHubStatusLocal()
    || await fetchPmMarketHubStatusPublic();
}

/** @returns {Promise<object | null>} */
async function fetchPredictFunMarketHubStatusRemote() {
  const port = Number(process.env.PREDICTFUN_MARKET_HUB_PORT || 3458);
  if (!Number.isFinite(port) || port <= 0)
    return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal });
    if (!res.ok)
      return null;
    const json = await res.json();
    return json?.hub && typeof json.hub === "object" ? json.hub : null;
  }
  catch {
    return null;
  }
  finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<object | null>} */
async function fetchSxBetMarketHubStatusRemote() {
  const port = Number(process.env.SXBET_MARKET_HUB_PORT || 3460);
  if (!Number.isFinite(port) || port <= 0)
    return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal });
    if (!res.ok)
      return null;
    const json = await res.json();
    return json?.hub && typeof json.hub === "object" ? json.hub : null;
  }
  catch {
    return null;
  }
  finally {
    clearTimeout(timer);
  }
}

function renderHealthPage(d) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const statusColor = d.status === "ok" ? "#22c55e" : "#ef4444";
  const dbColor = d.db.connected ? "#22c55e" : "#ef4444";
  const latencyColor = d.db.latencyMs < 10 ? "#22c55e" : d.db.latencyMs < 50 ? "#eab308" : "#ef4444";
  const poolActive = d.db.pool.total - d.db.pool.idle;
  const poolPct = d.db.pool.total ? Math.round(poolActive / d.db.pool.total * 100) : 0;
  const heapPct = d.memory.heapTotalMb ? Math.round(d.memory.heapUsedMb / d.memory.heapTotalMb * 100) : 0;
  const apiDelayColor = d.esportApi?.lastDelayMs < 100 ? "#22c55e" : d.esportApi?.lastDelayMs < 500 ? "#eab308" : "#ef4444";
  const esportApiCard = d.esportApi ? `
  <div class="card">
    <div class="card-title">Esport API</div>
    <div class="row"><span class="label">Last</span><span class="value" style="color:${apiDelayColor}">${d.esportApi.lastDelayMs}ms</span></div>
    <div class="row"><span class="label">Action</span><span class="value">${esc(d.esportApi.lastAction || "—")}</span></div>
    <div class="row"><span class="label">Counter</span><span class="value">${d.esportApi.counter}</span></div>
${(d.esportApi.byAction || []).slice(0, 8).map(row => `    <div class="row"><span class="label">${esc(row.action)}</span><span class="value">max ${row.maxMs}ms / avg ${row.avgMs}ms (${row.count})</span></div>`).join("\n")}
  </div>` : "";
  const uptimeStr = d.uptime >= 86400
    ? `${Math.floor(d.uptime / 86400)}d ${Math.floor(d.uptime % 86400 / 3600)}h`
    : d.uptime >= 3600
      ? `${Math.floor(d.uptime / 3600)}h ${Math.floor(d.uptime % 3600 / 60)}m`
      : `${Math.floor(d.uptime / 60)}m ${d.uptime % 60}s`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>changmen health</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:24px}
.header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.dot{width:14px;height:14px;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.title{font-size:20px;font-weight:600;letter-spacing:.5px}
.meta{color:#94a3b8;font-size:13px;margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155}
.card-title{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:14px}
.row{display:flex;justify-content:space-between;align-items:center;padding:6px 0}
.label{color:#94a3b8;font-size:14px}
.value{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600}
.bar-bg{height:6px;background:#334155;border-radius:3px;margin-top:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .6s}
.platforms{display:flex;gap:6px;flex-wrap:wrap}
.platform-tag{background:#334155;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}
.refresh-note{text-align:center;color:#475569;font-size:12px;margin-top:20px}
</style>
</head>
<body>
<div class="header">
  <div class="dot" style="background:${statusColor}"></div>
  <div class="title">changmen</div>
  <div class="meta">v${esc(d.version)} &middot; uptime ${esc(uptimeStr)}</div>
</div>
<div class="grid">
  <div class="card">
    <div class="card-title">Database</div>
    <div class="row"><span class="label">Status</span><span class="badge" style="background:${dbColor}20;color:${dbColor}">${d.db.connected ? "Connected" : "Down"}</span></div>
    <div class="row"><span class="label">Latency</span><span class="value" style="color:${latencyColor}">${d.db.latencyMs}ms</span></div>
    <div class="row"><span class="label">Pool</span><span class="value">${poolActive} / ${d.db.pool.total} active</span></div>
    <div class="bar-bg"><div class="bar-fill" style="width:${poolPct}%;background:${poolPct > 80 ? "#ef4444" : "#3b82f6"}"></div></div>
    ${d.db.pool.waiting ? `<div class="row"><span class="label">Waiting</span><span class="value" style="color:#eab308">${d.db.pool.waiting}</span></div>` : ""}
  </div>
  <div class="card">
    <div class="card-title">Memory</div>
    <div class="row"><span class="label">RSS</span><span class="value">${d.memory.rssMb} MB</span></div>
    <div class="row"><span class="label">Heap</span><span class="value">${d.memory.heapUsedMb} / ${d.memory.heapTotalMb} MB</span></div>
    <div class="row"><span class="label">Non-heap</span><span class="value">${d.memory.nonHeapMb} MB (ext ${d.memory.externalMb}, ab ${d.memory.arrayBuffersMb})</span></div>
    <div class="bar-bg"><div class="bar-fill" style="width:${heapPct}%;background:${heapPct > 85 ? "#ef4444" : heapPct > 60 ? "#eab308" : "#22c55e"}"></div></div>
  </div>
  <div class="card">
    <div class="card-title">Data</div>
    <div class="row"><span class="label">Users</span><span class="value">${d.data.users}</span></div>
    <div class="row"><span class="label">Accounts</span><span class="value">${d.data.accounts}</span></div>
    <div class="row"><span class="label">Matches</span><span class="value">${d.data.clientMatches}</span></div>
  </div>
  <div class="card">
    <div class="card-title">WebSocket Forward</div>
    <div class="row"><span class="label">Relay</span><span class="badge" style="background:${d.wsForward.enabled ? "#22c55e20" : "#ef444420"};color:${d.wsForward.enabled ? "#22c55e" : "#ef4444"}">${d.wsForward.enabled ? "Enabled" : "Disabled"}</span></div>
${(d.wsForward.platforms || []).map((pid) => {
  const ps = d.wsForward.platformStats?.[pid];
  if (!ps)
    return `    <div class="row"><span class="label">${esc(pid)}</span><span class="value" style="color:#475569">idle</span></div>`;
  const hasError = ps.lastError && ps.lastErrorAt && (Date.now() - ps.lastErrorAt < 600_000);
  const color = ps.active > 0 ? "#22c55e" : hasError ? "#ef4444" : "#94a3b8";
  const ago = ps.lastConnectedAt ? Math.floor((Date.now() - ps.lastConnectedAt) / 1000) : 0;
  const agoStr = ago > 3600 ? `${Math.floor(ago / 3600)}h ago` : ago > 60 ? `${Math.floor(ago / 60)}m ago` : ago > 0 ? `${ago}s ago` : "";
  let detail = `${ps.active} conn`;
  if (ps.totalConnections)
    detail += ` (total ${ps.totalConnections})`;
  return [
    `    <div class="row"><span class="label">${esc(pid)}</span><span class="value"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${detail}</span></div>`,
    agoStr ? `    <div class="row"><span class="label"></span><span class="value" style="color:#475569;font-size:12px">last: ${esc(agoStr)}</span></div>` : "",
    hasError ? `    <div class="row"><span class="label"></span><span class="value" style="color:#ef4444;font-size:12px">${esc(ps.lastError)}</span></div>` : "",
  ].filter(Boolean).join("\n");
}).join("\n")}
  </div>
${esportApiCard}
</div>
<div class="refresh-note">Auto-refresh 5s</div>
<script>setTimeout(()=>location.reload(),5000)</script>
</body>
</html>`;
}
