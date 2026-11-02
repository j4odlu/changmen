#!/usr/bin/env bash
# Explicit infrastructure operation: keep the active application and its data intact.
set -Eeuo pipefail
umask 077
repo="${DEPLOY_REPO:?DEPLOY_REPO required}"
version="${NODE_RUNTIME_VERSION:?NODE_RUNTIME_VERSION required}"
link="${NODE_RUNTIME_LINK:-/usr/local/bin/node}"
service="${NODE_RUNTIME_SERVICE:-pm2-root.service}"
pm2_home="${PM2_HOME:-$HOME/.pm2}"
[[ "$repo" =~ ^/[a-zA-Z0-9_./-]+$ && "$repo" != / && "$repo" != *..* ]]
[[ "$version" =~ ^26\.[0-9]+\.[0-9]+$ ]]
[[ "$service" =~ ^[a-zA-Z0-9_-]+\.service$ ]]
systemctl cat "$service" > /dev/null
[[ "$link" == /*/node && "$link" != *..* && ! -d "$link" ]]
[[ ! -e "$link" || -L "$link" ]] || { echo 'Refusing to overwrite an unmanaged Node binary' >&2; exit 1; }
mkdir -p "$repo/.deploy-state" "$repo/.runtimes"
exec 9>"$repo/.deploy-state/backend.lock"
flock -w 900 9
active="$(readlink -f "$repo/backend-current")"
[[ "$active" == "$repo/.releases/backend/"* && -d "$active" ]]
checker="$active/scripts/deploy/verify-backend-processes.mjs"
previous="$(node --version)"
old_link="$(readlink "$link" || true)"
state="$repo/.deploy-state/node-runtime"
mkdir -p "$state"
chmod 700 "$state"
verify() {
  local expected="$1"
  pm2 jlist | node "$checker" "$active" || return 1
  pm2 jlist | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const a=JSON.parse(s); if(a.length!==8 || a.some(p=>p.pm2_env.status!=="online" || p.pm2_env.node_version!==process.argv[1])) process.exit(1);' "${expected#v}" || return 1
  # Health and matcher must recover before success is recorded.
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3456/health > "$state/health.json" || return 1
  node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1])); if(p.status!=="ok" || p.db?.connected!==true) process.exit(1);' "$state/health.json" || return 1
  (cd "$active" && node --input-type=module -e 'import {isMatcherRunning,readMatcherHeartbeat} from "./server/match/matcher/lib/heartbeat.js"; const h=readMatcherHeartbeat(); process.exit(h?.mode==="embedded" && isMatcherRunning(h)?0:1)') || return 1
  [[ "$(readlink -f "$repo/backend-current")" == "$active" ]]
}
verify "$previous"
if [[ "$previous" == "v$version" ]]; then echo "Node $version and all eight processes already verified"; exit 0; fi
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
runtime="$repo/.runtimes/node-v$version-linux-x64"
work="$(mktemp -d "$repo/.runtimes/download.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
archive="node-v$version-linux-x64.tar.xz"
curl --fail --silent --show-error --location --max-time 180 "https://nodejs.org/dist/v$version/$archive" -o "$work/$archive"
curl --fail --silent --show-error --location --max-time 30 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
(cd "$work" && grep "  $archive\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "$work/$archive" -C "$work"
candidate="$work/node-v$version-linux-x64"
[[ "$("$candidate/bin/node" --version)" == "v$version" ]]
if [[ -e "$runtime" ]]; then
  cmp "$candidate/bin/node" "$runtime/bin/node"
else
  mv "$candidate" "$runtime"
fi
verify "$previous"
pm2 save > /dev/null
cp "$pm2_home/dump.pm2" "$state/dump.before.pm2"
stop_manager() {
  # Wait for systemd's ExecStop and cgroup cleanup before starting a new daemon.
  systemctl stop "$service"
  local pid="$(cat "$pm2_home/pm2.pid" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    pm2 kill >> "$state/stop-pm2.log" 2>&1
  fi
}
start_manager() {
  # Never depend on a live dump that a failing daemon may have overwritten.
  cp "$state/dump.before.pm2" "$pm2_home/dump.pm2"
  systemctl start "$service" > "$1" 2>&1
}
rollback() {
  local status="$1"
  trap - ERR
  trap '' HUP INT TERM
  echo "Node upgrade failed; restoring $previous" >&2
  stop_manager
  if [[ -n "$old_link" ]]; then ln -sfn "$old_link" "$link.next"; mv -Tf "$link.next" "$link"; else rm -f "$link"; fi
  hash -r
  start_manager "$state/rollback-pm2.log"
  for attempt in $(seq 1 45); do if verify "$previous"; then echo 'Node rollback verified' >&2; exit "$status"; fi; sleep 2; done
  echo 'ERROR: Node rollback health failed; inspect PM2 immediately' >&2
  exit 1
}
trap 'rollback $?' ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
stop_manager
ln -sfn "$runtime/bin/node" "$link.next"
mv -Tf "$link.next" "$link"
hash -r
[[ "$(node --version)" == "v$version" ]]
# The service owns both the daemon and its eight applications.
start_manager "$state/upgrade-pm2.log"
recovered=0
for attempt in $(seq 1 45); do if verify "v$version"; then recovered=1; break; fi; sleep 2; done
[[ "$recovered" == 1 ]]
systemctl is-active --quiet "$service"
pm2 save > /dev/null
node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1],JSON.stringify({passed:true,node:process.version,previous:process.argv[2],active:process.argv[3],checkedAt:new Date().toISOString()},null,2));' "$state/verdict.json.next" "$previous" "$active"
trap '' HUP INT TERM
mv -f "$state/verdict.json.next" "$state/verdict.json"
trap - ERR HUP INT TERM
cat "$state/verdict.json"
