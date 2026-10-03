#!/usr/bin/env bash
# Apply app tarball onto DEPLOY_REPO (flat app root; preserves .env + storage), then deploy.
# Used by tarball deploy (PC packs changmen/ only; VPS cannot git pull).
set -euo pipefail

ARCHIVE="${1:?usage: apply-repo-archive.sh /path/to/changmen-repo.tgz}"
ROOT="${DEPLOY_REPO:?DEPLOY_REPO is required}"

if [ "${FLATTEN_ONLY:-0}" != "1" ] && [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: missing archive $ARCHIVE"
  exit 1
fi

if [ "$ROOT" = /root/changmen ] && [ ! -d "$ROOT" ] && [ -d /root/gamebet ]; then
  echo "==> migrate DEPLOY_REPO /root/gamebet -> /root/changmen"
  mv /root/gamebet /root/changmen
fi

# Legacy GitHub secret DEPLOY_REPO=/root/gamebet while app already lives at /root/changmen.
if [ "$ROOT" = /root/gamebet ] && [ -d /root/changmen/server/backend ]; then
  echo "==> normalize DEPLOY_REPO /root/gamebet -> /root/changmen"
  ROOT=/root/changmen
  export DEPLOY_REPO="$ROOT"
fi

# Legacy in-place deployments must never overwrite a managed release installation.
mkdir -p "$ROOT/.deploy-state"
exec 8>"$ROOT/.deploy-state/backend.lock"
flock -w 900 8
if [ -L "$ROOT/backend-current" ] || [ -L "$ROOT/client/web/dist" ]; then
  echo "ERROR: managed releases active; use sh/deploy-backend.sh or Deploy backend in Actions" >&2
  exit 1
fi

PERSIST_SECRETS="$ROOT/.deploy-secrets"

merge_secrets_to_persist() {
  mkdir -p "$PERSIST_SECRETS"
  local base persist
  for base in \
    "$ROOT/server/backend" \
    "$ROOT/changmen/server/backend" \
    "$ROOT/changmen/changmen/server/backend" \
    /root/changmen/server/backend \
    /root/gamebet/server/backend \
    /root/gamebet/changmen/server/backend; do
    if [ -f "$base/.env" ]; then
      cp -a "$base/.env" "$PERSIST_SECRETS/backend.env"
    fi
    if [ -d "$base/storage" ]; then
      rm -rf "$PERSIST_SECRETS/storage"
      cp -a "$base/storage" "$PERSIST_SECRETS/storage"
    fi
  done
  for persist in \
    /root/changmen/.deploy-secrets/backend.env \
    /root/gamebet/.deploy-secrets/backend.env; do
    if [ -f "$persist" ] && [ "$persist" != "$PERSIST_SECRETS/backend.env" ]; then
      cp -a "$persist" "$PERSIST_SECRETS/backend.env"
    fi
  done
  for persist in \
    /root/changmen/.deploy-secrets/storage \
    /root/gamebet/.deploy-secrets/storage; do
    if [ -d "$persist" ] && [ "$persist" != "$PERSIST_SECRETS/storage" ]; then
      rm -rf "$PERSIST_SECRETS/storage"
      cp -a "$persist" "$PERSIST_SECRETS/storage"
    fi
  done
}

preserve_backend_secrets() {
  merge_secrets_to_persist
  local backup="/tmp/changmen-preserve.$$"
  rm -rf "$backup"
  mkdir -p "$backup"
  if [ -f "$PERSIST_SECRETS/backend.env" ]; then
    cp -a "$PERSIST_SECRETS/backend.env" "$backup/.env"
  fi
  if [ -d "$PERSIST_SECRETS/storage" ]; then
    cp -a "$PERSIST_SECRETS/storage" "$backup/storage"
  fi
  PRESERVE_BACKUP="$backup"
}

restore_backend_secrets() {
  merge_secrets_to_persist
  local backup="${PRESERVE_BACKUP:-}"
  mkdir -p "$ROOT/server/backend" "$PERSIST_SECRETS"
  if [ -n "$backup" ] && [ -f "$backup/.env" ]; then
    cp -a "$backup/.env" "$ROOT/server/backend/.env"
    cp -a "$backup/.env" "$PERSIST_SECRETS/backend.env"
  elif [ -f "$PERSIST_SECRETS/backend.env" ]; then
    cp -a "$PERSIST_SECRETS/backend.env" "$ROOT/server/backend/.env"
  fi
  # 现网 storage 是采集/合场热数据：禁止 rm -rf。collector 同时写入时
  # `rm: Directory not empty` 会让整次 GHA 部署失败（4fb22007 即此）。
  # 只在 flatten 把 server/ 整棵删掉之后才从备份补回。
  local live="$ROOT/server/backend/storage"
  if [ ! -d "$live" ]; then
    if [ -n "$backup" ] && [ -d "$backup/storage" ]; then
      cp -a "$backup/storage" "$live"
    elif [ -d "$PERSIST_SECRETS/storage" ]; then
      cp -a "$PERSIST_SECRETS/storage" "$live"
    fi
  fi
  if [ -n "$backup" ]; then
    rm -rf "$backup"
    PRESERVE_BACKUP=""
  fi
}

flatten_legacy_nested_repo() {
  local nested="$ROOT/changmen"
  local deep="$ROOT/changmen/changmen"

  preserve_backend_secrets

  if [ -d "$deep/server/backend" ]; then
    nested="$deep"
    echo "==> flatten legacy $deep -> flat app at $ROOT"
  elif [ -d "$nested/server/backend" ] && [ -f "$nested/package.json" ]; then
    echo "==> flatten legacy $nested -> flat app at $ROOT"
  elif [ -d "$nested" ] && [ ! -f "$nested/package.json" ]; then
    echo "==> remove stale nested dir $nested"
    rm -rf "$nested"
    restore_backend_secrets
    return 0
  else
    restore_backend_secrets
    return 0
  fi

  if [ -d "$ROOT/server/backend" ] && [ -f "$ROOT/package.json" ] && [ ! -f "$nested/package.json" ]; then
    restore_backend_secrets
    return 0
  fi

  local staging="/var/tmp/changmen-flatten.$$"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -a "$nested/." "$staging/"
  find "$ROOT" -mindepth 1 -maxdepth 1 ! -name '.env' ! -name '.deploy-secrets' -exec rm -rf {} +
  shopt -s dotglob nullglob
  mv "$staging"/* "$ROOT/"
  shopt -u dotglob nullglob
  rmdir "$staging" 2>/dev/null || true
  restore_backend_secrets
}

cleanup_flat_deploy_root() {
  if [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/server/backend" ]; then
    return 0
  fi
  if [ -d "$ROOT/changmen" ] && [ ! -f "$ROOT/changmen/package.json" ]; then
    echo "==> remove leftover $ROOT/changmen"
    preserve_backend_secrets
    rm -rf "$ROOT/changmen"
    restore_backend_secrets
  fi
  rm -rf "$ROOT/.git" "$ROOT/A8" "$ROOT/BAT" "$ROOT/pingtai_offical" 2>/dev/null || true
  # .deploy-secrets 保留，勿删
}

if [ "${FLATTEN_ONLY:-0}" != "1" ]; then
  tar -tzf "$ARCHIVE" >/dev/null
fi

merge_secrets_to_persist
flatten_legacy_nested_repo
preserve_backend_secrets

if [ "${FLATTEN_ONLY:-0}" = "1" ]; then
  cleanup_flat_deploy_root
  restore_backend_secrets
  echo "==> flatten-only done at $ROOT"
  exit 0
fi

echo "==> extract app archive -> $ROOT (keep .env + storage)"
mkdir -p "$ROOT"

OLD_HEAD=""
if [ -d "$ROOT/.git" ]; then
  OLD_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
fi

# Verify against the actual live files before overwriting them. Workflow history
# also contains frontend-only/noop runs, so it cannot prove the backend baseline.
SOURCE_STAGE="$(mktemp -d /tmp/changmen-source-compare.XXXXXX)"
trap 'rm -rf "$SOURCE_STAGE"' EXIT
tar --warning=no-unknown-keyword -xzf "$ARCHIVE" -C "$SOURCE_STAGE"
node "$SOURCE_STAGE/scripts/deploy/compare-deployed-files.mjs" "$SOURCE_STAGE" "$ROOT" "$SOURCE_STAGE/changed-paths.txt"
export DEPLOY_CHANGED_PATHS_FILE="$SOURCE_STAGE/changed-paths.txt"

# git archive 成员无前导 ./ ；两种写法都排除，避免误解压覆盖热目录
tar --warning=no-unknown-keyword -xzf "$ARCHIVE" -C "$ROOT" \
  --exclude='server/backend/.env' \
  --exclude='./server/backend/.env' \
  --exclude='server/backend/storage' \
  --exclude='./server/backend/storage'

restore_backend_secrets

if [ ! -f "$ROOT/server/backend/.env" ]; then
  echo "ERROR: missing server/backend/.env on VPS (seed once into $PERSIST_SECRETS/backend.env)"
  exit 1
fi

cleanup_flat_deploy_root

NEW_HEAD=""
if [ -d "$ROOT/.git" ]; then
  NEW_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
fi

export DEPLOY_SKIP_GIT_PULL=1
export DEPLOY_OLD_HEAD="${OLD_HEAD:-$NEW_HEAD}"
export DEPLOY_NEW_HEAD="${NEW_HEAD:-$OLD_HEAD}"
export DEPLOY_SKIP_APP_BUILD="${DEPLOY_SKIP_APP_BUILD:-1}"
export DEPLOY_FULL="${DEPLOY_FULL:-0}"

SCRIPT_DIR="${CHANGMEN_DEPLOY_SCRIPTS:-}"
if [ -z "$SCRIPT_DIR" ] || [ ! -f "$SCRIPT_DIR/deploy-server-remote.sh" ]; then
  if [ -f "$ROOT/deploy/ecosystem.config.cjs" ]; then
    SCRIPT_DIR="${CHANGMEN_DEPLOY_SCRIPTS:-/tmp/changmen-deploy}"
  else
    SCRIPT_DIR="$ROOT/deploy/scripts"
  fi
fi
DEPLOY_REMOTE="$SCRIPT_DIR/deploy-server-remote.sh"
if [ ! -f "$DEPLOY_REMOTE" ]; then
  echo "ERROR: missing deploy-server-remote.sh (CHANGMEN_DEPLOY_SCRIPTS=$CHANGMEN_DEPLOY_SCRIPTS)"
  exit 1
fi

echo "==> deploy ${DEPLOY_OLD_HEAD:0:8}..${DEPLOY_NEW_HEAD:0:8} (archive sync)"
bash "$DEPLOY_REMOTE"
rm -f "$ARCHIVE"
