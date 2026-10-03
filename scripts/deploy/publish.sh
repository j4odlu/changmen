#!/usr/bin/env bash
# Shared GHA/local transport. Remote scripts own locks, validation and rollback.
set -euo pipefail
scope="${1:?usage: publish.sh frontend|backend}"
[[ "$scope" == frontend || "$scope" == backend ]]
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
sequence="${GITHUB_RUN_NUMBER:-0}"
attempt="${GITHUB_RUN_ATTEMPT:-1}"
id="${scope}-${sha}-${GITHUB_RUN_ID:-local-$(date +%s)}-${attempt}"
host="${DEPLOY_HOST:?DEPLOY_HOST required}"
user="${DEPLOY_USER:-root}"
port="${DEPLOY_PORT:-22}"
repo="${DEPLOY_REPO:-/root/changmen}"
# Paths are embedded in a remote shell command: allow only plain absolute paths.
[[ "$repo" =~ ^/[a-zA-Z0-9_./-]+$ && "$repo" != / && "$repo" != *..* ]]
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$sequence" =~ ^[0-9]+$ ]]
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ssh_args=(-p "$port" -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=8)
if [[ -n "${SSH_IDENTITY:-}" ]]; then ssh_args+=(-i "$SSH_IDENTITY"); fi
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  printf '%s\n' "$DEPLOY_SSH_KEY" > "$work/key"
  chmod 600 "$work/key"
  ssh_args+=(-i "$work/key")
fi
mkdir -p ~/.ssh
ssh-keyscan -p "$port" -H "$host" >> ~/.ssh/known_hosts
remote="$user@$host"
if [[ "$scope" == frontend ]]; then
  test -f client/web/dist/index.html
  test -d client/web/dist/assets
  grep -Rql 'https://api.changmen.fun' client/web/dist/assets
  tar -C client/web/dist -czf "$work/app.tgz" .
else
  # The backend archive is HEAD, so its activation script must support releases.
  git show HEAD:deploy/scripts/deploy-server-remote.sh | grep 'DEPLOY_RELEASE_MODE' >/dev/null
  node --input-type=module -e 'import {packGitRepoArchive} from "./scripts/deploy/pack-git-repo.mjs"; packGitRepoArchive(process.cwd(), process.argv[1])' "$work/app.tgz"
fi
digest="$(sha256sum "$work/app.tgz" | cut -d ' ' -f1)"
remote_work="/tmp/changmen-${id}"
ssh "${ssh_args[@]}" "$remote" "mkdir -m 700 '$remote_work'"
# Each retry uploads afresh; SSH failures must not abort before the retry.
uploaded=0
for attempt in 1 2 3; do
  if ssh "${ssh_args[@]}" "$remote" "cat > '$remote_work/app.tgz'" < "$work/app.tgz" \
    && ssh "${ssh_args[@]}" "$remote" "echo '$digest  $remote_work/app.tgz' | sha256sum -c -"; then
    uploaded=1
    break
  fi
  sleep 2
done
test "$uploaded" = 1
for script in release-common.sh "release-${scope}.sh"; do
  ssh "${ssh_args[@]}" "$remote" "cat > '$remote_work/$script'" < "deploy/scripts/$script"
done
ssh "${ssh_args[@]}" "$remote" \
  "DEPLOY_REPO='$repo' DEPLOY_SHA='$sha' DEPLOY_SEQUENCE='$sequence' DEPLOY_RELEASE_ID='$id' bash '$remote_work/release-${scope}.sh' '$remote_work/app.tgz'"
ssh "${ssh_args[@]}" "$remote" "rm -rf '$remote_work'"
