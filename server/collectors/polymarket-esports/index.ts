/// <reference path="./legacy-modules.d.ts" />
/**
 * VPS：Polymarket 电竞 HTTP 采集 → platform_* + MarketIndex
 * 浏览器仅 Index → Market WS → fo；POLYMARKET_COLLECTOR_WRITE_PLATFORM=0 可改 shadow
 */

import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import {
  getResolvedDatabaseLabel,
  hasDatabaseUrlConfig,
  initDatabaseUrl,
} from "@changmen/db";

import { runPolymarketEsportsDiscoveryCycle } from "./loop.ts";
import { refreshPolymarketOutcomes } from "./outcomes.ts";

loadChangmenEnv();

const DISCOVERY_MS = Number(process.env.POLYMARKET_COLLECTOR_INTERVAL_MS || 60_000);
let stopped = false;
/** 防止 setInterval 与慢轮次重叠写库，后写覆盖先写导致闪删 */
let tickRunning = false;

async function tick() {
  if (tickRunning) {
    console.warn("[polymarket-esports] skip tick: previous cycle still running");
    return;
  }
  tickRunning = true;
  try {
    // [changmen 扩展] 先补采赛果，避免 discovery 剔除 ended/closed 后丢失待查市场。
    await refreshPolymarketOutcomes().catch(err => console.warn("[polymarket-esports] outcome refresh failed:", (err as Error).message));
    const stats = await runPolymarketEsportsDiscoveryCycle();
    if (stats.skipped) {
      console.warn(
        `[polymarket-esports] cycle skipped reason=${stats.reason} `
        + `rawMarkets=${stats.rawMarketCount}`,
      );
      return;
    }
    const mode = stats.writePlatform ? "live" : "shadow";
    console.log(
      `[polymarket-esports] cycle ok mode=${mode} matches=${stats.matches} bets=${stats.bets}`
      + (stats.pruned ? ` pruned=${stats.pruned}` : "")
      + (stats.truncated ? " truncated=1" : "")
      + (stats.shadow ? " (shadow; platform write off)" : " (live; browser uses MarketIndex)")
      + (stats.collectTypes ? ` types=${stats.collectTypes.join(",")}` : ""),
    );
  }
  catch (err) {
    console.warn("[polymarket-esports] cycle error:", (err as Error).message);
  }
  finally {
    tickRunning = false;
  }
}

async function main() {
  if (!hasDatabaseUrlConfig()) {
    console.error("[polymarket-esports] DATABASE_URL / DATABASE_URL_PUBLIC / DATABASE_URL_INTERNAL 未配置");
    process.exit(1);
  }
  await initDatabaseUrl();
  console.log(`[polymarket-esports] RDS ${getResolvedDatabaseLabel() || "DATABASE_URL"}`);

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
  console.error("[polymarket-esports] fatal:", err);
  process.exit(1);
});
