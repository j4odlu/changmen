// [changmen 扩展] Linux lifecycle and startup experiment; never a publisher.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backendInstallProfile, assertBackendInstalledLinks, assertBackendBrowserPackagesAbsent } from "../deploy/backend-install-profile.mjs";
import { certifyBackendDynamicPaths, assertDynamicPathParity } from "../verification/backend-dynamic-paths.mjs";
import { readInstallWorkspaces } from "../verification/component-install-inputs.mjs";
import { captureBackendResolution, assertBackendResolutionParity } from "../verification/backend-install-resolution.mjs";
import { validationIdentity } from "../verification/verify-change.mjs";
import { installBackend } from "../deploy/install-backend.mjs";

assert.equal(process.platform, "linux", "Linux runner required; Windows installation evidence is separate");
assert.equal(process.getuid() === 0, false, "Run fixture database as an ordinary user");
assert(process.version.startsWith("v24."), "Node 24 required");
const repo = fileURLToPath(new URL("../../", import.meta.url)), out = path.join(repo, "output/backend-linux-runtime");
fs.mkdirSync(out, { recursive: true });
const identity = validationIdentity(repo), profile = backendInstallProfile(repo), temporary = fs.mkdtempSync("/tmp/changmen-linux-check-");
const npm = [process.env.CHANGMEN_TEST_NPM_CLI, process.env.npm_execpath,
  path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")].find(file => file && fs.existsSync(file));
const pgBin = process.env.CHANGMEN_TEST_PG_BIN;
assert(npm && fs.existsSync(npm)); assert(pgBin && fs.existsSync(path.join(pgBin, "initdb")));
const env = { PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: path.join(temporary, "home"),
  LANG: "C.UTF-8", TZ: "Asia/Taipei", NODE_OPTIONS: "", NODE_PATH: "", LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || "",
  DATABASE_URL: "", DATABASE_URL_PUBLIC: "", DATABASE_URL_INTERNAL: "" };
fs.mkdirSync(env.HOME);
const report = { passed: false, sourceStable: false, identity, temporary, node: process.version,
  npm: JSON.parse(fs.readFileSync(path.resolve(path.dirname(npm), "../package.json"), "utf8")).version,
  platform: process.platform, arch: process.arch, lifecycleScriptsEnabled: true, productionEnabled: false,
  productionWrites: false, liveMarketVerified: false, profile, steps: [] };
const save = () => fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify(report, null, 2)); save();
const execute = (name, command, args, cwd, selectedEnv = env) => {
  const fd = fs.openSync(path.join(out, `${name}.log`), "w"), started = Date.now(); let result;
  try { result = spawnSync(command, args, { cwd, env: selectedEnv, stdio: ["ignore", fd, fd], timeout: 300000, windowsHide: true }); }
  finally { fs.closeSync(fd); }
  const passed = result.status === 0 && !result.error;
  report.steps.push({ name, passed, exitCode: result.status, errorCode: result.error?.code ?? null, elapsedMs: Date.now() - started }); save();
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  assert(passed, `${name} failed; inspect ${path.join(out, `${name}.log`)}`);
  return result;
};
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repo, encoding: "utf8", maxBuffer: 30e6 }).split("\0").filter(Boolean);
const manifests = new Set([...readInstallWorkspaces(repo).values()].map(item => `${item.dir}/package.json`));
const copy = root => {
  fs.mkdirSync(root);
  for (const file of files) {
    if (!["package.json", "package-lock.json", "deploy/ecosystem.config.cjs"].includes(file) && !manifests.has(file)
      && !profile.workspaceDirectories.some(dir => file.startsWith(`${dir}/`))) continue;
    if (/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.npmrc$|\.(?:pem|key|pfx|p12)$|^server\/backend\/storage\//i.test(file)) continue;
    const source = path.join(repo, file); if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  }
};
const full = path.join(temporary, "full"), selected = path.join(temporary, "selected"), data = path.join(temporary, "pg-data"), socket = path.join(temporary, "socket"), runtimeOut = path.join(temporary, "runtime");
let pgStarted = false;
try {
  const flags = ["--offline", "--ignore-scripts=false", "--foreground-scripts", "--no-audit", "--no-fund",
    "--cache", process.env.CHANGMEN_TEST_NPM_CACHE || path.join(os.homedir(), ".npm")];
  for (const root of [full, selected]) copy(root);
  execute("full-install", process.execPath, [npm, "ci", "--include=dev", ...flags], full);
  installBackend(selected, { npm, run: (command, args) => execute("selected-install", command, [...args, ...flags], selected) });
  for (const root of [full, selected]) {
    for (const file of ["package.json", "package-lock.json"]) assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(repo, file))));
    execute(root === full ? "full-router" : "selected-router", process.execPath, [npm, "run", "compile:router", "--workspace=@changmen/backend"], root);
    const require = createRequire(path.join(root, "server/backend/package.json"));
    const esbuild = require("esbuild"); assert.match(esbuild.transformSync("const value: number = 42", { loader: "ts" }).code, /value = 42/);
    assert.match(fs.readFileSync(path.join(out, root === full ? "full-install.log" : "selected-install.log"), "utf8"), /esbuild@.*postinstall/);
  }
  assertBackendInstalledLinks(profile, fs.readdirSync(path.join(selected, "node_modules/@changmen")));
  assertBackendBrowserPackagesAbsent(selected, profile);
  report.browserPackagesAbsent = true;
  report.installedWorkspaces = fs.readdirSync(path.join(selected, "node_modules/@changmen")).sort();
  report.nativeEsbuildExecuted = true;
  const fullResolution = captureBackendResolution(full, profile.entries, env), selectedResolution = captureBackendResolution(selected, profile.entries, env);
  fs.writeFileSync(path.join(out, "full-resolution.json"), JSON.stringify(fullResolution, null, 2));
  fs.writeFileSync(path.join(out, "selected-resolution.json"), JSON.stringify(selectedResolution, null, 2));
  assertBackendResolutionParity(fullResolution, selectedResolution);
  report.resolution = { files: selectedResolution.files.length, literals: selectedResolution.resolutions.length, unresolved: selectedResolution.unresolved.length, unknown: selectedResolution.unknown.length, parityPassed: true };
  const certificates = [full, selected].map(root => certifyBackendDynamicPaths(root, profile.entries, env));
  assertDynamicPathParity(...certificates);
  report.dynamicPaths = { passed: true, original: certificates[1].records.length, expanded: certificates[1].expandedRecords.length,
    uncertified: certificates[1].uncertified.length };
  fs.mkdirSync(socket);
  execute("pg-init", path.join(pgBin, "initdb"), ["-D", data, "-U", "changmen_test", "--auth=trust", "--no-locale", "--encoding=UTF8", "--no-sync"], temporary);
  fs.appendFileSync(path.join(data, "postgresql.conf"), `\nlisten_addresses = ''\nunix_socket_directories = '${socket}'\nport = 5432\n`);
  execute("pg-start", path.join(pgBin, "pg_ctl"), ["-D", data, "-l", path.join(temporary, "postgres.log"), "-w", "start"], temporary); pgStarted = true;
  const url = `postgresql://changmen_test@localhost:5432/postgres?host=${encodeURIComponent(socket)}`;
  const databaseEnv = { ...env, DATABASE_URL: url, DATABASE_SSL: "0", CHANGMEN_STORAGE_DIR: path.join(temporary, "storage"), ESPORT_DATA_DIR: path.join(temporary, "storage/esport") };
  const init = `import pg from 'pg';import{initializeEmptyRdsSchema}from ${JSON.stringify(pathToFileURL(path.join(selected, "rds/maintenance/apply-rds-schema.mjs")).href)};const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await initializeEmptyRdsSchema(c);}finally{await c.end();}`;
  execute("pg-schema", process.execPath, ["--input-type=module", "--eval", init], selected, databaseEnv);
  fs.mkdirSync(runtimeOut);
  const runtimeEnv = { ...databaseEnv, NODE_ENV: "production", PORT: "18000", PM_MARKET_HUB_PORT: "18001", PM_SPORT_MARKET_HUB_PORT: "18002", PREDICTFUN_MARKET_HUB_PORT: "18003",
    JWT_SECRET: "changmen-isolated-startup-fixture-not-for-production", CM_TEST_DATABASE_SOCKET: socket,
    CHANGMEN_VPS_MARKET_INDEX_SYNC: "0", PM_FOOTBALL_COLLECTOR_OWNED: "1", MATCH_COMPOSER_WRITE: "0",
    PREDICT_FUN_API_KEY: "isolated-startup-fixture-key" };
  const configFile = path.join(temporary, "runtime-config.json");
  fs.writeFileSync(configFile, JSON.stringify({ root: selected, out: runtimeOut, env: runtimeEnv, entries: profile.entries }));
  execute("runtime", "sudo", ["-n", "unshare", "--net", "/bin/sh", fileURLToPath(new URL("./backend-runtime-namespace.sh", import.meta.url)),
    process.execPath, fileURLToPath(new URL("./backend-process-smoke.mjs", import.meta.url)), configFile], temporary);
  report.runtime = JSON.parse(fs.readFileSync(path.join(runtimeOut, "runtime-verdict.json"), "utf8"));
  assert(report.runtime.passed && report.runtime.allChildrenExited);
  fs.cpSync(runtimeOut, path.join(out, "runtime"), { recursive: true });
  report.sourceStable = JSON.stringify(validationIdentity(repo)) === JSON.stringify(identity); assert(report.sourceStable);
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (fs.existsSync(runtimeOut)) {
    fs.cpSync(runtimeOut, path.join(out, "runtime"), { recursive: true });
    const verdict = path.join(runtimeOut, "runtime-verdict.json");
    if (fs.existsSync(verdict)) report.runtime = JSON.parse(fs.readFileSync(verdict, "utf8"));
  }
  if (pgStarted || fs.existsSync(path.join(data, "postmaster.pid"))) {
    try { execute("pg-stop", path.join(pgBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], temporary); report.databaseStopped = true; }
    catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  }
  save();
}
