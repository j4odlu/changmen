#!/usr/bin/env node
/**
 * SX.bet MARKET WS Hub — 独立进程（勿挂在 changmen-esport）。
 * 浏览器连 /esport/ws-forward/SXBET-MARKET；Caddy 反代到 SXBET_MARKET_HUB_PORT（默认 3460）。
 * 上游 Centrifugo 用 SXBET_API_KEY 换 realtime token。
 */
import http from "node:http";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  attachSxBetMarketHub,
  closeSxBetMarketHub,
  getSxBetMarketHubStatus,
} from "./core/sxbet_market_hub.js";
import { SXBET_MARKET_HUB_PATH } from "./platforms/sxbet.js";

loadChangmenEnv();

const PORT = Number(process.env.SXBET_MARKET_HUB_PORT || 3460);

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
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    sendJson(res, 200, {
      status: "ok",
      service: "changmen-sxbet-market-hub",
      path: SXBET_MARKET_HUB_PATH,
      uptime: Math.floor(process.uptime()),
      hub: getSxBetMarketHubStatus(),
    });
    return;
  }
  res.writeHead(404).end("Not Found");
});

attachSxBetMarketHub(server);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[sxbet-market-hub] port ${PORT} in use — refuse to start`);
    process.exit(1);
  }
  console.error("[sxbet-market-hub] server error:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(
    `[sxbet-market-hub] listening :${PORT} path=${SXBET_MARKET_HUB_PATH} (isolated from changmen-esport)`,
  );
});

function shutdown(signal) {
  console.log(`[sxbet-market-hub] ${signal}, closing`);
  closeSxBetMarketHub();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
