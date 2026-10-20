// [changmen 扩展] Run actual eight entries in an isolated loopback-only Linux network namespace.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(process.platform, "linux");
assert(config.root.startsWith("/tmp/changmen-linux-check-") && config.out.startsWith("/tmp/changmen-linux-check-"));
const interfaces = os.networkInterfaces();
assert(Object.values(interfaces).flat().length > 0 && Object.values(interfaces).flat().every(row => row.internal));
assert.deepEqual(JSON.parse(execFileSync("ip", ["-j", "route"], { encoding: "utf8" })), []);
assert.equal(config.entries.length, 8);
const hook = fileURLToPath(new URL("./backend-runtime-fixture.mjs", import.meta.url));
const report = { passed: false, networkNamespace: true, externalInterfaceCount: 0, actualEntries: true,
  upstreamsMocked: true, liveMarketVerified: false, processes: [], failures: [], productionWrites: false };
const children = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ports = { "changmen-esport": 18000, "changmen-pm-market-hub": 18001, "changmen-pm-sport-market-hub": 18002, "changmen-predictfun-market-hub": 18003 };
const markers = { "changmen-pm-sports": "[pm-sports] Gamma index:", "changmen-polymarket-collector": "[polymarket-esports] cycle",
  "changmen-pm-football-collector": "[pm-football-collector] cycle", "changmen-predictfun-collector": "[predictfun-collector] cycle ok" };
const read = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
function launch(entry, suffix = "", overrides = {}) {
  const log = path.join(config.out, `${entry.name}${suffix}.log`), requests = path.join(config.out, `${entry.name}${suffix}.requests.jsonl`);
  const fd = fs.openSync(log, "w");
  const child = spawn(process.execPath, ["--import", hook, path.join(config.root, entry.directory, entry.script)], {
    cwd: path.join(config.root, entry.directory), env: { ...config.env, CM_TEST_NETWORK_NAMESPACE: "1", CM_TEST_REQUEST_LOG: requests, ...overrides },
    stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  const item = { entry, child, log, requests, exit: null, closed: false };
  child.once("exit", (code, signal) => { item.exit = { code, signal }; item.closed = true; });
  child.once("error", error => { item.exit = { error: error.message }; item.closed = true; });
  children.push(item); return item;
}
async function waitUntil(check, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await check()) return; await sleep(100); }
  throw Error("Isolated process condition timed out");
}
async function health(name) {
  const response = await fetch(`http://127.0.0.1:${ports[name]}/health`, { signal: AbortSignal.timeout(1000) });
  assert(response.ok); const body = await response.json();
  if (name !== "changmen-esport") assert.equal(body.service, name);
  return body;
}
async function stop(item) {
  if (!item.closed) item.child.kill("SIGTERM");
  try { await waitUntil(() => item.closed, 6500); }
  catch { item.child.kill("SIGKILL"); await waitUntil(() => item.closed, 3000); throw Error(`Graceful shutdown timed out: ${item.entry.name}`); }
}
try {
  const main = config.entries.map(entry => launch(entry));
  for (const item of main) {
    await waitUntil(async () => {
      assert(!item.closed, `${item.entry.name} exited: ${JSON.stringify(item.exit)}; ${read(item.log).slice(-2000)}`);
      if (ports[item.entry.name]) { try { await health(item.entry.name); } catch { return false; } }
      else if (!read(item.log).includes(markers[item.entry.name])) return false;
      return item.entry.name !== "changmen-esport" || read(item.log).includes("[matcher] embedded loop started");
    });
    report.processes.push({ name: item.entry.name, pid: item.child.pid, ready: true, healthChecked: !!ports[item.entry.name] });
  }
  await sleep(1000); assert(main.every(item => !item.closed), "An entry exited after readiness");
  const hub = config.entries.find(entry => entry.name === "changmen-pm-market-hub");
  const duplicate = launch(hub, "-port-conflict");
  await waitUntil(() => duplicate.closed); assert.equal(duplicate.exit.code, 1); assert.match(read(duplicate.log), /in use|EADDRINUSE/);
  await health(hub.name); report.failures.push({ case: "port-conflict", rejected: true, originalHealthy: true });
  const collector = config.entries.find(entry => entry.name === "changmen-pm-sports");
  const noDb = launch(collector, "-missing-db", { DATABASE_URL: "", CM_TEST_ALLOW_MISSING_DB: "1" });
  await waitUntil(() => noDb.closed); assert.equal(noDb.exit.code, 1); assert.match(read(noDb.log), /DATABASE_URL.*未配置/);
  report.failures.push({ case: "missing-database-config", rejected: true });
  const loaderLink = path.join(config.root, "node_modules/@changmen/venue-node"), target = fs.readlinkSync(loaderLink);
  fs.unlinkSync(loaderLink);
  try {
    const missing = launch(config.entries.find(entry => entry.name === "changmen-esport"), "-missing-loader");
    await waitUntil(() => missing.closed); assert.equal(missing.exit.code, 1); assert.match(read(missing.log), /ERR_MODULE_NOT_FOUND|Cannot find package/);
    report.failures.push({ case: "missing-node-loader", rejected: true });
  } finally { fs.symlinkSync(target, loaderLink); }
  for (const item of main) { assert(!item.closed); if (ports[item.entry.name]) await health(item.entry.name); }
  for (const item of main) {
    await stop(item); assert.equal(item.exit.code, 0, `${item.entry.name} did not exit cleanly`);
    report.processes.find(row => row.name === item.entry.name).shutdown = item.exit;
  }
  const requests = children.flatMap(item => read(item.requests).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  assert(requests.every(row => row.mocked && !row.blockedOrder)); report.mockedFetchCount = requests.length;
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.diagnostics = children.map(item => ({ name: item.entry.name, exit: item.exit, logTail: read(item.log).slice(-2400) }));
  process.exitCode = 1;
}
finally {
  for (const item of children) if (!item.closed) { try { await stop(item); } catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; } }
  report.allChildrenExited = children.every(item => item.closed);
  fs.writeFileSync(path.join(config.out, "runtime-verdict.json"), JSON.stringify(report, null, 2));
}
