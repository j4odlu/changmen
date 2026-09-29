#!/usr/bin/env bash
set -euo pipefail
SH_DIR="$(cd "$(dirname "$0")" && pwd)"
export DEPLOY_HOST="${DEPLOY_HOST:-47.57.10.202}"
echo "NOTE: Hong Kong normally deploys via GitHub Actions push master."
echo "      This script is emergency fallback only."
echo
exec "${SH_DIR}/deploy-server-core.sh" "$@"
