#!/usr/bin/env node
/**
 * Fast HK deploy: only changed source files + GHA dist (~3MB), not full 59MB repo.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const changmen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sshKey = path.join(os.homedir(), ".ssh", "id_ed25519_changmen");
const distArchive = path.join(os.tmpdir(), "changmen-gha-dist", "changmen-dist.tgz");
const deployRepo = "/root/changmen";

const HOSTS = [
  { label: "HK-57", host: "47.57.10.202" },
];

const FILES = [
  "client/web/src/components/account/AccountEditDialog.vue",
  "client/web/src/stores/account/accountCrud.ts",
  "server/backend/core/account/account_store.js",
  "server/db/impl_rds.js",
  "server/db/index.js",
  "server/db/rds/player_store.js",
];

const sshBase = [
  "-i", sshKey,
  "-o", "IdentitiesOnly=yes",
  "-o", "ServerAliveInterval=15",
  "-o", "ConnectTimeout=30",
  "-o", "BatchMode=yes",
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

function ssh(host, remoteCmd) {
  run("ssh", [...sshBase, `root@${host}`, remoteCmd]);
}

function scp(host, local, remotePath) {
  run("scp", [...sshBase, local, `root@${host}:${remotePath}`]);
}

if (!fs.existsSync(distArchive)) {
  console.error("missing", distArchive);
  process.exit(1);
}
for (const f of FILES) {
  if (!fs.existsSync(path.join(changmen, f))) {
    console.error("missing", f);
    process.exit(1);
  }
}

const results = [];
for (const h of HOSTS) {
  console.log(`\n========== Fast deploy ${h.label} (${h.host}) ==========`);
  try {
    for (const f of FILES) {
      const remoteDir = path.posix.dirname(`${deployRepo}/${f}`);
      ssh(h.host, `mkdir -p ${remoteDir}`);
      scp(h.host, path.join(changmen, f), `${deployRepo}/${f}`);
    }

    scp(h.host, distArchive, "/tmp/changmen-dist.tgz");
    ssh(h.host, `set -euo pipefail
archive=/tmp/changmen-dist.tgz
app=${deployRepo}/client/web
tmp="$app/dist.upload.$$"
tar -tzf "$archive" >/dev/null
rm -rf "$tmp"
mkdir -p "$tmp"
tar -xzf "$archive" -C "$tmp"
test -f "$tmp/index.html"
rm -rf "$app/dist.prev"
[ -d "$app/dist" ] && mv "$app/dist" "$app/dist.prev"
mv "$tmp" "$app/dist"
rm -rf "$app/dist.prev" "$archive"
chmod -R a+rX "$app/dist"
cd ${deployRepo}
pm2 restart changmen-esport --update-env
sleep 2
curl -sf -o /dev/null http://127.0.0.1:3456/ || curl -sf -o /dev/null http://127.0.0.1/
grep -n 'props.account?.accountId' ${deployRepo}/client/web/src/components/account/AccountEditDialog.vue | head -1
`);
    console.log(`OK ${h.label}`);
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
console.log("Done.");
