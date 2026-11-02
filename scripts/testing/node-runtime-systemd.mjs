// Explicit Linux/root fixture for the real PM2 + systemd lifecycle, without production data.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { backendProcesses } from "../deploy/verify-backend-processes.mjs";

assert.equal(process.platform, "linux"); assert.equal(process.getuid(), 0);
assert(["22", "24"].includes(process.versions.node.split(".")[0]), "Run the transition fixture with Node 22 or 24");
const [pm2, archive, reportFile] = process.argv.slice(2);
assert(fs.existsSync(pm2) && fs.existsSync(archive) && reportFile);
assert.equal(createHash("sha256").update(fs.readFileSync(archive)).digest("hex"), "d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997");
await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(3456, "127.0.0.1", () => s.close(resolve)); });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-real-node-systemd-"));
const service = `changmen-node-fixture-${process.pid}.service`, unit = `/run/systemd/system/${service}`;
const app = path.join(root, "app"), active = path.join(app, ".releases/backend/fixture"), bin = path.join(root, "bin");
const pm2Home = path.join(root, "pm2"), result = { passed: false, previous: process.version, productionWrites: false, simulatedApplications: true, scenarios: [] };
fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(active, { recursive: true }); fs.mkdirSync(pm2Home);
const write = (file, value, executable = false) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { mode: executable ? 0o755 : 0o644 }); };
const nodeLink = path.join(bin, "node"); fs.symlinkSync(process.execPath, nodeLink); fs.symlinkSync(pm2, path.join(bin, "pm2"));
fs.symlinkSync(active, path.join(app, "backend-current"));
write(path.join(active, "package.json"), '{"type":"module"}');
write(path.join(active, "scripts/deploy/verify-backend-processes.mjs"), fs.readFileSync(new URL("../deploy/verify-backend-processes.mjs", import.meta.url)));
write(path.join(active, "server/match/matcher/lib/heartbeat.js"), 'export const isMatcherRunning=()=>true; export const readMatcherHeartbeat=()=>({mode:"embedded"});');
const apps = Object.entries(backendProcesses).map(([name, [directory, script]]) => {
  const entry = path.join(active, directory, script);
  write(entry, name === "changmen-esport"
    ? 'import http from "node:http"; http.createServer((q,s)=>{s.setHeader("Content-Type","application/json");s.end(JSON.stringify({status:"ok",db:{connected:true}}));}).listen(3456,"127.0.0.1");'
    : 'setInterval(()=>{},1000);');
  return { name, cwd: path.join(active, directory), script: entry, interpreter: "node" };
});
const config = path.join(root, "ecosystem.config.cjs"); write(config, "module.exports=" + JSON.stringify({ apps }));
write(path.join(bin, "curl"), `#!/usr/bin/env bash
out=; url=
args=("$@")
while (( $# )); do case "$1" in -o) out="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac; done
if [[ "$url" == */health ]]; then exec /usr/bin/curl "\u0024{args[@]}";
elif [[ "$url" == */SHASUMS256.txt ]]; then printf '%s  node-v26.13.0-linux-x64.tar.xz\\n' "$TEST_NODE_SHA" > "$out";
else cp "$TEST_NODE_ARCHIVE" "$out"; fi
`, true);
write(path.join(bin, "systemctl"), `#!/usr/bin/env bash
/usr/bin/systemctl "$@"
status=$?
if [[ "$1" == start && "\u0024{TEST_FAIL_START:-}" == 1 && "$(readlink "$NODE_RUNTIME_LINK")" == *node-v26.13.0* ]]; then exit 23; fi
exit "$status"
`, true);
const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PM2_HOME: pm2Home, DEPLOY_REPO: app,
  NODE_RUNTIME_VERSION: "26.13.0", NODE_RUNTIME_LINK: nodeLink, NODE_RUNTIME_SERVICE: service,
  TEST_NODE_ARCHIVE: archive, TEST_NODE_SHA: "d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997" };
const run = (command, args, options = {}) => execFileSync(command, args, { env, encoding: "utf8", stdio: "pipe", ...options });
const state = () => JSON.parse(run(pm2, ["jlist"]));
const upgrade = extra => spawnSync("bash", [fileURLToPath(new URL("../deploy/upgrade-node-runtime.sh", import.meta.url))],
  { env: { ...env, ...extra }, encoding: "utf8", timeout: 180000 });
write(unit, `[Unit]\nDescription=Isolated changmen Node fixture\n[Service]\nType=forking\nUser=root\nEnvironment=PATH=${bin}:/usr/bin:/bin\nEnvironment=PM2_HOME=${pm2Home}\nPIDFile=${pm2Home}/pm2.pid\nExecStart=${pm2} resurrect\nExecStop=${pm2} kill\nRestart=on-failure\n`);
try {
  run("/usr/bin/systemctl", ["daemon-reload"]);
  // First adopt an existing daemon outside the unit, as after a failed pm2 update.
  run(pm2, ["start", config]); run(pm2, ["save"]);
  // The injected error occurs after the real service has started under Node 26.
  const failed = upgrade({ TEST_FAIL_START: "1" });
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /Node rollback verified/);
  assert.equal(state().length, 8); assert(state().every(p => p.pm2_env.node_version === process.versions.node));
  assert.equal(run("/usr/bin/systemctl", ["is-active", service]).trim(), "active");
  result.scenarios.push("orphan-daemon-adoption-and-real-systemd-partial-start-rollback");
  const success = upgrade({});
  assert.equal(success.status, 0, success.stdout + success.stderr);
  const live = state(); assert.equal(live.length, 8); assert(live.every(p => p.pm2_env.node_version === "26.13.0"));
  const daemon = run("/usr/bin/systemctl", ["show", service, "-p", "MainPID", "--value"]).trim();
  assert.equal(fs.realpathSync(`/proc/${daemon}/exe`), fs.realpathSync(nodeLink));
  result.node = "v26.13.0"; result.scenarios.push("real-systemd-eight-process-upgrade"); result.passed = true;
} finally {
  spawnSync("/usr/bin/systemctl", ["stop", service], { env });
  spawnSync(pm2, ["kill"], { env, stdio: "ignore" });
  fs.unlinkSync(unit); spawnSync("/usr/bin/systemctl", ["daemon-reload"]);
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("changmen-real-node-systemd-"));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
