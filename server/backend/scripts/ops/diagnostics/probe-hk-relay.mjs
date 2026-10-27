#!/usr/bin/env node
/**
 * 场馆 HK 出海 relay 部署探针
 *
 * 1. VPS 直连 Polymarket / Predict.fun 上游
 * 2. 本机 http-relay 代发（Predict.fun；PM 已迁出至 Pm_HttpRequest）
 * 3. ws-forward：PM-MARKET（:3457）/ PREDICTFUN-MARKET（:3458）独立 hub；PM-USER 仍在 esport
 *
 * 用法（VPS / 本机 backend 目录）：
 *   node scripts/ops/diagnostics/probe-hk-relay.mjs
 *   node scripts/ops/diagnostics/probe-hk-relay.mjs --upstream-only
 *   ESPORT_TEST_BASE=http://127.0.0.1:3456 PROBE_TOKEN=xxx node scripts/ops/diagnostics/probe-hk-relay.mjs
 *
 * PM-MARKET WS 默认测独立 hub（PM_MARKET_HUB_PORT / PROBE_PM_MARKET_HUB_BASE，默认 :3457），
 * 勿对 esport :3456 做 upgrade（隔离后那里没有 handler）。
 *
 * PROBE_TOKEN 未设时：若 JWT_SECRET + RDS 可用，自动为首个 profiles 用户签发短期 JWT。
 */
import http from "node:http";
import https from "node:https";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { buildHttpRelayUrl } from "@changmen/api-contract/urls";
import WebSocket from "ws";

loadChangmenEnv();

const args = new Set(process.argv.slice(2));
const upstreamOnly = args.has("--upstream-only");
const relayOnly = args.has("--relay-only");
const skipWs = args.has("--skip-ws") || upstreamOnly || relayOnly;

const UPSTREAM = {
  gamma: "https://gamma-api.polymarket.com/sports",
  clob: "https://clob.polymarket.com/time",
  predictTestnet: "https://api-testnet.predict.fun/v1/tags",
  predictMainnet: "https://api.predict.fun/v1/tags",
};

function resolvePredictFunApiKey() {
  return String(
    process.env.PREDICT_FUN_API_KEY
    || process.env.VITE_PREDICT_FUN_API_KEY
    || "",
  ).trim();
}

async function resolveProbeToken() {
  const fromEnv = String(process.env.PROBE_TOKEN || process.env.ESPORT_TEST_TOKEN || "").trim();
  if (fromEnv)
    return { token: fromEnv, source: "env" };

  const secret = String(process.env.JWT_SECRET || "").trim();
  if (secret.length < 16)
    return { token: "", source: "" };

  try {
    const { hasDatabaseUrlConfig, initDatabaseUrl, getPgPool } = await import("@changmen/db");
    if (!hasDatabaseUrlConfig())
      return { token: "", source: "" };
    await initDatabaseUrl();
    const pool = getPgPool("probe-hk-relay");
    if (!pool)
      return { token: "", source: "" };
    const { rows } = await pool.query(
      `SELECT p.id::text AS id FROM profiles p ORDER BY p.id LIMIT 1`,
    );
    const userId = String(rows[0]?.id || "").trim();
    if (!userId)
      return { token: "", source: "" };
    const { signJwt, JWT_ACCESS_TTL_SEC } = await import("../../../../../rds/rds/jwt.js");
    const token = signJwt(
      { sub: userId, typ: "access", session_id: "probe-hk-relay" },
      secret,
      JWT_ACCESS_TTL_SEC,
    );
    return { token, source: "auto-jwt" };
  }
  catch (err) {
    if (process.env.PROBE_DEBUG)
      console.warn("resolveProbeToken:", err instanceof Error ? err.message : err);
    return { token: "", source: "" };
  }
}

const PM_WS_FORWARD_PATH = "/esport/ws-forward/PM-MARKET";
const PREDICT_WS_FORWARD_PATH = "/esport/ws-forward/PREDICTFUN-MARKET";

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`OK   ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function resolveApiBase() {
  const fromEnv = String(process.env.ESPORT_TEST_BASE || process.env.PROBE_API_BASE || "").trim();
  if (fromEnv)
    return fromEnv.replace(/\/+$/, "");
  const port = Number(process.env.PORT || 3456);
  return `http://127.0.0.1:${port}`;
}

