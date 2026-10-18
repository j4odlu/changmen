#!/usr/bin/env bash
# Real local files/locks; mock SSH executes only fixture commands, never network/VPS.
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
source_root="$(pwd)"
fixture="$(mktemp -d)"
[[ "$(realpath -- "$fixture")" == /tmp/* ]]
directories=()
finish() {
  for active in $(jobs -pr); do kill -TERM "$active" 2>/dev/null || true; wait "$active" || true; done
  for directory in "${directories[@]}"; do
    if [[ -d "$directory" && ! -L "$directory" ]]; then
      [[ "$(realpath -- "$directory")" == /tmp/changmen-* ]] || exit 1
      rm -rf -- "$directory"
    fi
  done
  rm -rf -- "$fixture"
}
trap finish EXIT
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
helper="$source_root/deploy/scripts/release-transport.sh"
new_directory() {
  directory="$(mktemp -d "/tmp/changmen-frontend-$sha-99-1.XXXXXXXX")"
  directories+=("$directory")
}
expect_status() {
  local expected="$1" actual=0; shift
  "$@" || actual=$?
  [[ "$actual" == "$expected" ]] || { echo "Expected status=$expected; got $actual: $*" >&2; exit 1; }
}
# 1: Successful activation cleans only transport; persistent neighbor survives.
new_directory
echo keep > "$fixture/persistent"
printf 'exit 0\n' > "$directory/release-frontend.sh"
bash "$helper" run "$directory" frontend
test ! -e "$directory"; test -f "$fixture/persistent"
# 2: A failed activation preserves its exit code and removes the transport.
new_directory
printf 'echo fixture-failure >&2; exit 37\n' > "$directory/release-frontend.sh"
expect_status 37 bash "$helper" run "$directory" frontend
test ! -e "$directory"
# 3: Partial uploads can be cleaned; a repeated cleanup is harmless.
new_directory
echo partial > "$directory/app.tgz"
bash "$helper" cleanup "$directory"
bash "$helper" cleanup "$directory"
test ! -e "$directory"
# 4: Do not remove live inputs; the remote owner cleans after rollback completes.
new_directory
cat > "$directory/release-frontend.sh" <<'SH'
set -e
touch "$TEST_READY"
while [[ ! -f "$TEST_FINISH" ]]; do sleep 0.05; done
test -f "$DEPLOY_RUNTIME_VERIFIER"
echo rolled-back > "$TEST_ROLLBACK"
exit 23
SH
export TEST_READY="$fixture/ready" TEST_FINISH="$fixture/finish" TEST_ROLLBACK="$fixture/rollback"
export DEPLOY_RUNTIME_VERIFIER="$directory/verify-runtime.mjs"
echo keep-until-rollback > "$DEPLOY_RUNTIME_VERIFIER"
bash "$helper" run "$directory" frontend > "$fixture/live.log" 2>&1 & owner=$!
for i in $(seq 1 100); do test ! -f "$TEST_READY" || break; sleep 0.05; done
test -f "$TEST_READY"
bash "$helper" cleanup "$directory" 2> "$fixture/cleanup-active.log"
grep -q 'still active' "$fixture/cleanup-active.log"
test -f "$DEPLOY_RUNTIME_VERIFIER"
touch "$TEST_FINISH"
expect_status 23 wait "$owner"
test -f "$TEST_ROLLBACK"; test ! -e "$directory"
# 5: Catchable signals are forwarded; cleanup waits for the child's rollback.
for signal in TERM HUP INT; do
new_directory
rm -f "$TEST_READY" "$TEST_FINISH" "$TEST_ROLLBACK"
cat > "$directory/release-frontend.sh" <<'SH'
recover() { sleep 0.1; test -f "$DEPLOY_RUNTIME_VERIFIER"; touch "$TEST_ROLLBACK"; exit "$1"; }
trap 'recover 143' TERM
trap 'recover 129' HUP
trap 'recover 130' INT
touch "$TEST_READY"
while :; do sleep 0.05; done
SH
export DEPLOY_RUNTIME_VERIFIER="$directory/verify-runtime.mjs"
touch "$DEPLOY_RUNTIME_VERIFIER"
env --default-signal=INT,QUIT bash "$helper" run "$directory" frontend > "$fixture/signal.log" 2>&1 & owner=$!
for i in $(seq 1 100); do test ! -f "$TEST_READY" || break; sleep 0.05; done
test -f "$TEST_READY"; kill -s "$signal" "$owner"
case "$signal" in TERM) expected=143 ;; HUP) expected=129 ;; INT) expected=130 ;; esac
expect_status "$expected" wait "$owner"
test -f "$TEST_ROLLBACK"; test ! -e "$directory"
done
# 6: Invalid paths and symlinks cannot cause unrelated data removal.
expect_status 1 bash "$helper" cleanup "$fixture"
new_directory
rmdir "$directory"; ln -s "$fixture" "$directory"
expect_status 1 bash "$helper" cleanup "$directory"
test -f "$fixture/persistent"; rm "$directory"
new_directory
ln -s "$fixture/persistent" "$directory/.transport.lock"
expect_status 1 bash "$helper" cleanup "$directory"
test "$(cat "$fixture/persistent")" = keep; rm "$directory/.transport.lock"; rmdir "$directory"

# Real publish.sh, with fake SSH and a small frontend archive.
publish_root="$fixture/publish"
mkdir -p "$publish_root/scripts/deploy" "$publish_root/deploy/scripts" "$publish_root/output/release-validation" "$fixture/bin" "$fixture/dist/assets" "$fixture/home"
cp "$source_root/scripts/deploy/publish.sh" "$publish_root/scripts/deploy/"
cp "$helper" "$publish_root/deploy/scripts/"
echo '// retention fixture' > "$publish_root/scripts/deploy/release-retention.mjs"
echo 'true' > "$publish_root/deploy/scripts/release-common.sh"
printf 'echo fixture-activation >&2; exit "${TEST_ACTIVATION_STATUS:-0}"\n' > "$publish_root/deploy/scripts/release-frontend.sh"
echo '<script src="assets/index-fixture.js"></script>' > "$fixture/dist/index.html"
echo 'https://api.changmen.fun' > "$fixture/dist/assets/index-fixture.js"
tar -czf "$publish_root/output/release-validation/frontend.tgz" -C "$fixture/dist" .
echo '{}' > "$publish_root/output/release-validation/evidence.json"
echo '// verifier fixture' > "$publish_root/output/release-validation/verify-runtime.mjs"
cat > "$fixture/bin/node" <<'SH'
#!/usr/bin/env bash
exit "${TEST_VERIFY_STATUS:-0}"
SH
cat > "$fixture/bin/ssh-keyscan" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$fixture/bin/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
command="${!#}"
echo "$command" >> "$TEST_SSH_LOG"
if [[ "$command" == "mktemp -d "* ]]; then
  bash -c "$command" | tee "$TEST_REMOTE_PATH"
elif [[ "$command" == "cat > "*"/app.tgz'" && "${TEST_UPLOAD_FAIL:-0}" == 1 ]]; then
  cat >/dev/null; exit 29
elif [[ "$command" == "bash -s -- cleanup "* && "${TEST_CLEANUP_FAIL:-0}" == 1 ]]; then
  cat >/dev/null; exit 255
else
  bash -c "$command"
fi
SH
chmod +x "$fixture/bin/"*
export TEST_SSH_LOG="$fixture/ssh.log" TEST_REMOTE_PATH="$fixture/remote-path"
publish() {
  (cd "$publish_root"; HOME="$fixture/home" PATH="$fixture/bin:$PATH" GITHUB_SHA="$sha" \
    GITHUB_RUN_ID=99 GITHUB_RUN_ATTEMPT=1 DEPLOY_HOST=fixture.invalid DEPLOY_REPO=/fixture/changmen \
    DEPLOY_SSH_KEY='' SSH_IDENTITY='' bash scripts/deploy/publish.sh frontend)
}
check_remote_removed() {
  directory="$(cat "$TEST_REMOTE_PATH")"; directories+=("$directory")
  test ! -e "$directory"
}
# 7: Real transport removes successful uploads after activation.
publish > "$fixture/publish-success.log" 2>&1
check_remote_removed
# 8: Three failed uploads are cleaned, and activation is never entered.
: > "$TEST_SSH_LOG"
export TEST_UPLOAD_FAIL=1
expect_status 1 publish > "$fixture/upload-fail.log" 2>&1
check_remote_removed
test "$(grep -c "cat > .*app.tgz'" "$TEST_SSH_LOG")" = 3
if grep -q 'bash -s -- run' "$TEST_SSH_LOG"; then exit 1; fi
unset TEST_UPLOAD_FAIL
# 9: Real transport preserves activation failure and its visible diagnostic.
export TEST_ACTIVATION_STATUS=37
expect_status 37 publish > "$fixture/activation-fail.log" 2>&1
check_remote_removed
grep -q 'fixture-activation' "$fixture/activation-fail.log"
grep -q 'exit=37' "$fixture/activation-fail.log"
# 10: A cleanup SSH error never masks an activation failure.
export TEST_CLEANUP_FAIL=1
expect_status 37 publish > "$fixture/cleanup-fail.log" 2>&1
check_remote_removed # Remote owner cleaned before the fallback lost its connection.
grep -q 'WARNING: remote transport cleanup unavailable' "$fixture/cleanup-fail.log"
export TEST_UPLOAD_FAIL=1
expect_status 1 publish > "$fixture/upload-cleanup-unavailable.log" 2>&1
directory="$(cat "$TEST_REMOTE_PATH")"; directories+=("$directory")
test -d "$directory"
grep -q 'publication exit=1' "$fixture/upload-cleanup-unavailable.log"
bash "$helper" cleanup "$directory"
test ! -e "$directory"
unset TEST_UPLOAD_FAIL
# 11: Cleanup SSH errors do not mark an already successful release as failed.
export TEST_ACTIVATION_STATUS=0
publish > "$fixture/cleanup-success.log" 2>&1
check_remote_removed
grep -q 'publication exit=0' "$fixture/cleanup-success.log"
unset TEST_CLEANUP_FAIL TEST_ACTIVATION_STATUS
# 12: Evidence failure must not contact SSH or create a remote directory.
: > "$TEST_SSH_LOG"
export TEST_VERIFY_STATUS=41
expect_status 41 publish > "$fixture/evidence-fail.log" 2>&1
test ! -s "$TEST_SSH_LOG"
echo 'PASS transport cleanup: 12 scenarios'
