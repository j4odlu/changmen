import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertBackendProcesses, backendProcesses } from "./verify-backend-processes.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ecosystem = createRequire(import.meta.url)("../../deploy/ecosystem.config.cjs");
const apps = () => ecosystem.apps.filter(app => Object.hasOwn(backendProcesses, app.name)).map((app, index) => ({
  name: app.name, pid: index + 1,
  pm2_env: { status: "online", pm_cwd: app.cwd, pm_exec_path: path.resolve(app.cwd, app.script) },
}));

test("checks all eight production processes against their actual ecosystem entries", () => {
  assert.equal(apps().length, 8);
  assertBackendProcesses(apps(), root);
});
for (const [name, change] of [
  ["missing collector", list => list.splice(1, 1)],
  ["duplicate esport instance", list => list.push(structuredClone(list.find(a => a.name === "changmen-esport")))],
  ["stopped service", list => { list[0].pm2_env.status = "stopped"; }],
  ["no live PID", list => { list[0].pid = 0; }],
  ["wrong release", list => { list[0].pm2_env.pm_cwd = path.join(root, "old-release/server/backend"); }],
  ["wrong directory within the right release", list => { list[0].pm2_env.pm_cwd = path.join(root, "server/ws_forward"); }],
  ["wrong entry point", list => { list[0].pm2_env.pm_exec_path = path.join(root, "server/backend/server.js"); }],
]) test(`rejects ${name}`, () => { const list = apps(); change(list); assert.throws(() => assertBackendProcesses(list, root)); });
