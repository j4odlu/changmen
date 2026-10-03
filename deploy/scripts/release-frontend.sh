#!/usr/bin/env bash
set -Eeuo pipefail
scope=frontend
source "$(dirname "$0")/release-common.sh"
archive="${1:?archive required}"
validate_archive "$archive"
release="$repo/.releases/frontend/$id"
test ! -e "$release"
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
test -f "$release/index.html"
test -d "$release/assets"
ls "$release"/assets/index*.js >/dev/null
grep -Rql 'https://api.changmen.fun' "$release/assets"
app="$repo/client/web"
mkdir -p "$app"
previous=""
rollback() {
  trap - ERR
  if [[ -n "$previous" && -d "$previous" ]]; then
    switch_link "$previous" "$app/dist"
  elif [[ -L "$app/dist" ]]; then
    rm "$app/dist"
  fi
}
trap rollback ERR
if [[ -L "$app/dist" ]]; then
  previous="$(readlink -f "$app/dist")"
elif [[ -d "$app/dist" ]]; then
  # One-time conversion of the legacy real directory (subsequent swaps are atomic).
  previous="$repo/.releases/frontend/legacy-$id"
  mv "$app/dist" "$previous"
  ln -s "$previous" "$app/dist"
fi
# Retain old hashed chunks for already-open pages, without overwriting new files.
if [[ -n "$previous" && -d "$previous/assets" ]]; then
  cp -an "$previous/assets/." "$release/assets/"
fi
printf '%s\n' "$sha" > "$release/deploy-version.txt"
chmod -R a+rX "$release"
if [[ "$repo" == /root/* ]]; then chmod 711 /root; fi
chmod a+x "$repo" "$repo/.releases" "$repo/.releases/frontend" "$repo/client" "$app"
switch_link "$release" "$app/dist"
base="${DEPLOY_FRONTEND_CHECK_URL:-https://changmen.fun}"
check_args=(--fail --silent --show-error --max-time 10)
if [[ "$base" == https://changmen.fun ]]; then check_args+=(--resolve changmen.fun:443:127.0.0.1); fi
test "$(curl "${check_args[@]}" "$base/deploy-version.txt")" = "$sha"
asset="$(grep -oE 'assets/index-[^" ]+\.js' "$release/index.html" | head -1)"
test -n "$asset"
curl "${check_args[@]}" -o /dev/null "$base/$asset"
record_success
trap - ERR
echo "Published frontend $sha; previous=${previous:-none}; PM2 untouched"
