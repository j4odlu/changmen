#!/usr/bin/env bash
# Offline integration checks: real tar/files/locks, fake network and processes.
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
source_root="$(pwd)"
real_node="$(command -v node)"
export TEST_REAL_NODE="$real_node"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/dist/assets" "$fixture/app/server/backend" "$fixture/app/client/web" "$fixture/app/deploy"
echo 'module.exports = {};' > "$fixture/app/deploy/ecosystem.config.cjs"
cat > "$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
test ! -f "$TEST_FAIL_HEALTH" || exit 22
for arg in "$@"; do
  if [[ "$arg" == */deploy-version.txt ]]; then cat "$DEPLOY_REPO/client/web/dist/deploy-version.txt"; fi
  if [[ "$arg" == */runtime-version.json ]]; then
    if [[ -f "$TEST_WRONG_RUNTIME" ]]; then echo '{"frontend":{"role":"frontend","commit":"wrong"}}'
    else cat "$DEPLOY_REPO/client/web/dist/runtime-version.json"; fi
  fi
  if [[ "$arg" == */api/runtime-version ]]; then
    bad=0; test ! -f "$TEST_WRONG_RUNTIME" || bad=1
    "$TEST_REAL_NODE" -e 'const bad=process.argv[1]==="1"; console.log(JSON.stringify({backend:{role:"backend",commit:(bad?"b":"a").repeat(40),sourceFingerprint:"f".repeat(64),contractFingerprint:"c".repeat(64),startedAt:"2026-10-14T00:00:00Z"},restartRequired:false,database:{status:"observed"}}))' "$bad"
  fi
