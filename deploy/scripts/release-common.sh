#!/usr/bin/env bash
set -euo pipefail
repo="${DEPLOY_REPO:?DEPLOY_REPO required}"
sha="${DEPLOY_SHA:?DEPLOY_SHA required}"
sequence="${DEPLOY_SEQUENCE:-0}"
id="${DEPLOY_RELEASE_ID:?DEPLOY_RELEASE_ID required}"
[[ "$repo" =~ ^/[a-zA-Z0-9_./-]+$ && "$repo" != / && "$repo" != *..* ]]
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$sequence" =~ ^[0-9]+$ && "$id" =~ ^[a-zA-Z0-9-]+$ ]]
if [[ "$repo" == /root/gamebet && -d /root/changmen/server/backend ]]; then
  echo 'Normalize legacy DEPLOY_REPO /root/gamebet -> /root/changmen'
  repo=/root/changmen
fi
mkdir -p "$repo/.deploy-state" "$repo/.releases/$scope"
exec 9>"$repo/.deploy-state/$scope.lock"
flock -w 900 9
state="$repo/.deploy-state/$scope"
if [[ -f "$state" ]]; then
  read -r last_sequence last_sha < "$state"
  if (( sequence > 0 && sequence < last_sequence )); then
    echo "Refusing stale $scope run $sequence (published $last_sequence)" >&2
    exit 1
  fi
  if (( sequence > 0 && sequence == last_sequence )) && [[ "$sha" != "$last_sha" ]]; then
    echo 'Sequence reused for a different commit' >&2
    exit 1
  fi
fi
record_success() {
  # Local emergency publishes must not reset the GHA high-water mark.
  printf '%s %s\n' "$(( sequence > 0 ? sequence : ${last_sequence:-0} ))" "$sha" > "$state.tmp"
  mv -f "$state.tmp" "$state"
}
validate_archive() {
  tar -tzf "$1" > "$repo/.deploy-state/$scope.members"
  if grep -Eq '(^/|(^|/)\.\.(/|$))' "$repo/.deploy-state/$scope.members"; then
    echo 'Unsafe archive paths' >&2
    exit 1
  fi
}
switch_link() {
  local target="$1" link="$2"
  # A failed rename can leave our temporary link behind; rollback must reuse it.
  if [[ -L "$link.next.$id" ]]; then rm "$link.next.$id"; fi
  ln -s "$target" "$link.next.$id"
  mv -Tf "$link.next.$id" "$link"
}
