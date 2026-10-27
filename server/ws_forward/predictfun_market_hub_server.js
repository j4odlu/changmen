#!/usr/bin/env node
/**
 * Predict.fun MARKET WS Hub — 独立进程（勿挂在 changmen-esport，避免扇出拖死 HTTP）。
 * 浏览器仍连 /esport/ws-forward/PREDICTFUN-MARKET；Caddy 反代到 PREDICTFUN_MARKET_HUB_PORT（默认 3458）。
 */
import http from "node:http";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  attachPredictFunMarketHub,
  closePredictFunMarketHub,
  getPredictFunMarketHubStatus,
} from "./core/predictfun_market_hub.js";
import { PREDICTFUN_MARKET_HUB_PATH } from "./platforms/predictfun.js";

loadChangmenEnv();

const PORT = Number(process.env.PREDICTFUN_MARKET_HUB_PORT || 3458);

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
      service: "changmen-predictfun-market-hub",
      path: PREDICTFUN_MARKET_HUB_PATH,
      uptime: Math.floor(process.uptime()),
      hub: getPredictFunMarketHubStatus(),
    });
    return;
  }
  res.writeHead(404).end("Not Found");
});

attachPredictFunMarketHub(server);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[predictfun-market-hub] port ${PORT} in use — refuse to start`);
    process.exit(1);
  }
  console.error("[predictfun-market-hub] server error:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(
    `[predictfun-market-hub] listening :${PORT} path=${PREDICTFUN_MARKET_HUB_PATH} (isolated from changmen-esport)`,
  );
});

function shutdown(signal) {
  console.log(`[predictfun-market-hub] ${signal}, closing`);
  closePredictFunMarketHub();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
