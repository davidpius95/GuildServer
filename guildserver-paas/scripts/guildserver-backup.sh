#!/usr/bin/env bash
# Nightly dump of the GuildServer control-plane database.
#
# Customer databases have their own scheduled backups; this protects the
# platform's own data — organizations, applications, tokens, audit history.
# Until this existed the only dumps were ones taken by hand before migrations.
#
# A dump that cannot be restored is not a backup, so this refuses to prune
# anything until the new dump exists and is non-trivially sized, and it records
# the outcome either way. scripts/restore-runbook.md covers restoring one.
set -uo pipefail

BACKUP_DIR="${GUILDSERVER_BACKUP_DIR:-/home/usher-node/guildserver-backups}"
RETENTION_DAYS="${GUILDSERVER_BACKUP_RETENTION_DAYS:-14}"
CONTAINER="${GUILDSERVER_POSTGRES_CONTAINER:-guildserver-postgres}"
MIN_BYTES="${GUILDSERVER_BACKUP_MIN_BYTES:-1048576}"   # 1 MiB: a plausible dump
LOCK="/tmp/guildserver-backup.lock"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

exec 9>"$LOCK"
flock -n 9 || { log "another backup is still running; skipping this tick."; exit 0; }

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/guildserver-${stamp}.sql.gz"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  log "FAILED: container $CONTAINER is not present."
  exit 1
fi

# pg_dump's exit status travels through the pipe, so a failed dump cannot be
# mistaken for a small but valid one.
set -o pipefail
if ! docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' 2>/tmp/guildserver-backup.err | gzip > "$target"; then
  log "FAILED: pg_dump errored: $(tail -1 /tmp/guildserver-backup.err)"
  rm -f "$target"
  exit 1
fi

size="$(stat -c %s "$target" 2>/dev/null || echo 0)"
if [ "$size" -lt "$MIN_BYTES" ]; then
  log "FAILED: dump is only ${size} bytes, below the ${MIN_BYTES}-byte floor; keeping it for inspection and pruning nothing."
  exit 1
fi

# Only now is it safe to discard older copies.
pruned="$(find "$BACKUP_DIR" -maxdepth 1 -name 'guildserver-*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
kept="$(find "$BACKUP_DIR" -maxdepth 1 -name 'guildserver-*.sql.gz' -type f | wc -l)"

log "OK: ${target##*/} (${size} bytes); pruned ${pruned} older than ${RETENTION_DAYS}d; ${kept} retained."
