#!/usr/bin/env bash
# Push this branch to origin/main and verify what production does with it.
#
# Run this from a shell that HAS GitHub push credentials. Everything else in the
# deploy path is automated: the host polls origin/main every five minutes and
# rebuilds, so the risky moment is the push itself and the ten minutes after it.
#
#   ./scripts/land-to-production.sh            # push, wait, verify
#   ./scripts/land-to-production.sh --dry-run  # show what would be pushed
set -euo pipefail

REPO_DIR="${GUILDSERVER_REPO_DIR:-/home/usher-node/GuildServer}"
BRANCH_HERE="$(git rev-parse --abbrev-ref HEAD)"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say() { echo "[land] $*"; }

# --- preflight ---------------------------------------------------------------
say "branch:        $BRANCH_HERE"
say "remote:        $(git config --get remote.origin.url)"
say "production:    $REPO_DIR (tracks $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD))"

git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  say "ERROR: origin/main is not an ancestor of HEAD. Rebase or merge first;"
  say "       this script will not force anything."
  exit 1
fi

COUNT="$(git rev-list --count origin/main..HEAD)"
say "$COUNT commit(s) to land, clean fast-forward from $(git rev-parse --short origin/main)"

if [ -n "$(git status --porcelain)" ]; then
  say "ERROR: working tree is dirty. Commit or clean it first."
  exit 1
fi

# Schema first: the deployed code is replaced automatically, the database is
# not, so any migration the new code needs must already be applied.
say "checking for unapplied migrations against production..."
if ! (cd "$HERE/packages/database" && DATABASE_URL="${PROD_DATABASE_URL:-}" pnpm -s db:verify >/dev/null 2>&1); then
  say "NOTE: could not verify the production schema (set PROD_DATABASE_URL to enable)."
  say "      If this branch adds columns, apply their DDL BEFORE pushing —"
  say "      the deployed code is replaced within five minutes, the schema is not."
fi

if [ "$DRY_RUN" = "1" ]; then
  say "--dry-run: stopping before the push."
  git --no-pager log --oneline origin/main..HEAD
  exit 0
fi

# --- snapshot ----------------------------------------------------------------
ROLLBACK_TO="$(git rev-parse origin/main)"
say "rollback anchor: ${ROLLBACK_TO:0:7} (git revert or reset to this to undo)"

# --- push --------------------------------------------------------------------
say "pushing to origin/main..."
git push origin HEAD:main
say "pushed. The host polls every 5 minutes; waiting up to 12."

# --- wait for the deploy -----------------------------------------------------
TARGET="$(git rev-parse HEAD)"
for i in $(seq 1 24); do
  sleep 30
  git -C "$REPO_DIR" fetch -q origin main 2>/dev/null || true
  CURRENT="$(git -C "$REPO_DIR" rev-parse HEAD)"
  if [ "$CURRENT" = "$TARGET" ]; then
    say "production is now on ${TARGET:0:7} (after $((i * 30))s)"
    break
  fi
  [ $((i % 4)) -eq 0 ] && say "still on ${CURRENT:0:7}, waiting..."
done

# --- verify ------------------------------------------------------------------
say "running the production smoke test..."
if GUILDSERVER_REPO_DIR="$REPO_DIR" "$HERE/scripts/prod-smoke.sh"; then
  say "SMOKE PASSED."
else
  say "SMOKE FAILED. To roll back:"
  say "  git revert --no-edit ${ROLLBACK_TO}..HEAD && git push origin HEAD:main"
  say "The host will redeploy the reverted state within five minutes."
  exit 1
fi
