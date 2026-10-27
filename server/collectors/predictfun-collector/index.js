/**
 * VPS：Predict.fun HTTP 采集 → platform_matches / platform_bets + market index
 * 浏览器仅 WS → fo（不经 http-relay 打 discovery）
 */

import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  getResolvedDatabaseLabel,
  hasDatabaseUrlConfig,
  initDatabaseUrl,
} from "@changmen/db";

import { runPredictFunDiscoveryCycle } from "./loop.js";

loadChangmenEnv();

const DISCOVERY_MS = Number(process.env.PREDICTFUN_COLLECTOR_INTERVAL_MS || 15_000);
let stopped = false;
let inFlight = false;

async function tick() {
  if (inFlight) {
    console.warn("[predictfun-collector] skip tick: previous cycle still running");
    return;
  }
  inFlight = true;
  try {
    const stats = await runPredictFunDiscoveryCycle();
    console.log(
      `[predictfun-collector] cycle ok matches=${stats.matches} bets=${stats.bets}`
      + ` mapBets=${stats.mapBets ?? "?"}`
      + ` raw=${stats.raw ?? "?"} esport=${stats.esport ?? "?"} inWindow=${stats.inWindow ?? "?"}`
      + (stats.skippedClear ? " skippedClear=1" : ""),
    );
  }
  catch (err) {
    console.warn("[predictfun-collector] cycle error:", err.message);
  }
  finally {
    inFlight = false;
  }
}

async function main() {
  if (!hasDatabaseUrlConfig()) {
    console.error("[predictfun-collector] DATABASE_URL / DATABASE_URL_PUBLIC / DATABASE_URL_INTERNAL 未配置");
    process.exit(1);
  }
  await initDatabaseUrl();
  console.log(`[predictfun-collector] RDS ${getResolvedDatabaseLabel() || "DATABASE_URL"}`);

  await tick();
  const timer = setInterval(() => {
    if (!stopped)
      void tick();
  }, DISCOVERY_MS);

  const shutdown = () => {
    stopped = true;
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[predictfun-collector] fatal:", err);
  process.exit(1);
});
