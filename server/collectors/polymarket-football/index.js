/** VPS：Polymarket Gamma 足球 discovery → storage/sport/soccer6/match_list.json。 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { runPmFootballDiscoveryCycle } from "./loop.js";

loadChangmenEnv();

const INTERVAL_MS = Number(process.env.PM_FOOTBALL_COLLECTOR_INTERVAL_MS || 30_000);
let stopped = false;
let inFlight = false;

async function tick() {
  if (inFlight) {
    console.warn("[pm-football-collector] skip tick: previous cycle still running");
    return;
  }
  inFlight = true;
  try {
    const stats = await runPmFootballDiscoveryCycle();
    console.warn(`[pm-football-collector] cycle ${stats.skipped ? "skipped" : "ok"} matches=${stats.matches}${stats.reason ? ` reason=${stats.reason}` : ""} publishedAt=${stats.publishedAt}`);
  }
  catch (err) {
    console.warn("[pm-football-collector] cycle error:", err?.message || err);
  }
  finally {
    inFlight = false;
  }
}

async function main() {
  await tick();
  const timer = setInterval(() => {
    if (!stopped)
      void tick();
  }, INTERVAL_MS);

  const shutdown = () => {
    stopped = true;
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[pm-football-collector] fatal:", err);
  process.exit(1);
});
