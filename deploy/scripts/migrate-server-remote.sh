#!/usr/bin/env bash
# One-shot VPS migration / first-time production setup.
# Piped from BAT/migrate-server.bat or run on the NEW server after git pull.
set -euo pipefail

ROOT="${DEPLOY_REPO:?DEPLOY_REPO is required}"
GIT_REPO="${GIT_REPO:-}"
MIGRATE_OLD_HOST="${MIGRATE_OLD_HOST:-}"
MIGRATE_OLD_USER="${MIGRATE_OLD_USER:-root}"
MIGRATE_INSTALL_DEPS="${MIGRATE_INSTALL_DEPS:-1}"
MIGRATE_SETUP_CADDY="${MIGRATE_SETUP_CADDY:-1}"
DEPLOY_SKIP_APP_BUILD="${DEPLOY_SKIP_APP_BUILD:-0}"
DEPLOY_FULL="${DEPLOY_FULL:-1}"
PM2_WEB="${PM2_WEB:-changmen-esport}"
PM2_PM_SPORTS="${PM2_PM_SPORTS:-changmen-pm-sports}"

t0=$SECONDS
log() { echo "==> $*"; }
warn() { echo "WARN: $*" >&2; }
fail() { echo "ERROR: $*" >&2; exit 1; }
elapsed() { echo "==> done in $((SECONDS - t0))s total"; }

