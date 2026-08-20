#!/usr/bin/env bash
# Poll origin/main and deploy the checkout that contains this script.
# Install via cron: */5 * * * * /path/to/guildserver-paas/scripts/self-update.sh >> /var/log/guildserver-update.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd -- "$COMPOSE_DIR/.." && pwd)"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
LOCK_FILE="/tmp/guildserver-self-update.lock"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another update is already running; skipping this tick."
  exit 0
fi

cd "$REPO_DIR"

# Bound network failures so a stalled GitHub connection cannot hold the cron lock.
if ! git -c http.connectTimeout=15 -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 fetch --quiet origin main; then
  log "ERROR: could not fetch origin/main; retaining the current deployment."
  exit 1
fi

CURRENT=$(git rev-parse HEAD)
LATEST=$(git rev-parse origin/main)
if [ "$CURRENT" = "$LATEST" ]; then
  exit 0
fi

if [ ! -f "$COMPOSE_DIR/$ENV_FILE" ]; then
  log "ERROR: $COMPOSE_DIR/$ENV_FILE is missing; refusing to deploy."
  exit 1
fi

log "Updating from ${CURRENT:0:7} to ${LATEST:0:7}."

rollback() {
  log "ERROR: deployment failed; restoring ${CURRENT:0:7}."
  cd "$REPO_DIR" && git reset --hard --quiet "$CURRENT"
  cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web docs || true
  exit 1
}
trap rollback ERR

git reset --hard --quiet origin/main
cd "$COMPOSE_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --no-cache api web docs
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web docs
trap - ERR

# Production schema is hand-managed because it contains manual DDL. Do not
# replay Drizzle migrations here; apply and verify them as a separate change.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true

log "Update complete. Now running ${LATEST:0:7}."
