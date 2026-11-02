import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync, execFileSync } from "node:child_process";
import { backendProcesses } from "./verify-backend-processes.mjs";

const linux = { skip: process.platform !== "linux" };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-node-runtime-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-node-runtime-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, value, executable = false) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: executable ? 0o755 : 0o644 });
  };
  const repo = path.join(root, "app"), active = path.join(repo, ".releases/backend/fixture");
  const link = path.join(root, "system/node"), bin = path.join(root, "bin");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.mkdirSync(active, { recursive: true });
  fs.symlinkSync(active, path.join(repo, "backend-current"));
  write(path.join(active, "scripts/deploy/verify-backend-processes.mjs"), fs.readFileSync(new URL("./verify-backend-processes.mjs", import.meta.url)));
  write(path.join(active, "server/match/matcher/lib/heartbeat.js"), 'export const isMatcherRunning=()=>true; export const readMatcherHeartbeat=()=>({mode:"embedded"});');
  write(path.join(active, "package.json"), '{"type":"module"}');
  const entries = Object.entries(backendProcesses).map(([name, [dir, script]], i) => ({ name, pid: i + 1,
    pm2_env: { status: "online", node_version: "24.19.0", pm_cwd: path.join(active, dir), pm_exec_path: path.join(active, dir, script) } }));
  const apps = path.join(root, "apps.json");
  write(apps, JSON.stringify(entries));
  const source = path.join(root, "source"), archive = path.join(root, "node-v26.13.0-linux-x64.tar.xz");
  write(path.join(source, "node-v26.13.0-linux-x64/bin/node"), '#!/usr/bin/env bash\necho v26.13.0\n', true);
  execFileSync("tar", ["-cJf", archive, "-C", source, "."]);
  write(path.join(bin, "node"), `#!/usr/bin/env bash
if [[ "\u0024{1:-}" == --version ]]; then
  if [[ -L "$NODE_RUNTIME_LINK" ]]; then echo v26.13.0; else echo v24.19.0; fi
else exec "$TEST_REAL_NODE" "$@"; fi
`, true);
  write(path.join(bin, "curl"), `#!/usr/bin/env bash
out=; url=
while (( $# )); do case "$1" in -o) out="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac; done
if [[ "$url" == */health ]]; then echo '{"status":"ok","db":{"connected":true}}';
elif [[ "$url" == */SHASUMS256.txt ]]; then
  if [[ "\u0024{TEST_BAD_CHECKSUM:-}" == 1 ]]; then echo "0000000000000000000000000000000000000000000000000000000000000000  node-v26.13.0-linux-x64.tar.xz" > "$out";
  else (cd "$TEST_ROOT" && sha256sum node-v26.13.0-linux-x64.tar.xz) > "$out"; fi
else cp "$TEST_ARCHIVE" "$out"; fi
`, true);
  write(path.join(bin, "pm2"), `#!/usr/bin/env bash
case "$1" in
 jlist) cat "$TEST_APPS";;
 update)
   if [[ -L "$NODE_RUNTIME_LINK" ]]; then version=26.13.0; else version=24.19.0; fi
   "$TEST_REAL_NODE" -e 'const fs=require("node:fs"),f=process.argv[1],a=JSON.parse(fs.readFileSync(f)); for(const p of a)p.pm2_env.node_version=process.argv[2]; fs.writeFileSync(f,JSON.stringify(a));' "$TEST_APPS" "$version"
   echo "$version" >> "$TEST_ROOT/updates"
   if [[ "\u0024{TEST_FAIL_UPDATE:-}" == 1 && "$version" == 26.13.0 ]]; then exit 23; fi;;
 save) echo saved > "$TEST_ROOT/saved";;
 *) exit 2;; esac
`, true);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_REPO: repo, NODE_RUNTIME_VERSION: "26.13.0",
    NODE_RUNTIME_LINK: link, TEST_REAL_NODE: process.execPath, TEST_ROOT: root, TEST_APPS: apps, TEST_ARCHIVE: archive };
  const run = overrides => spawnSync("bash", [new URL("./upgrade-node-runtime.sh", import.meta.url).pathname],
    { env: { ...env, ...overrides }, encoding: "utf8", timeout: 30000 });
  return { root, repo, active, link, apps, run };
}

test("Node upgrade verifies the archive, restarts eight processes and keeps the active app", linux, t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(f.repo, ".deploy-state/node-runtime/verdict.json")));
  assert.equal(verdict.node, "v26.13.0"); assert.equal(verdict.previous, "v24.19.0");
  assert.equal(fs.realpathSync(path.join(f.repo, "backend-current")), f.active);
  assert.equal(fs.readFileSync(path.join(f.root, "updates"), "utf8"), "26.13.0\n");
  assert(fs.existsSync(path.join(f.root, "saved")));
});

test("failed PM2 upgrade restores the original Node and verifies the previous eight processes", linux, t => {
  const f = fixture(t), result = f.run({ TEST_FAIL_UPDATE: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node rollback verified/);
  assert(!fs.existsSync(f.link));
  assert.equal(fs.readFileSync(path.join(f.root, "updates"), "utf8"), "26.13.0\n24.19.0\n");
  assert(!fs.existsSync(path.join(f.repo, ".deploy-state/node-runtime/verdict.json")));
});

for (const mode of ["checksum", "processes", "unmanaged binary"])
  test(`Node upgrade rejects ${mode} before restarting production`, linux, t => {
    const f = fixture(t);
    if (mode === "processes") fs.writeFileSync(f.apps, "[]");
    if (mode === "unmanaged binary") fs.writeFileSync(f.link, "unmanaged");
    const result = f.run(mode === "checksum" ? { TEST_BAD_CHECKSUM: "1" } : {});
    assert.notEqual(result.status, 0);
    assert(!fs.existsSync(path.join(f.root, "updates")));
  });
