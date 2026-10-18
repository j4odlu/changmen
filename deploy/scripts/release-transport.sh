#!/usr/bin/env bash
# Own only a unique transport directory; release/state/storage paths are never removed.
set -euo pipefail
mode="${1:?run|cleanup required}"
directory="${2:?transport directory required}"
[[ "$mode" == run || "$mode" == cleanup ]]
[[ "$directory" =~ ^/tmp/changmen-(frontend|backend)-[a-f0-9]{40}-[0-9]+-[1-9][0-9]*\.[a-zA-Z0-9]{8}$ ]]
[[ ! -L "$directory" ]]
if [[ ! -e "$directory" && "$mode" == cleanup ]]; then exit 0; fi
[[ -d "$directory" && "$(realpath -- "$directory")" == "$directory" ]]
[[ ! -L "$directory/.transport.lock" ]]
# Children inherit the descriptor: even if this wrapper dies, cleanup cannot
# delete inputs still held by the release or its rollback subprocesses.
exec 8>"$directory/.transport.lock"
if ! flock -n 8; then
  echo "Remote transport still active; retained $directory" >&2
  [[ "$mode" == cleanup ]] && exit 0
  exit 75
fi
remove_transport() {
  [[ ! -L "$directory" && "$(realpath -- "$directory")" == "$directory" ]] || return 1
  rm -rf -- "$directory"
}
if [[ "$mode" == cleanup ]]; then
  remove_transport
  exit 0
fi
scope="${3:?scope required}"
[[ "$scope" == frontend || "$scope" == backend ]]
[[ "$directory" == /tmp/changmen-"$scope"-* ]]
child=""
finish() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM
  # Also cover a signal arriving between spawning the child and saving $!.
  for active in $(jobs -pr); do wait "$active" || true; done
  echo "Remote $scope activation/rollback finished (exit=$status); cleaning transport $directory" >&2
  remove_transport || echo "WARNING: remote transport cleanup failed: $directory" >&2
  exit "$status"
}
terminate() {
  local signal="$1" status="$2"
  trap '' HUP INT TERM
  if [[ -z "$child" ]]; then child="$(jobs -pr)"; fi
  if [[ -n "$child" ]]; then
    kill -s "$signal" "$child" 2>/dev/null || true
    wait "$child" || true
  fi
  exit "$status"
}
trap finish EXIT
trap 'terminate HUP 129' HUP
trap 'terminate INT 130' INT
trap 'terminate TERM 143' TERM
# Async jobs otherwise inherit ignored INT/QUIT from non-interactive Bash.
# Preserve the release script's existing signal/rollback handling.
env --default-signal=INT,QUIT bash "$directory/release-$scope.sh" "$directory/app.tgz" </dev/null &
child=$!
wait "$child"