/** PM-MARKET 独立 hub（默认 :3457）；可用 PROBE_PM_MARKET_HUB_BASE 覆盖（例如经 Caddy :80） */
function resolvePmMarketHubBase() {
  const fromEnv = String(process.env.PROBE_PM_MARKET_HUB_BASE || "").trim();
  if (fromEnv)
    return fromEnv.replace(/\/+$/, "");
  const port = Number(process.env.PM_MARKET_HUB_PORT || 3457);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3457}`;
}

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      parsed,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeoutMs ?? 20_000,
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
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    if (options.body)
      req.write(options.body);
    req.end();
  });
}

async function checkUpstreamDirect() {
  const predictApiKey = resolvePredictFunApiKey();
  for (const [label, url] of Object.entries(UPSTREAM)) {
    try {
      const headers = {};
      if (label === "predictMainnet" && predictApiKey)
        headers["x-api-key"] = predictApiKey;
      const res = await nodeFetch(url, { headers });
      if (res.status >= 200 && res.status < 400) {
        pass(`upstream:${label}`, `HTTP ${res.status}`);
      }
      else {
        fail(`upstream:${label}`, `HTTP ${res.status}`);
      }
    }
    catch (err) {
      fail(`upstream:${label}`, err instanceof Error ? err.message : String(err));
    }
  }
}

async function checkHttpRelay(apiBase) {
  const relayRequireToken = ["1", "true", "yes", "on"].includes(
    String(process.env.HTTP_RELAY_REQUIRE_TOKEN || "").trim().toLowerCase(),
  );
  const { token, source } = await resolveProbeToken();
  if (relayRequireToken && !token) {
    fail("http-relay:token", "HTTP_RELAY_REQUIRE_TOKEN=1 但未设置 PROBE_TOKEN / ESPORT_TEST_TOKEN，且无法 auto-jwt");
    fail("http-relay:predict-tags", "跳过（无 PROBE_TOKEN）");
    return;
  }
  if (relayRequireToken)
    pass("http-relay:token", source === "auto-jwt" ? "auto JWT（profiles）" : "已提供 PROBE_TOKEN");

  const relayUrl = buildHttpRelayUrl({ apiBase });
  const tokenHeaders = token ? { token } : {};

  try {
    const predictApiKey = resolvePredictFunApiKey();
    const predictHeaders = {
      ...tokenHeaders,
      "x-proxy-url": UPSTREAM.predictMainnet,
      "x-proxy-referer": "https://predict.fun/",
      "x-proxy-origin": "https://predict.fun",
    };
    if (predictApiKey)
      predictHeaders["x-api-key"] = predictApiKey;
    const res = await nodeFetch(relayUrl, {
      headers: predictHeaders,
      timeoutMs: 25_000,
    });
    if (res.status >= 200 && res.status < 400) {
      pass("http-relay:predict-tags", `HTTP ${res.status} via ${relayUrl}`);
    }
    else {
      const snippet = res.body.toString("utf8").slice(0, 120);
      fail("http-relay:predict-tags", `HTTP ${res.status} ${snippet}`);
    }
  }
  catch (err) {
    fail("http-relay:predict-tags", err instanceof Error ? err.message : String(err));
  }
}

async function checkProxyStatus(apiBase) {
  try {
    const res = await nodeFetch(`${apiBase}/api/proxy/status`);
    if (res.status !== 200) {
      fail("ws-forward:status", `HTTP ${res.status}`);
      return;
    }
    const data = JSON.parse(res.body.toString("utf8"));
    const platforms = Array.isArray(data.platforms) ? data.platforms : [];
    const hubs = data.hubs && typeof data.hubs === "object" ? data.hubs : {};
    // PM-MARKET / PREDICTFUN-MARKET 由独立进程承担：platforms 含 id，或 hubs.* 有状态即可
    const pmOk = platforms.includes("PM-MARKET") || Boolean(hubs.pmMarket);
    const pfOk = platforms.includes("PREDICTFUN-MARKET") || Boolean(hubs.predictFunMarket);
    if (!data.enabled && !pmOk && !pfOk) {
      fail("ws-forward:enabled", "ws_forward 未启用（检查 esport / market hubs）");
      return;
    }
    if (!pmOk) {
      fail(
        "ws-forward:PM-MARKET",
        "未检测到 PM-MARKET（独立 hub hubs.pmMarket）；检查 changmen-pm-market-hub :3457 与 Caddy",
      );
      return;
    }
    if (!pfOk) {
      fail(
        "ws-forward:PREDICTFUN-MARKET",
        "未检测到 PREDICTFUN-MARKET（独立 hub hubs.predictFunMarket）；检查 changmen-predictfun-market-hub :3458 与 Caddy",
      );
      return;
    }
    const bits = [
      "PREDICTFUN-MARKET",
      "PM-MARKET",
      platforms.includes("PM-USER") ? "PM-USER" : null,
    ].filter(Boolean);
    pass("ws-forward:platforms", bits.join(", "));
  }
  catch (err) {
    fail("ws-forward:status", err instanceof Error ? err.message : String(err));
  }
}

function checkWsForwardRelay(apiBase, path, label, { pingProbe = true } = {}) {
  return new Promise((resolve) => {
    const base = new URL(apiBase);
    const wsOrigin = `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}`;
    const wsUrl = `${wsOrigin}${path}`;
    const timer = setTimeout(() => {
      fail(`ws-forward:${label}`, "连接超时（15s）");
      resolve();
    }, 15_000);

    let ws;
    try {
      ws = new WebSocket(wsUrl, { handshakeTimeout: 12_000 });
    }
    catch (err) {
      clearTimeout(timer);
      fail(`ws-forward:${label}`, err instanceof Error ? err.message : String(err));
      resolve();
      return;
    }

    ws.on("open", () => {
      if (!pingProbe) {
        clearTimeout(timer);
        pass(`ws-forward:${label}`, `connected ${wsUrl}`);
        ws.close();
        resolve();
        return;
      }
      ws.send("PING");
    });

    ws.on("message", (data) => {
      const text = String(data);
      clearTimeout(timer);
      ws.close();
      if (text === "PONG" || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        pass(`ws-forward:${label}`, `connected ${wsUrl}`);
      }
      else {
        pass(`ws-forward:${label}`, `connected (frame: ${text.slice(0, 40)})`);
      }
      resolve();
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      fail(`ws-forward:${label}`, `${wsUrl} — ${err.message}`);
      resolve();
    });

    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function checkPmMarketWsRelay(hubBase) {
  return checkWsForwardRelay(hubBase, PM_WS_FORWARD_PATH, "PM-MARKET");
}

function checkPredictFunWsRelay(apiBase) {
  // PF hub 不响应 PING；upgrade 成功即可（订阅协议见 predictfun_market_hub.js）
  return checkWsForwardRelay(apiBase, PREDICT_WS_FORWARD_PATH, "PREDICTFUN-MARKET", { pingProbe: false });
}

async function main() {
  const apiBase = resolveApiBase();
  const pmHubBase = resolvePmMarketHubBase();
  console.log(`== probe-hk-relay apiBase=${apiBase} pmHubBase=${pmHubBase} ==`);

  if (!relayOnly)
    await checkUpstreamDirect();

  if (!upstreamOnly) {
    await checkHttpRelay(apiBase);
    await checkProxyStatus(apiBase);
    if (!skipWs) {
      await checkPmMarketWsRelay(pmHubBase);
      await checkPredictFunWsRelay(apiBase);
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log("");
  if (failed.length) {
    console.error(`== FAIL (${failed.length}/${results.length}) ==`);
    for (const r of failed) console.error(`  - ${r.name}: ${r.detail}`);
    console.error("");
    console.error("修复提示:");
    console.error("  1. upstream 失败 → VPS 需能直连 polymarket.com（HK 出口）");
    console.error("  2. http-relay 失败 → 检查 HTTP_RELAY_ALLOWED_HOSTS、HTTP_RELAY_REQUIRE_TOKEN、pm2 restart changmen-esport");
    console.error("  3. ws-forward 失败 → PM-MARKET :3457 / PREDICTFUN-MARKET :3458 独立 hub + Caddy；再 pm2 restart");
    console.error("  4. predict.fun 失败 → curl -I https://api.predict.fun/v1/tags -H 'x-api-key: …'；检查 HTTP_RELAY_ALLOWED_HOSTS、PREDICT_FUN_API_KEY");
    process.exit(1);
  }
  console.log(`== PASS (${results.length}/${results.length}) ==`);
}

main().catch((err) => {
  console.error("probe-hk-relay:", err instanceof Error ? err.message : err);
  process.exit(1);
});
