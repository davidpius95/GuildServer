#!/bin/bash
# Auto-update script for GuildServer production deployment
# Polls origin/main and auto-updates if new commits exist
# Install via cron: */5 * * * * /opt/guildserver/guildserver-paas/scripts/self-update.sh >> /var/log/guildserver-update.log 2>&1

set -e

REPO_DIR="/opt/guildserver"
COMPOSE_DIR="$REPO_DIR/guildserver-paas"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

cd "$REPO_DIR"

# Fetch latest changes
git fetch origin main 2>/dev/null

CURRENT=$(git rev-parse HEAD)
LATEST=$(git rev-parse origin/main)

if [ "$CURRENT" = "$LATEST" ]; then
    exit 0
fi

echo "$LOG_PREFIX Updating from ${CURRENT:0:7} to ${LATEST:0:7}..."

# Pull latest code
git reset --hard origin/main

# Rebuild and restart app containers
cd "$COMPOSE_DIR"
docker compose -f docker-compose.prod.yml build api web
docker compose -f docker-compose.prod.yml up -d api web

# Run database migrations
sleep 10
docker exec guildserver-api node -e "require('child_process').execSync('npx tsx packages/database/src/migrate.ts', {stdio: 'inherit', env: {...process.env}})" 2>/dev/null || true

# Cleanup old images
docker image prune -f

echo "$LOG_PREFIX Update complete. Now running ${LATEST:0:7}"
