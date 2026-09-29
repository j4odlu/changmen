#!/usr/bin/env node
/**
 * Deploy repo + local dist to HK hosts.
 * Default: pack dist from client/web/dist (must exist — run with --build to build first).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packGitRepoArchive } from "./pack-git-repo.mjs";

const changmen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sshKey = path.join(os.homedir(), ".ssh", "id_ed25519_changmen");
const deployRepo = "/root/changmen";
const remoteScripts = "/tmp/changmen-deploy";
const repoArchive = path.join(os.tmpdir(), `changmen-repo-${process.pid}.tgz`);
const distDir = path.join(changmen, "client/web/dist");
const distArchive = path.join(os.tmpdir(), "changmen-gha-dist", "changmen-dist.tgz");

function readLocalPredictFunApiKey() {
  if (String(process.env.PREDICT_FUN_API_KEY || "").trim())
    return String(process.env.PREDICT_FUN_API_KEY).trim();
  const candidates = [
    path.join(changmen, "server/backend/.env"),
    path.join(changmen, "client/web/.env.production"),
    path.join(changmen, "client/web/.env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file))
      continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^(?:VITE_)?PREDICT_FUN_API_KEY=(.+)$/);
      const val = m?.[1]?.trim();
      if (val)
        return val;
    }
  }
  return "";
}

const args = new Set(process.argv.slice(2));
const hostArgs = process.argv.slice(2).filter(a => !a.startsWith("-"));
const HOSTS = hostArgs.length
  ? hostArgs.map(host => ({ label: host, host }))
  : [
      { label: "HK-57", host: "47.57.10.202" },
    ];

const sshBase = [
  "-i", sshKey,
  "-o", "IdentitiesOnly=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=8",
  "-o", "ConnectTimeout=60",
  "-o", "BatchMode=yes",
];

const deployScripts = [
  "apply-repo-archive.sh",
  "deploy-server-remote.sh",
  "sync-hk-relay-env-remote.sh",
  "sync-pm-hk-relay-env-remote.sh",
];

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

function ssh(host, remoteCmd) {
  run("ssh", [...sshBase, `root@${host}`, remoteCmd], { shell: false });
}

function scp(host, local, remotePath) {
  run("scp", [...sshBase, local, `root@${host}:${remotePath}`], { shell: false });
}

function packLocalDist() {
  const indexHtml = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtml))
    throw new Error(`missing ${indexHtml} — run: npm run app:build  (or pass --build)`);
  fs.mkdirSync(path.dirname(distArchive), { recursive: true });
  if (fs.existsSync(distArchive))
    fs.unlinkSync(distArchive);
  run("tar", ["-czf", distArchive, "-C", distDir, "."]);
  console.log(`==> packed dist -> ${distArchive}`);
}

if (args.has("--build")) {
  console.log("=== Build frontend ===");
  run("npm", ["run", "app:build"], { cwd: changmen });
}

console.log("=== Pack dist ===");
packLocalDist();

console.log("=== Pack repo (git HEAD only) ===");
try {
  if (fs.existsSync(repoArchive)) fs.unlinkSync(repoArchive);
}
catch {
  /* ignore locked temp from previous run */
}
packGitRepoArchive(changmen, repoArchive);
const scriptPaths = deployScripts.map(name => path.join(changmen, "deploy/scripts", name));

const results = [];
for (const h of HOSTS) {
  console.log(`\n========== Deploy ${h.label} (${h.host}) ==========`);
  try {
    scp(h.host, repoArchive, "/tmp/changmen-repo.upload.tgz");
    ssh(h.host, `mkdir -p ${remoteScripts}`);
    run("scp", [...sshBase, ...scriptPaths, `root@${h.host}:${remoteScripts}/`], { shell: false });
    ssh(h.host, `sed -i 's/\\r$//' ${remoteScripts}/*.sh`);
    ssh(h.host, [
      "set -e",
      "mv /tmp/changmen-repo.upload.tgz /tmp/changmen-repo.tgz",
      // Windows bsdtar gzip 常被 Linux gzip -t 误判；用 tar -tzf 校验即可
      "tar -tzf /tmp/changmen-repo.tgz >/dev/null",
      `DEPLOY_REPO=${deployRepo} CHANGMEN_DEPLOY_SCRIPTS=${remoteScripts} DEPLOY_SKIP_APP_BUILD=1 DEPLOY_SKIP_POSTCHECK=1 DEPLOY_FULL=0 bash ${remoteScripts}/apply-repo-archive.sh /tmp/changmen-repo.tgz`,
      `find ${deployRepo}/deploy/scripts -name '*.sh' -exec sed -i 's/\\r$//' {} +`,
    ].join("; "));

    scp(h.host, distArchive, "/tmp/changmen-dist.tgz");
    // Windows PowerShell mangles inline ssh with [^"]* — apply via script file.
    const applyDistLocal = path.join(changmen, "deploy/scripts/apply-dist-archive.sh");
    scp(h.host, applyDistLocal, `${remoteScripts}/apply-dist-archive.sh`);
    ssh(h.host, `sed -i 's/\\r$//' ${remoteScripts}/apply-dist-archive.sh; bash ${remoteScripts}/apply-dist-archive.sh /tmp/changmen-dist.tgz`);

    ssh(h.host, `cd ${deployRepo}/server/backend; node scripts/ops/diagnostics/post-deploy-check.mjs --skip-telegram`);

    console.log("==> sync HK relay env (whitelist + pm2 restart)");
    const predictKey = readLocalPredictFunApiKey();
    ssh(h.host, `set -e
for i in 1 2 3 4 5; do
  if [ -f ${deployRepo}/server/backend/.env ]; then break; fi
  sleep 1
done
test -f ${deployRepo}/server/backend/.env
cd ${deployRepo} && PREDICT_FUN_API_KEY='${predictKey.replace(/'/g, "'\\''")}' bash deploy/scripts/sync-hk-relay-env-remote.sh`);

    // PREDICTFUN-MARKET / PM-MARKET 在独立 hub；status 经 hubs 注入 platforms，并探 :3458/health
    ssh(h.host, `set -e
status="$(curl -sf http://127.0.0.1/api/proxy/status 2>/dev/null || curl -sf http://127.0.0.1:3456/api/proxy/status)"
echo "$status"
echo "$status" | grep -q '"PREDICTFUN-MARKET"'
curl -sf http://127.0.0.1:3458/health | grep -q '"changmen-predictfun-market-hub"'
curl -sf http://127.0.0.1:3457/health | grep -q '"changmen-pm-market-hub"' || true`);
    ssh(h.host, `curl -sf -o /dev/null http://127.0.0.1/ || curl -sf -o /dev/null http://127.0.0.1:3456/`);
    console.log(`OK ${h.label} http://${h.host}/`);
    results.push({ ...h, ok: true });
  }
  catch (err) {
    console.error(`FAIL ${h.label}:`, err.message || err);
    results.push({ ...h, ok: false, error: String(err.message || err) });
  }
}

console.log("\n=== Summary ===");
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.label} ${r.host}${r.error ? ` — ${r.error}` : ""}`);
}
if (results.some(r => !r.ok)) process.exit(1);