done
SH
cat > "$fixture/bin/node" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == */compare-deployed-files.mjs ]]; then exec "$TEST_REAL_NODE" "$@"; fi
if [[ "${1:-}" == */verify-runtime.mjs ]]; then exec "$TEST_REAL_NODE" "$@"; fi
if [[ "${1:-}" == */release-retention.mjs ]]; then exec "$TEST_REAL_NODE" "$@"; fi
if [[ "${1:-}" == server/backend/scripts/check-rds-schema.mjs && -f "${TEST_FAIL_SCHEMA:-/nonexistent}" ]]; then exit 44; fi
cat >/dev/null
SH
cat > "$fixture/bin/npm" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$PWD:$*" >> "$TEST_NPM_LOG"
SH
cat > "$fixture/bin/pm2" <<'SH'
#!/usr/bin/env bash
echo '[]'
SH
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
export TEST_FAIL_HEALTH="$fixture/fail-health" TEST_NPM_LOG="$fixture/npm.log" TEST_FAIL_SCHEMA="$fixture/fail-schema"
export TEST_WRONG_RUNTIME="$fixture/wrong-runtime"
export DEPLOY_RUNTIME_VERIFIER="$source_root/scripts/deploy/verify-runtime.mjs" DEPLOY_EVIDENCE_FILE="$fixture/evidence.json"
export DEPLOY_RELEASE_RETENTION="$source_root/scripts/deploy/release-retention.mjs"
evidence_for() {
  "$real_node" -e 'const fs=require("node:fs"),crypto=require("node:crypto"),scope=process.argv[1],archive=process.argv[2],file=process.argv[3]; const runtime={commit:"a".repeat(40),sourceFingerprint:"f".repeat(64),contractFingerprint:"c".repeat(64),dirty:false}; fs.writeFileSync(file,JSON.stringify({format:1,commit:runtime.commit,report:{passed:true,sourceStable:true,immutableFokEntries:551,completeRelease:true,plan:{purpose:"release",deployment:{components:["frontend","backend"]}}},archives:{[scope]:crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex")},expectedRuntime:{frontend:runtime,backend:runtime}}));' "$1" "$2" "$DEPLOY_EVIDENCE_FILE"
}
export DEPLOY_REPO="$fixture/app" DEPLOY_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa DEPLOY_SEQUENCE=2 DEPLOY_RELEASE_ID=fe-first
printf '<script src="/assets/index-new.js"></script>' > "$fixture/dist/index.html"
printf 'https://api.changmen.fun' > "$fixture/dist/assets/index-new.js"
printf '{"frontend":{"role":"frontend","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceFingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","contractFingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","startedAt":"2026-10-14T00:00:00Z","dirty":false}}' > "$fixture/dist/runtime-version.json"
tar -C "$fixture/dist" -czf "$fixture/dist.tgz" .
evidence_for frontend "$fixture/dist.tgz"
mkdir -p "$DEPLOY_REPO/client/web/dist/assets"
echo legacy > "$DEPLOY_REPO/client/web/dist/index.html"
echo old-chunk > "$DEPLOY_REPO/client/web/dist/assets/index-old.js"
printf '<script src="/assets/index-old.js"></script>' > "$DEPLOY_REPO/client/web/dist/index.html"
bash deploy/scripts/release-frontend.sh "$fixture/dist.tgz"
test -L "$DEPLOY_REPO/client/web/dist"
test -f "$DEPLOY_REPO/client/web/dist/assets/index-old.js"
first="$(readlink -f "$DEPLOY_REPO/client/web/dist")"
export DEPLOY_SEQUENCE=1 DEPLOY_RELEASE_ID=fe-stale
if bash deploy/scripts/release-frontend.sh "$fixture/dist.tgz"; then echo 'stale release accepted'; exit 1; fi
export DEPLOY_SEQUENCE=3 DEPLOY_RELEASE_ID=fe-fail
touch "$TEST_FAIL_HEALTH"
if bash deploy/scripts/release-frontend.sh "$fixture/dist.tgz"; then echo 'failed health accepted'; exit 1; fi
test "$(readlink -f "$DEPLOY_REPO/client/web/dist")" = "$first"
grep -q '^2 ' "$DEPLOY_REPO/.deploy-state/frontend"
rm "$TEST_FAIL_HEALTH"
export DEPLOY_RELEASE_ID=fe-retry
bash deploy/scripts/release-frontend.sh "$fixture/dist.tgz"
grep -q '^3 ' "$DEPLOY_REPO/.deploy-state/frontend"
front_current="$(readlink -f "$DEPLOY_REPO/client/web/dist")"
export DEPLOY_SEQUENCE=4 DEPLOY_RELEASE_ID=fe-wrong-runtime
touch "$TEST_WRONG_RUNTIME"
if bash deploy/scripts/release-frontend.sh "$fixture/dist.tgz"; then echo 'wrong frontend runtime accepted'; exit 1; fi
test "$(readlink -f "$DEPLOY_REPO/client/web/dist")" = "$front_current"
grep -q '^3 ' "$DEPLOY_REPO/.deploy-state/frontend"
rm "$TEST_WRONG_RUNTIME"

