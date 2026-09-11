#!/usr/bin/env bash
# Fail if a package has MORE TypeScript errors than its recorded baseline.
#
# Both apps are at zero errors (baselines of 0), so any type error fails CI.
# The baseline files remain so a package that has to carry errors for a while
# can do so explicitly and visibly, rather than by switching the check off.
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
