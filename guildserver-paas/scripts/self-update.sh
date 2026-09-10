#!/usr/bin/env bash
# Poll origin/main and deploy the checkout that contains this script.
# Install via cron: */5 * * * * /path/to/guildserver-paas/scripts/self-update.sh >> /var/log/guildserver-update.log 2>&1

# The whole script is one brace group, so bash parses all of it before
# executing any of it. This file is replaced on disk while running, both by
# its own self-refresh and by an operator installing a new version; bash
# reads scripts incrementally, so an unwrapped script resumes at the old
# byte offset inside the new text. On 10 September that executed half a
# comment ("conclusively: command not found") mid-deploy and triggered a
# rollback. `exit` before the closing brace means nothing after it is read.
{
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# A repo-installed script derives its location. A durable system copy, such as
# /usr/local/bin/guildserver-self-update.sh, must be given GUILDSERVER_REPO_DIR.
if [ -n "${GUILDSERVER_REPO_DIR:-}" ]; then
  REPO_DIR="$(cd -- "$GUILDSERVER_REPO_DIR" && pwd)"
  COMPOSE_DIR="${GUILDSERVER_COMPOSE_DIR:-$REPO_DIR/guildserver-paas}"
else
  COMPOSE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
  REPO_DIR="$(cd -- "$COMPOSE_DIR/.." && pwd)"
fi
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
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "ERROR: $REPO_DIR is not a Git checkout; set GUILDSERVER_REPO_DIR for a system-installed updater."
  exit 1
fi

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

# --- CI gate -----------------------------------------------------------------
#
# This updater deploys whatever is on origin/main. The "Deploy to Production"
# workflow only prints a message, so until now a commit whose tests failed —
# or which was never tested at all — reached customers within five minutes,
# unattended. This checks the commit's status before deploying.
#
# GUILDSERVER_REQUIRE_CI:
#   warn    (default) log the verdict and deploy anyway — current behaviour,
#           kept while the suite still has known failures
#   enforce refuse to deploy unless checks conclusively succeeded
#   off     skip the check entirely
#
# Flip to `enforce` once the test suite is green; until then `warn` gives the
# signal without freezing the pipeline.
REQUIRE_CI="${GUILDSERVER_REQUIRE_CI:-warn}"

ci_conclusion() {
  # Prints: success | failure | pending | unknown
  local sha="$1" repo url json
  repo="$(git config --get remote.origin.url | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"
  [ -n "$repo" ] || { echo unknown; return; }
  url="https://api.github.com/repos/$repo/commits/$sha/check-runs"

  local auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

  json="$(curl -fsS --max-time 20 -H "Accept: application/vnd.github+json" "${auth[@]}" "$url" 2>/dev/null)" || { echo unknown; return; }

  printf '%s' "$json" | python3 -c '
import json, sys
try:
    runs = json.load(sys.stdin).get("check_runs", [])
except Exception:
    print("unknown"); raise SystemExit
if not runs:
    print("unknown"); raise SystemExit
if any(r.get("status") != "completed" for r in runs):
    print("pending"); raise SystemExit
bad = [r for r in runs if r.get("conclusion") not in ("success", "neutral", "skipped")]
print("failure" if bad else "success")
' 2>/dev/null || echo unknown
}

if [ "$REQUIRE_CI" != "off" ]; then
  VERDICT="$(ci_conclusion "$LATEST")"
  case "$VERDICT" in
    success)
      log "CI checks passed for ${LATEST:0:7}."
      ;;
    *)
      if [ "$REQUIRE_CI" = "enforce" ]; then
        log "REFUSING to deploy ${LATEST:0:7}: CI verdict is '$VERDICT'. Retaining ${CURRENT:0:7}."
        exit 1
      fi
      log "WARNING: CI verdict for ${LATEST:0:7} is '$VERDICT'; deploying anyway (GUILDSERVER_REQUIRE_CI=$REQUIRE_CI)."
      ;;
  esac
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

# --- keep the installed updater in step with the repo ------------------------
#
# The cron runs a COPY of this script (typically /usr/local/bin/
# guildserver-self-update.sh), not the file in the repo. So edits here reach
# the repository and never reach production: the copy on this host was byte
# identical to the repo at the commit it was installed from, and would have
# stayed frozen there indefinitely while the repo moved on.
#
# After a successful deploy, refresh that copy from the repo. Guards, because a
# deploy script that breaks itself takes the host's ability to deploy with it:
#   - only ever when the content actually differs
#   - only if the new version parses (`bash -n`)
#   - the previous version is kept alongside for a manual rollback
#   - any failure is logged and ignored; the deploy already succeeded
REPO_UPDATER="$COMPOSE_DIR/scripts/self-update.sh"
INSTALLED_UPDATER="$(readlink -f "${BASH_SOURCE[0]}")"

if [ -f "$REPO_UPDATER" ] && [ "$INSTALLED_UPDATER" != "$(readlink -f "$REPO_UPDATER")" ]; then
  if ! cmp -s "$REPO_UPDATER" "$INSTALLED_UPDATER"; then
    if bash -n "$REPO_UPDATER" 2>/dev/null; then
      # Stage beside the target, then rename. `cp` onto the installed path would
      # rewrite the file THIS process is executing, in place; bash reads a
      # script from disk as it runs, so it would carry on at the same byte
      # offset inside the new content. A rename gives the new script a new
      # inode and leaves the running one untouched.
      STAGED="$(sudo -n mktemp "${INSTALLED_UPDATER}.new.XXXXXX" 2>/dev/null)"
      if [ -n "$STAGED" ] \
         && sudo -n cp "$INSTALLED_UPDATER" "${INSTALLED_UPDATER}.prev" 2>/dev/null \
         && sudo -n cp "$REPO_UPDATER" "$STAGED" 2>/dev/null \
         && sudo -n chmod 0755 "$STAGED" 2>/dev/null \
         && sudo -n mv -f "$STAGED" "$INSTALLED_UPDATER" 2>/dev/null; then
        log "Refreshed the installed updater from the repo (previous kept at ${INSTALLED_UPDATER}.prev)."
      else
        [ -n "$STAGED" ] && sudo -n rm -f "$STAGED" 2>/dev/null
        log "WARNING: the installed updater is out of date and could not be refreshed automatically."
        log "         Install it atomically, and never while an update is running:"
        log "         sudo cp $REPO_UPDATER ${INSTALLED_UPDATER}.new && sudo mv -f ${INSTALLED_UPDATER}.new $INSTALLED_UPDATER"
      fi
    else
      log "WARNING: $REPO_UPDATER does not parse; keeping the installed updater."
    fi
  fi
fi

exit 0
}