# Backend fixture keeps the full workspace tree and compiles before activation.
mkdir -p "$fixture/backend/server/backend/db/migrations" "$fixture/backend/server/backend/scripts/ops/migrations" "$fixture/backend/client/web" "$fixture/backend/deploy/scripts"
mkdir -p "$fixture/backend/scripts/deploy"
cp "$source_root/scripts/deploy/compare-deployed-files.mjs" "$fixture/backend/scripts/deploy/"
echo '{}' > "$fixture/backend/package-lock.json"
echo '{}' > "$fixture/backend/package.json"
echo select > "$fixture/backend/server/backend/db/migrations/001.sql"
echo schema > "$fixture/backend/server/backend/scripts/apply-rds-schema.mjs"
echo observation > "$fixture/backend/server/backend/scripts/apply-order-observation-schema.mjs"
echo 'module.exports = { marker: __dirname };' > "$fixture/backend/deploy/ecosystem.config.cjs"
cat > "$fixture/backend/deploy/scripts/deploy-server-remote.sh" <<'SH'
#!/usr/bin/env bash
printf '%s %s\n' "$DEPLOY_REPO" "$DEPLOY_SCHEMA_CHANGED" >> "$TEST_ACTIVATE_LOG"
test "$DEPLOY_FULL" = 0
if [[ "$DEPLOY_REPO" != "$TEST_BASE_REPO" && -f "$TEST_FAIL_ACTIVATE" ]]; then exit 1; fi
SH
tar -C "$fixture/backend" -czf "$fixture/backend.tgz" .
evidence_for backend "$fixture/backend.tgz"
echo secret-fixture > "$DEPLOY_REPO/server/backend/.env"
mkdir -p "$DEPLOY_REPO/server/backend/storage"
mkdir -p "$DEPLOY_REPO/server/backend/public/extensions"
printf 'published-plugin-fixture' > "$DEPLOY_REPO/server/backend/public/extensions/1.3.73.zip"
echo hot-data > "$DEPLOY_REPO/server/backend/storage/live.json"
export TEST_BASE_REPO="$DEPLOY_REPO" TEST_ACTIVATE_LOG="$fixture/activate.log" TEST_FAIL_ACTIVATE="$fixture/fail-activate"
export DEPLOY_SEQUENCE=5 DEPLOY_RELEASE_ID=be-first
export DEPLOY_FULL=1
frontend_before="$(readlink -f "$DEPLOY_REPO/client/web/dist")"
bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"
backend_first="$(readlink -f "$DEPLOY_REPO/backend-current")"
test -f "$backend_first/server/backend/storage/live.json"
"$real_node" -e 'const fs=require("node:fs"),assert=require("node:assert/strict"); assert.deepEqual(fs.readFileSync(process.argv[1]),fs.readFileSync(process.argv[2]));' "$DEPLOY_REPO/server/backend/public/extensions/1.3.73.zip" "$backend_first/server/backend/public/extensions/1.3.73.zip"
grep -q 'backend-current/deploy/ecosystem.config.cjs' "$DEPLOY_REPO/deploy/ecosystem.config.cjs"
"$real_node" -e 'const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"); assert.equal(require(process.argv[1]).marker,path.dirname(fs.realpathSync(process.argv[2])));' "$DEPLOY_REPO/deploy/ecosystem.config.cjs" "$DEPLOY_REPO/backend-current/deploy/ecosystem.config.cjs"
test "$(readlink -f "$DEPLOY_REPO/client/web/dist")" = "$frontend_before"
grep -q ':ci' "$TEST_NPM_LOG"
grep -q ':run compile:router' "$TEST_NPM_LOG"
export DEPLOY_SEQUENCE=6 DEPLOY_RELEASE_ID=be-schema-fail
before_activation="$(cat "$TEST_ACTIVATE_LOG")"
touch "$TEST_FAIL_SCHEMA"
if bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"; then echo 'failed preflight accepted'; exit 1; fi
test "$(cat "$TEST_ACTIVATE_LOG")" = "$before_activation"
test "$(readlink -f "$DEPLOY_REPO/backend-current")" = "$backend_first"
grep -q '^5 ' "$DEPLOY_REPO/.deploy-state/backend"
rm "$TEST_FAIL_SCHEMA"
export DEPLOY_SEQUENCE=6 DEPLOY_RELEASE_ID=be-wrong-runtime
touch "$TEST_WRONG_RUNTIME"
if bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"; then echo 'wrong backend runtime accepted'; exit 1; fi
test "$(readlink -f "$DEPLOY_REPO/backend-current")" = "$backend_first"
grep -q '^5 ' "$DEPLOY_REPO/.deploy-state/backend"
rm "$TEST_WRONG_RUNTIME"
export DEPLOY_SEQUENCE=6 DEPLOY_RELEASE_ID=be-fail
touch "$TEST_FAIL_ACTIVATE"
# Only fail the candidate, allowing the previous release to recover.
export TEST_BASE_REPO="$backend_first"
if bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"; then echo 'failed backend accepted'; exit 1; fi
test "$(readlink -f "$DEPLOY_REPO/backend-current")" = "$backend_first"
grep -q '^5 ' "$DEPLOY_REPO/.deploy-state/backend"
grep -q "$backend_first 0" "$TEST_ACTIVATE_LOG"
test "$(cat "$DEPLOY_REPO/server/backend/storage/live.json")" = hot-data
rm "$TEST_FAIL_ACTIVATE"
export DEPLOY_RELEASE_ID=be-retry
bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"
grep -q '^6 ' "$DEPLOY_REPO/.deploy-state/backend"
grep -q '/be-retry 0' "$TEST_ACTIVATE_LOG"
export DEPLOY_SEQUENCE=4 DEPLOY_RELEASE_ID=be-stale
if bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"; then echo 'stale backend accepted'; exit 1; fi
test "$(readlink -f "$DEPLOY_REPO/client/web/dist")" = "$frontend_before"
# Exercise the actual legacy activation script's isolated-release branch.
# With schema unchanged it must neither install/build nor rewrite frontend markers.
before_npm="$(cat "$TEST_NPM_LOG")"
echo keep-marker > "$backend_first/client/web/.deploy-needs-dist-upload"
DEPLOY_REPO="$backend_first" DEPLOY_RELEASE_MODE=1 DEPLOY_SCHEMA_CHANGED=0 \
  DEPLOY_FULL=0 DEPLOY_OLD_HEAD=old DEPLOY_NEW_HEAD=new DEPLOY_SKIP_GIT_PULL=1 DEPLOY_SKIP_POSTCHECK=1 \
  bash "$source_root/deploy/scripts/deploy-server-remote.sh" > "$fixture/activation-output"
