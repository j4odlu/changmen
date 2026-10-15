#!/usr/bin/env bash
set -Eeuo pipefail
scope=backend
source "$(dirname "$0")/release-common.sh"
archive="${1:?archive required}"
validate_archive "$archive"
prune_releases
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
# Candidate requirements, read-only, before activation or rollback traps: failure
# must leave the running processes, links and success marker untouched.
# Migrations/data maintenance remain a separate, explicitly reviewed lifecycle.
node --input-type=module -e 'import {loadChangmenEnv} from "@changmen/storage/load_env.js"; loadChangmenEnv(); const {checkConfiguredRdsSchema}=await import("./server/backend/scripts/check-rds-schema.mjs"); await checkConfiguredRdsSchema()'
# Managed releases already retain their sealed identity. Refuse to replace one
# without the evidence needed to verify recovery, before changing any process.
rollback_evidence="$repo/.deploy-state/backend-evidence.$(basename "$previous").json"
if [[ "$previous" != "$repo" ]]; then test -s "$rollback_evidence"; fi
verify_processes() {
  pm2 jlist | node "$release/scripts/deploy/verify-backend-processes.mjs" "$1"
}
activate() {
  DEPLOY_REPO="$1" DEPLOY_RELEASE_MODE=1 DEPLOY_FULL=0 DEPLOY_SKIP_GIT_PULL=1 \
    DEPLOY_SKIP_APP_BUILD=1 DEPLOY_SKIP_POSTCHECK=1 bash "$release/deploy/scripts/deploy-server-remote.sh"
}
rollback() {
  trap - ERR
  echo "Backend activation failed; restoring runtime $previous (no database migration)" >&2
  if [[ "$previous" == "$repo" ]]; then
    cp "$bootstrap_config" "$repo/deploy/ecosystem.config.cjs.rollback"
    mv -f "$repo/deploy/ecosystem.config.cjs.rollback" "$repo/deploy/ecosystem.config.cjs"
    if [[ -L "$repo/backend-current" ]]; then rm "$repo/backend-current"; fi
  elif [[ -L "$repo/backend-current" ]]; then
    switch_link "$previous" "$repo/backend-current"
  fi
  activate "$previous" || { echo 'ERROR: backend rollback failed; inspect PM2 immediately' >&2; return 1; }
  # PM2 start success alone does not prove that the previous HTTP server recovered.
  local recovered=0
  for attempt in $(seq 1 45); do
    if curl --fail --silent --max-time 5 http://127.0.0.1:3456/health >/dev/null \
      && (cd "$previous" && node --input-type=module -e 'import {isMatcherRunning,readMatcherHeartbeat} from "./server/match/matcher/lib/heartbeat.js"; const h=readMatcherHeartbeat(); process.exit(h?.mode === "embedded" && isMatcherRunning(h) ? 0 : 1)'); then recovered=1; break; fi
    sleep 3
  done
  test "$recovered" = 1 || { echo 'ERROR: previous backend health/matcher did not recover' >&2; return 1; }
  verify_processes "$previous"
  if [[ "$previous" != "$repo" ]]; then
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3456/api/runtime-version \
      | node "$DEPLOY_RUNTIME_VERIFIER" backend "$rollback_evidence" "$repo/.deploy-state/backend-rollback-verification.$id.json"
  fi
  echo "Backend rollback verified: $previous"
}
install_rollback_traps
activate "$release"
for attempt in $(seq 1 45); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3456/health >/dev/null \
    && node --input-type=module -e 'import {isMatcherRunning,readMatcherHeartbeat} from "./server/match/matcher/lib/heartbeat.js"; const h=readMatcherHeartbeat(); process.exit(h?.mode === "embedded" && isMatcherRunning(h) ? 0 : 1)'; then break; fi
  test "$attempt" != 45
  sleep 3
done
verify_processes "$release"
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3456/api/runtime-version | verify_runtime
cp "$DEPLOY_EVIDENCE_FILE" "$repo/.deploy-state/backend-evidence.$id.json"
switch_link "$release" "$repo/backend-current"
# Legacy watchdog fallback uses this stable path. Route it to the successful
# release instead of allowing it to restart stale source in the original root.
printf '%s\n' 'module.exports = require("../backend-current/deploy/ecosystem.config.cjs");' > "$repo/deploy/ecosystem.config.cjs.next"
mv -f "$repo/deploy/ecosystem.config.cjs.next" "$repo/deploy/ecosystem.config.cjs"
record_success
clear_rollback_traps
retain_success
echo "Published backend $sha; previous=$previous; frontend dist untouched"
