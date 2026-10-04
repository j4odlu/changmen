#!/usr/bin/env bash
set -Eeuo pipefail
scope=backend
source "$(dirname "$0")/release-common.sh"
archive="${1:?archive required}"
validate_archive "$archive"
release="$repo/.releases/backend/$id"
test ! -e "$release"
mkdir -p "$release"
# Full workspace layout, isolated from the live frontend and its node_modules.
tar -xzf "$archive" -C "$release" \
  --exclude='client/web/dist' --exclude='./client/web/dist' \
  --exclude='server/backend/.env' --exclude='./server/backend/.env' \
  --exclude='server/backend/storage' --exclude='./server/backend/storage'
test -f "$release/package-lock.json"
test -f "$repo/server/backend/.env"
mkdir -p "$repo/server/backend/storage"
previous="$repo"
if [[ -L "$repo/backend-current" ]]; then previous="$(readlink -f "$repo/backend-current")"; fi
changes="$repo/.deploy-state/backend-changes.$id"
# Compare pristine archive files before adding runtime links/dependencies.
node "$release/scripts/deploy/compare-deployed-files.mjs" "$release" "$previous" "$changes"
ln -s "$repo/server/backend/.env" "$release/server/backend/.env"
ln -s "$repo/server/backend/storage" "$release/server/backend/storage"
# [changmen 扩展] Published extension ZIPs are runtime assets, excluded from git archives.
# Keep them available when switching to a new isolated backend release.
mkdir -p "$release/server/backend/public/extensions"
for extension_package in "$repo/server/backend/public/extensions/"*.zip; do
  if [[ -f "$extension_package" ]]; then
    cp "$extension_package" "$release/server/backend/public/extensions/"
  fi
done
if [[ -f "$repo/server/match/matcher/.env" ]]; then
  ln -s "$repo/server/match/matcher/.env" "$release/server/match/matcher/.env"
fi
ln -s "$repo/client/web/dist" "$release/client/web/dist"
bootstrap_config="$repo/.deploy-state/backend-bootstrap-ecosystem.cjs"
if [[ "$previous" == "$repo" ]]; then
  test -f "$repo/deploy/ecosystem.config.cjs"
  cp "$repo/deploy/ecosystem.config.cjs" "$bootstrap_config"
fi
cd "$release"
npm ci --include=dev
npm run compile:router --workspace=@changmen/backend
command -v pm2 >/dev/null
activate() {
  DEPLOY_REPO="$1" DEPLOY_RELEASE_MODE=1 DEPLOY_SCHEMA_CHANGED="$2" DEPLOY_FULL=0 DEPLOY_CHANGED_PATHS_FILE="${3:-}" DEPLOY_SKIP_GIT_PULL=1 \
    DEPLOY_SKIP_APP_BUILD=1 DEPLOY_SKIP_POSTCHECK=1 bash "$release/deploy/scripts/deploy-server-remote.sh"
}
rollback() {
  trap - ERR
  echo "Backend activation failed; restoring $previous (database changes are not reverted)" >&2
  if [[ "$previous" == "$repo" ]]; then
    cp "$bootstrap_config" "$repo/deploy/ecosystem.config.cjs.rollback"
    mv -f "$repo/deploy/ecosystem.config.cjs.rollback" "$repo/deploy/ecosystem.config.cjs"
    if [[ -L "$repo/backend-current" ]]; then rm "$repo/backend-current"; fi
  elif [[ -L "$repo/backend-current" ]]; then
    switch_link "$previous" "$repo/backend-current"
  fi
  activate "$previous" 0 || { echo 'ERROR: backend rollback failed; inspect PM2 immediately' >&2; return 1; }
}
trap rollback ERR
activate "$release" 0 "$changes"
for attempt in $(seq 1 45); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3456/health >/dev/null \
    && node --input-type=module -e 'import {isMatcherRunning,readMatcherHeartbeat} from "./server/match/matcher/lib/heartbeat.js"; const h=readMatcherHeartbeat(); process.exit(h?.mode === "embedded" && isMatcherRunning(h) ? 0 : 1)'; then break; fi
  test "$attempt" != 45
  sleep 3
done
node --input-type=module -e 'import {loadChangmenEnv} from "@changmen/storage/load_env.js"; loadChangmenEnv(); const {initDatabaseUrl,buildPgClientConfig}=await import("@changmen/db"); const {default:pg}=await import("@changmen/db/pg.js"); await initDatabaseUrl(); const c=new pg.Client(buildPgClientConfig(process.env.DATABASE_URL,10000)); await c.connect(); try {await c.query("SELECT 1")} finally {await c.end()}'
pm2 jlist | node --input-type=module -e 'let s=""; for await (const b of process.stdin) s+=b; const apps=JSON.parse(s); const names=["changmen-esport","changmen-pm-sports","changmen-polymarket-collector","changmen-pm-football-collector","changmen-predictfun-collector","changmen-pm-market-hub","changmen-pm-sport-market-hub","changmen-predictfun-market-hub"]; for(const name of names) {if(!apps.some(a=>a.name===name && a.pm2_env.status==="online" && a.pm2_env.pm_cwd.startsWith(process.cwd()+"/"))) throw new Error("Unhealthy/wrong release: "+name)}'
switch_link "$release" "$repo/backend-current"
# Legacy watchdog fallback uses this stable path. Route it to the successful
# release instead of allowing it to restart stale source in the original root.
printf '%s\n' 'module.exports = require("../backend-current/deploy/ecosystem.config.cjs");' > "$repo/deploy/ecosystem.config.cjs.next"
mv -f "$repo/deploy/ecosystem.config.cjs.next" "$repo/deploy/ecosystem.config.cjs"
record_success
trap - ERR
echo "Published backend $sha; previous=$previous; frontend dist untouched"