test "$(cat "$TEST_NPM_LOG")" = "$before_npm"
test "$(cat "$backend_first/client/web/.deploy-needs-dist-upload")" = keep-marker
if DEPLOY_REPO="$TEST_BASE_REPO" bash deploy/scripts/apply-repo-archive.sh "$fixture/backend.tgz"; then
  echo 'legacy backend bypass accepted'; exit 1
fi
if bash deploy/scripts/apply-dist-archive.sh "$fixture/dist.tgz"; then
  echo 'legacy frontend bypass accepted'; exit 1
fi
# Holding the frontend lock blocks another frontend, while backend can proceed.
export DEPLOY_SEQUENCE=0 DEPLOY_RELEASE_ID=lock-check
bash -c 'exec 9>"$DEPLOY_REPO/.deploy-state/frontend.lock"; flock 9; touch "$1/held"; sleep 2' _ "$fixture" &
holder=$!
while [[ ! -f "$fixture/held" ]]; do sleep 0.05; done
bash -c 'scope=frontend; source "$1/deploy/scripts/release-common.sh"; touch "$2/frontend-acquired"' _ "$source_root" "$fixture" &
waiter=$!
bash -c 'scope=backend; source "$1/deploy/scripts/release-common.sh"; touch "$2/backend-acquired"' _ "$source_root" "$fixture"
test -f "$fixture/backend-acquired"
test ! -f "$fixture/frontend-acquired"
wait "$holder"
wait "$waiter"
test -f "$fixture/frontend-acquired"
# A failed atomic rename may leave the temporary link behind. Recovery must
# replace that leftover link rather than fail with "File exists".
bash -c 'scope=frontend; source "$1/deploy/scripts/release-common.sh"; ln -s "$2/backend" "$2/recovery.next.$id"; switch_link "$2/dist" "$2/recovery"; test "$(readlink "$2/recovery")" = "$2/dist"' _ "$source_root" "$fixture"
# First backend adoption failure must return to the bootstrap root, without
# leaving a self-referential backend-current link or an ecosystem proxy.
export DEPLOY_REPO="$fixture/bootstrap" TEST_BASE_REPO="$fixture/bootstrap" DEPLOY_SEQUENCE=1 DEPLOY_RELEASE_ID=bootstrap-fail
mkdir -p "$DEPLOY_REPO/server/backend" "$DEPLOY_REPO/client/web/dist" "$DEPLOY_REPO/deploy"
echo fixture-env > "$DEPLOY_REPO/server/backend/.env"
echo 'module.exports = { bootstrap: true };' > "$DEPLOY_REPO/deploy/ecosystem.config.cjs"
touch "$TEST_FAIL_ACTIVATE"
if bash deploy/scripts/release-backend.sh "$fixture/backend.tgz"; then echo 'bootstrap failure accepted'; exit 1; fi
test ! -L "$DEPLOY_REPO/backend-current"
test ! -f "$DEPLOY_REPO/.deploy-state/backend"
grep -q 'bootstrap: true' "$DEPLOY_REPO/deploy/ecosystem.config.cjs"
grep -q "$DEPLOY_REPO 0" "$TEST_ACTIVATE_LOG"
# Fresh Actions publication checkouts have the sealed artifact and no local dist.
publish_root="$fixture/publish"
mkdir -p "$publish_root/scripts/deploy" "$publish_root/deploy/scripts" "$publish_root/output/release-validation" "$fixture/publish-bin"
cp "$source_root/scripts/deploy/publish.sh" "$publish_root/scripts/deploy/"
cp "$source_root/scripts/deploy/release-retention.mjs" "$publish_root/scripts/deploy/"
cp "$source_root/deploy/scripts/"release-{common,frontend}.sh "$publish_root/deploy/scripts/"
cp "$fixture/dist.tgz" "$publish_root/output/release-validation/frontend.tgz"
printf '{}' > "$publish_root/output/release-validation/evidence.json"
printf '// verifier fixture' > "$publish_root/output/release-validation/verify-runtime.mjs"
cat > "$fixture/publish-bin/node" <<'SH'
#!/usr/bin/env bash
# The real evidence/hash validator is covered by release-evidence.test.mjs.
test "$2" = verify
test -f "$5"
printf 'verified\n' >> "$TEST_PUBLISH_LOG"
SH
cat > "$fixture/publish-bin/ssh-keyscan" <<'SH'
#!/usr/bin/env bash
printf 'keyscan\n' >> "$TEST_PUBLISH_LOG"
SH
cat > "$fixture/publish-bin/ssh" <<'SH'
#!/usr/bin/env bash
printf 'ssh\n' >> "$TEST_PUBLISH_LOG"
case "${!#}" in
  "cat > "*"/app.tgz'") cat > "$TEST_PUBLISH_UPLOAD" ;;
  "cat > "*) cat >/dev/null ;;
