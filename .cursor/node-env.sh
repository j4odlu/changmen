#!/usr/bin/env bash
# Shared prelude for Cloud Agent env scripts: make nvm's Node 22 win over the
# base image's /exec-daemon/node (v22.14.0), which is too old for the runtime
# TypeScript type-stripping the backend relies on (needs Node >= 22.18).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install/select Node 22 (no-op if already present) and put it first on PATH.
nvm install 22 >/dev/null 2>&1 || true
_NODE_BIN="$(nvm which 22 2>/dev/null | xargs -r dirname 2>/dev/null || true)"
if [ -n "$_NODE_BIN" ]; then
  export PATH="$_NODE_BIN:$PATH"
fi
