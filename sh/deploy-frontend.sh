#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
resolve_root
require_npm
load_deploy_local
export DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_REPO SSH_IDENTITY
cd "$ROOT"
npm run app:build
exec bash scripts/deploy/publish.sh frontend
