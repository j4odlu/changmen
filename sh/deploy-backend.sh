#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
resolve_root
require_npm
load_deploy_local
export DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_REPO SSH_IDENTITY
cd "$ROOT"
npm run check:change -- --publish=backend
node scripts/deploy/release-evidence.mjs seal
exec bash scripts/deploy/publish.sh backend
