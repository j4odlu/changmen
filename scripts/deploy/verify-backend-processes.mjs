/** [changmen 扩展] The same process ownership check applies to publish and rollback. */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const backendProcesses = {
  "changmen-esport": ["server/backend", "scripts/start-db.mjs"],
  "changmen-pm-sports": ["server/collectors/polymarket-sports", "index.js"],
  "changmen-polymarket-collector": ["server/collectors/polymarket-esports", "index.js"],
  "changmen-pm-football-collector": ["server/collectors/polymarket-football", "index.js"],
  "changmen-predictfun-collector": ["server/collectors/predictfun-collector", "index.js"],
  "changmen-pm-market-hub": ["server/ws_forward", "pm_market_hub_server.js"],
  "changmen-pm-sport-market-hub": ["server/ws_forward", "pm_sport_market_hub_server.js"],
  "changmen-predictfun-market-hub": ["server/ws_forward", "predictfun_market_hub_server.js"],
};

export function assertBackendProcesses(apps, root) {
  assert(Array.isArray(apps), "Invalid PM2 process list");
  for (const [name, [directory, script]] of Object.entries(backendProcesses)) {
    const matches = apps.filter(app => app.name === name);
    assert.equal(matches.length, 1, `Expected exactly one process: ${name}`);
    const app = matches[0], env = app.pm2_env;
    assert(Number.isInteger(app.pid) && app.pid > 0, `Missing live PID: ${name}`);
    assert.equal(env?.status, "online", `Unhealthy process: ${name}`);
    assert.equal(env.pm_cwd && path.resolve(env.pm_cwd), path.resolve(root, directory), `Wrong working directory: ${name}`);
    assert.equal(env.pm_exec_path && path.resolve(env.pm_exec_path), path.resolve(root, directory, script), `Wrong entry point: ${name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv[2], "Expected release directory required");
    let input = ""; for await (const chunk of process.stdin) input += chunk;
    assertBackendProcesses(JSON.parse(input), process.argv[2]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
