#!/usr/bin/env bash
# changmen backend (esport-api + HTTP proxy + embedded matcher) on port 3456.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/.cursor/node-env.sh"

export PORT="${PORT:-3456}"
export A8_AUTH="${A8_AUTH:-0}"
export SKIP_APP_BUILD="${SKIP_APP_BUILD:-1}"

exec npm run web
