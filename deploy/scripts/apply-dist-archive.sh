#!/usr/bin/env bash
# Apply local-built frontend dist tarball onto flat VPS tree.
# Usage: bash apply-dist-archive.sh /tmp/changmen-dist.tgz
set -euo pipefail

archive="${1:-/tmp/changmen-dist.tgz}"
deploy_repo="${DEPLOY_REPO:-/root/changmen}"
app_web="${deploy_repo}/client/web"
mkdir -p "$deploy_repo/.deploy-state"
exec 8>"$deploy_repo/.deploy-state/frontend.lock"
flock -w 900 8
if [ -L "$app_web/dist" ]; then
  echo "ERROR: managed frontend active; use sh/deploy-frontend.sh or Deploy frontend in Actions" >&2
  exit 1
fi
tmp="${app_web}/dist.upload"

test -f "$archive"
tar -tzf "$archive" >/dev/null
rm -rf "$tmp"
mkdir -p "$tmp"
tar -xzf "$archive" -C "$tmp"
test -f "$tmp/index.html"
test -d "$tmp/assets"
rm -rf "${app_web}/dist.prev"
if [ -d "${app_web}/dist" ]; then
  mv "${app_web}/dist" "${app_web}/dist.prev"
fi
mv "$tmp" "${app_web}/dist"
rm -rf "${app_web}/dist.prev" "$archive"
chmod -R a+rX "${app_web}/dist"
echo "OK dist $(grep -oE 'assets/index-[^\"]+\.js' "${app_web}/dist/index.html" | head -1)"
