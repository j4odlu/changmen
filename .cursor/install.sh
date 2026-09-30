#!/usr/bin/env bash
# Cloud Agent install phase (idempotent). Prepares the changmen dev stack:
# Node 22, workspace deps, a local PostgreSQL standing in for Aliyun RDS, the
# schema, a dev login user, and server/backend/.env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/.cursor/node-env.sh"

echo "[install] node: $(node -v)  npm: $(npm -v)"

PG_DB=gamebet
PG_USER=gamebet_app
PG_PW=gamebet_local_pw

# 1) Local PostgreSQL (system dependency; no-op once installed / snapshotted).
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[install] installing PostgreSQL ..."
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

PG_VER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')"
PG_VER="${PG_VER:-16}"
if ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
  echo "[install] starting PostgreSQL cluster $PG_VER/main ..."
  sudo pg_ctlcluster "$PG_VER" main start || true
fi

# 2) Role + database (idempotent).
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PW}';
  END IF;
END \$\$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"
fi

# 3) server/backend/.env (gitignored) with the local DATABASE_URL + JWT secret.
ENV_FILE="$ROOT/server/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[install] writing $ENV_FILE"
  cat > "$ENV_FILE" <<ENV
# Local Cloud Agent dev env (gitignored). Local PostgreSQL replaces Aliyun RDS.
AUTH_MODE=jwt
JWT_SECRET=changmen-local-dev-secret-please-change-32
JWT_ACCESS_TTL=7d
JWT_REFRESH_TTL=30d
CHANGMEN_DB_SCRIPT=rds
DATABASE_URL=postgresql://${PG_USER}:${PG_PW}@127.0.0.1:5432/${PG_DB}
DATABASE_RDS_TARGET=public
DATABASE_SSL=0
ENV
fi

# 4) Workspace dependencies.
echo "[install] npm install ..."
npm install --no-audit --no-fund

# 5) Schema — apply every migration in order, tolerating the one cosmetic
#    fresh-DB failure (024's COMMENT on a baseline-renamed column).
echo "[install] applying migrations ..."
export PGPASSWORD="$PG_PW"
for f in $(ls "$ROOT"/server/backend/db/migrations/*.sql | sort -V); do
  if psql -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    echo "[install]   OK   $(basename "$f")"
  else
    echo "[install]   SKIP $(basename "$f") (tolerated)"
  fi
done
unset PGPASSWORD

# 6) Dev admin login user (idempotent: create-user is a no-op if it exists).
echo "[install] ensuring admin user ..."
( cd "$ROOT/server/backend" && node scripts/create-user.js --admin admin admin123456 ) || \
  echo "[install] admin user already present (ignored)"

echo "[install] done."