resolve_paths() {
  if [ -f "$ROOT/changmen/package.json" ]; then
    GIT_ROOT="$ROOT"
    CHANGMEN="$ROOT/changmen"
  elif [ -f "$ROOT/package.json" ] && [ -d "$ROOT/server/backend" ]; then
    GIT_ROOT="$ROOT"
    CHANGMEN="$ROOT"
  else
    fail "changmen not found under DEPLOY_REPO=$ROOT (set GIT_REPO to clone first)"
  fi
  BACKEND="$CHANGMEN/server/backend"
  ENV_FILE="$BACKEND/.env"
  STORAGE_DIR="$BACKEND/storage"
  DIST_DIR="$CHANGMEN/client/web/dist"
  log "git root: $GIT_ROOT"
  log "changmen: $CHANGMEN"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_deps() {
  if [ "$MIGRATE_INSTALL_DEPS" != "1" ]; then
    return 0
  fi
  if need_cmd apt-get; then
    sudo apt-get update -qq
    if ! need_cmd node || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" 2>/dev/null; then
      log "install node 24 (nodesource)"
      curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
    if ! need_cmd git; then
      sudo apt-get install -y git
    fi
    if ! need_cmd curl; then
      sudo apt-get install -y curl
    fi
    if ! need_cmd pm2; then
      log "install pm2"
      sudo npm install -g pm2
    fi
    if [ "$MIGRATE_SETUP_CADDY" = "1" ] && ! need_cmd caddy; then
      log "install caddy"
      sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl ca-certificates
      curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y caddy
    fi
    return 0
  fi
  warn "unsupported OS for auto-install; ensure node>=24, npm, git, pm2, caddy exist"
}

ensure_repo() {
  if [ -d "$ROOT/.git" ]; then
    cd "$ROOT"
    log "git pull"
    git pull --ff-only || {
      branch="$(git rev-parse --abbrev-ref HEAD)"
      git fetch origin
      git reset --hard "origin/${branch}"
    }
    return 0
  fi
  if [ -z "$GIT_REPO" ]; then
    fail "no git repo at $ROOT and GIT_REPO is empty"
  fi
  log "git clone $GIT_REPO -> $ROOT"
  mkdir -p "$(dirname "$ROOT")"
  git clone "$GIT_REPO" "$ROOT"
  cd "$ROOT"
}

copy_from_old_server() {
  if [ -z "$MIGRATE_OLD_HOST" ]; then
    log "MIGRATE_OLD_HOST empty — skip copy from old VPS"
    return 0
  fi
  local old="${MIGRATE_OLD_USER}@${MIGRATE_OLD_HOST}"
  local remote_backend="${DEPLOY_REPO}/server/backend"
  if [ ! -d "$remote_backend" ] && [ -d "${DEPLOY_REPO}/changmen/server/backend" ]; then
    remote_backend="${DEPLOY_REPO}/changmen/server/backend"
  fi
  log "copy .env + storage from $old (requires SSH key on THIS server -> old)"
  mkdir -p "$STORAGE_DIR"
  if scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "${old}:${remote_backend}/.env" "$ENV_FILE" 2>/dev/null; then
    log "copied .env"
  else
    warn "could not scp .env from old server (BAT may have copied it already)"
  fi
  if scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -r \
    "${old}:${remote_backend}/storage/" "$STORAGE_DIR/" 2>/dev/null; then
    log "copied storage/"
    rm -f "$STORAGE_DIR/player_orders.json" 2>/dev/null || true
  else
    warn "could not scp storage/ from old server (optional if RDS-only)"
  fi
}

require_env() {
  if [ ! -f "$ENV_FILE" ]; then
    fail "missing $ENV_FILE — copy from old VPS or run BAT\\setup-dev-env.bat locally and scp"
  fi
  if ! grep -qE '^JWT_SECRET=.+' "$ENV_FILE" 2>/dev/null; then
    fail "JWT_SECRET missing in $ENV_FILE"
  fi
  if ! grep -qE '^DATABASE_URL' "$ENV_FILE" 2>/dev/null \
    && ! grep -qE '^DATABASE_URL_PUBLIC=' "$ENV_FILE" 2>/dev/null \
    && ! grep -qE '^DATABASE_URL_INTERNAL=' "$ENV_FILE" 2>/dev/null; then
    fail "DATABASE_URL missing in $ENV_FILE (add RDS whitelist for this VPS IP)"
  fi
  log ".env OK"
}

setup_caddy() {
  if [ "$MIGRATE_SETUP_CADDY" != "1" ]; then
    log "skip caddy (MIGRATE_SETUP_CADDY=0)"
    return 0
  fi
  if ! need_cmd caddy; then
    warn "caddy not installed — skip reverse proxy setup"
    return 0
  fi
  local src="$GIT_ROOT/deploy/Caddyfile"
  [ -f "$src" ] || src="$CHANGMEN/scripts/Caddyfile"
  [ -f "$src" ] || { warn "Caddyfile not found"; return 0; }
  local patched="/tmp/changmen-Caddyfile.$$"
  sed -e "s|root \\* /root/changmen/client/web/dist|root * $DIST_DIR|g" \
      -e "s|root \\* /root/changmen/changmen/client/web/dist|root * $DIST_DIR|g" "$src" > "$patched"
  export CADDY_SRC="$patched"
  bash "$GIT_ROOT/deploy/scripts/setup-caddy-remote.sh"
  rm -f "$patched"
}

main() {
  install_deps
  ensure_repo
  resolve_paths
  copy_from_old_server
  require_env

  cd "$CHANGMEN"
  log "npm install"
  npm install

  log "RDS schema"
  node server/db/maintenance/apply-rds-schema.mjs

  log "compile:router"
  npm run compile:router --workspace=@changmen/backend

  if [ "$DEPLOY_SKIP_APP_BUILD" = "1" ]; then
    log "skip app:build (dist uploaded from dev PC)"
    if [ ! -f "$DIST_DIR/index.html" ]; then
      warn "dist/index.html missing — run local build upload or set DEPLOY_SKIP_APP_BUILD=0"
    fi
  else
    log "app:build"
    npm run app:build
  fi

  if need_cmd pm2; then
    if pm2 describe "$PM2_WEB" >/dev/null 2>&1; then
      log "pm2 restart"
      pm2 restart "$PM2_WEB" "$PM2_PM_SPORTS" --update-env || pm2 restart "$GIT_ROOT/deploy/ecosystem.config.cjs" --update-env
    else
      log "pm2 start"
      pm2 start "$GIT_ROOT/deploy/ecosystem.config.cjs"
    fi
    pm2 save >/dev/null 2>&1 || true
    pm2 status || true
  else
    fail "pm2 not found"
  fi

  log "post-deploy check"
  (cd server/backend && node scripts/ops/diagnostics/post-deploy-check.mjs --skip-telegram)

  log "wait embedded matcher heartbeat"
  for i in $(seq 1 45); do
    if node --input-type=module -e "import { isMatcherRunning, readMatcherHeartbeat } from './server/match/matcher/lib/heartbeat.js'; const hb = readMatcherHeartbeat(); if (hb?.mode === 'embedded' && isMatcherRunning(hb)) process.exit(0); process.exit(1);"; then
      log "embedded matcher heartbeat ok"
      break
    fi
    if [ "$i" = "45" ]; then
      fail "embedded matcher heartbeat not ready — check: pm2 logs $PM2_WEB"
    fi
    sleep 3
  done

  setup_caddy

  code_api="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3456/api/games || echo 000)"
  code_web="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || echo 000)"
  log "health api:3456/api/games -> $code_api"
  log "health :80/ -> $code_web"
  public_ip="$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  log "migrate complete — open http://${public_ip}/"
  elapsed
}

main "$@"
