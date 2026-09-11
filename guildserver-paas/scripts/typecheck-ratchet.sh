#!/usr/bin/env bash
# Fail if a package has MORE TypeScript errors than its recorded baseline.
#
# apps/api and apps/web carry type errors from before CI ran at all. Production
# does not compile them with tsc (the API runs under tsx; Next builds with its
# own settings), so demanding zero would block every change without making
# anything safer. This holds the line instead: new code cannot add errors, and
# when a change removes some, lower the baseline in the same commit.
#
# Usage: scripts/typecheck-ratchet.sh <package-dir> <baseline-file>
set -euo pipefail
dir="$1"
baseline_file="$2"
baseline=$(tr -dc '0-9' < "$baseline_file")
output=$(cd "$dir" && npx tsc --noEmit 2>&1 || true)
count=$(printf '%s\n' "$output" | grep -c 'error TS' || true)
echo "$dir: $count TypeScript error(s); baseline $baseline"
if [ "$count" -gt "$baseline" ]; then
  echo "New type errors were introduced. Errors in this run:"
  printf '%s\n' "$output" | grep 'error TS' | head -200
  exit 1
fi
if [ "$count" -lt "$baseline" ]; then
  echo "Fewer errors than the baseline: lower $baseline_file to $count."
fi
