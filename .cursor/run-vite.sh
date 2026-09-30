#!/usr/bin/env bash
# changmen web console (Vite dev server) on port 5174, proxying /esport → backend.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/.cursor/node-env.sh"

export VITE_DEV_PORT="${VITE_DEV_PORT:-5174}"

exec npm run app:dev