esac
SH
chmod +x "$fixture/publish-bin/"*
export TEST_PUBLISH_LOG="$fixture/publish.log" TEST_PUBLISH_UPLOAD="$fixture/published.tgz"
publish_fixture() {
  (cd "$publish_root"; PATH="$fixture/publish-bin:$PATH" GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    GITHUB_RUN_ID=99 DEPLOY_HOST=fixture.invalid DEPLOY_REPO=/test/changmen DEPLOY_SSH_KEY='' \
    bash scripts/deploy/publish.sh frontend)
}
test ! -e "$publish_root/client/web/dist"
publish_fixture
test "$(sha256sum "$TEST_PUBLISH_UPLOAD" | cut -d ' ' -f1)" = "$(sha256sum "$publish_root/output/release-validation/frontend.tgz" | cut -d ' ' -f1)"
test "$(head -1 "$TEST_PUBLISH_LOG")" = verified
grep -q '^ssh$' "$TEST_PUBLISH_LOG"
# An unrelated local build must neither be required nor mask a broken archive.
mkdir -p "$publish_root/client/web/dist/assets" "$fixture/bad-dist/assets"
cp "$fixture/dist/index.html" "$publish_root/client/web/dist/"
cp "$fixture/dist/assets/index-new.js" "$publish_root/client/web/dist/assets/"
cp "$fixture/dist/index.html" "$fixture/bad-dist/"
printf 'https://wrong.invalid' > "$fixture/bad-dist/assets/index-bad.js"
tar -C "$fixture/bad-dist" -czf "$publish_root/output/release-validation/frontend.tgz" .
: > "$TEST_PUBLISH_LOG"
if publish_fixture; then echo 'wrong API archive accepted'; exit 1; fi
test "$(cat "$TEST_PUBLISH_LOG")" = verified
tar -C "$fixture/bad-dist/assets" -czf "$publish_root/output/release-validation/frontend.tgz" .
: > "$TEST_PUBLISH_LOG"
if publish_fixture; then echo 'missing entry archive accepted'; exit 1; fi
test "$(cat "$TEST_PUBLISH_LOG")" = verified
echo 'PASS release integration: adoption, stale refusal, retries, rollback, storage isolation and artifact-only publication'
