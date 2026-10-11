#!/usr/bin/env bash
# Cloud Agent start phase (per boot). Brings up the local PostgreSQL cluster and
# launches the backend (:3456) + Vite console (:5174) as detached, logged
# processes, then returns. Idempotent: skips servers already listening.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${CHANGMEN_LOG_DIR:-/tmp/changmen-dev}"
mkdir -p "$LOG_DIR"

# 1) PostgreSQL cluster online.
PG_VER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')"
PG_VER="${PG_VER:-16}"
if pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
  echo "[start] PostgreSQL $PG_VER/main already online"
else
  echo "[start] starting PostgreSQL $PG_VER/main ..."
  sudo pg_ctlcluster "$PG_VER" main start || true
fi
for _ in $(seq 1 20); do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && { echo "[start] PostgreSQL ready"; break; }
  sleep 1
done

port_up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

launch() {
  local name="$1" port="$2" script="$3"
  if port_up "$port"; then
    echo "[start] $name already listening on :$port"
    return 0
  fi
  echo "[start] launching $name (:$port) → $LOG_DIR/$name.log"
  setsid bash -lc "exec bash '$ROOT/.cursor/$script'" >"$LOG_DIR/$name.log" 2>&1 &
  disown || true
}

# 2) Backend + Vite (detached; logs under $LOG_DIR).
launch backend 3456 run-backend.sh
launch vite 5174 run-vite.sh

# 3) Best-effort readiness wait so the stack is usable when start returns.
#    Cold boot compiles the router and pre-bundles Vite deps, so allow ~2min.
for _ in $(seq 1 120); do
  if port_up 3456 && port_up 5174; then
    echo "[start] backend + Vite are listening (:3456, :5174)"
    break
  fi
  sleep 1
done

echo "[start] done. Console: http://localhost:5174/  (login admin / admin123456)"
