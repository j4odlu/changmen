#!/usr/bin/env node
/**
 * Polymarket MARKET WS Hub — 独立进程（勿挂在 changmen-esport，避免扇出拖死 HTTP）。
 * 浏览器仍连 /esport/ws-forward/PM-MARKET；Caddy 反代到本进程 PM_MARKET_HUB_PORT（默认 3457）。
 */
import http from "node:http";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { initHubIdentity, resolveHubIdentity } from "./core/hub_identity.js";
import {
  attachPmMarketHub,
  closePmMarketHub,
  getPmMarketHubStatus,
  PM_MARKET_HUB_PATH,
} from "./core/pm_market_hub.js";

loadChangmenEnv();

const PORT = Number(process.env.PM_MARKET_HUB_PORT || 3457);

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/health/pm-market" || url.pathname === "/")) {
    sendJson(res, 200, {
      status: "ok",
      service: "changmen-pm-market-hub",
      path: PM_MARKET_HUB_PATH,
      uptime: Math.floor(process.uptime()),
      hub: getPmMarketHubStatus(),
    });
    return;
  }
  res.writeHead(404).end("Not Found");
});

attachPmMarketHub(server, { resolveIdentity: resolveHubIdentity });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[pm-market-hub] port ${PORT} in use — refuse to start`);
    process.exit(1);
  }
  console.error("[pm-market-hub] server error:", err);
  process.exit(1);
});

void (async () => {
  await initHubIdentity();
  server.listen(PORT, () => {
    console.log(
      `[pm-market-hub] listening :${PORT} path=${PM_MARKET_HUB_PATH} (isolated from changmen-esport)`,
    );
  });
})();

function shutdown(signal) {
  console.log(`[pm-market-hub] ${signal}, closing`);
  closePmMarketHub();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
