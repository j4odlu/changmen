/**
 * VPS：SX.bet HTTP 采集 → platform_matches / platform_bets + market index
 * 浏览器仅 Index → Centrifugo best_odds → fo（不经 discovery Save*）
 */

import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  getResolvedDatabaseLabel,
  hasDatabaseUrlConfig,
  initDatabaseUrl,
} from "@changmen/db";

import { runSxBetDiscoveryCycle } from "./loop.js";

loadChangmenEnv();

const DISCOVERY_MS = Number(process.env.SXBET_COLLECTOR_INTERVAL_MS || 60_000);
let stopped = false;
let inFlight = false;

async function tick() {
  if (inFlight) {
    console.warn("[sxbet-collector] skip tick: previous cycle still running");
    return;
  }
  inFlight = true;
  try {
    const stats = await runSxBetDiscoveryCycle();
    console.log(
      `[sxbet-collector] cycle ok matches=${stats.matches} bets=${stats.bets}`
      + ` raw=${stats.raw ?? "?"} inWindow=${stats.inWindow ?? "?"}`
      + (stats.skippedClear ? " skippedClear=1" : ""),
    );
  }
  catch (err) {
    console.warn("[sxbet-collector] cycle error:", err.message);
  }
  finally {
    inFlight = false;
  }
}

async function main() {
  if (!hasDatabaseUrlConfig()) {
    console.error("[sxbet-collector] DATABASE_URL / DATABASE_URL_PUBLIC / DATABASE_URL_INTERNAL 未配置");
    process.exit(1);
  }
  await initDatabaseUrl();
  console.log(`[sxbet-collector] RDS ${getResolvedDatabaseLabel() || "DATABASE_URL"}`);

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
  console.error("[sxbet-collector] fatal:", err);
  process.exit(1);
});
