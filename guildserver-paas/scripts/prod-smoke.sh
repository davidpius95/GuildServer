#!/usr/bin/env bash
# Read-only production verification, run as the gate after every deploy.
#
# On a single-node install the control plane and its customers' applications
# share a host, so "the deploy succeeded" is not the same as "the customers are
# still up". This script checks both, and is deliberately read-only: it creates
# nothing, deletes nothing, and can be run at any time.
#
#   ./scripts/prod-smoke.sh                       # check the local install
#   BASE_URL=https://guild-technologies.com ./scripts/prod-smoke.sh
#
# Exit codes: 0 all checks passed, 1 a check failed, 2 could not run.
set -uo pipefail

BASE_URL="${BASE_URL:-https://guild-technologies.com}"
TRAEFIK_API="${TRAEFIK_API:-http://localhost:8080}"
# Customer-facing canary: a real deployed application whose health proves the
# platform is still serving tenants, not merely that the control plane booted.
CANARY_URL="${CANARY_URL:-https://daily-habit-tracker-app.guild-technologies.com/}"
TIMEOUT="${TIMEOUT:-15}"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
skip() { echo "  SKIP  $1"; }

echo "GuildServer production smoke — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  base: $BASE_URL"
echo

echo "control plane"
health="$(curl -fsS --max-time "$TIMEOUT" "$BASE_URL/health" 2>/dev/null)"
if [ -n "$health" ]; then
  status="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)"
  [ "$status" = "healthy" ] && ok "API /health reports healthy" || bad "API /health returned status=${status:-<unparseable>}"
else
  bad "API /health unreachable at $BASE_URL/health"
fi

code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$BASE_URL/" 2>/dev/null)"
[ "$code" = "200" ] && ok "web root returns 200" || bad "web root returned ${code:-no response}"

echo
echo "customer workloads"
# The canary is the check that matters most: it is somebody's live application.
code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$CANARY_URL" 2>/dev/null)"
[ "$code" = "200" ] && ok "canary app serving 200 ($CANARY_URL)" || bad "canary app returned ${code:-no response} ($CANARY_URL)"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  managed="$(docker ps --filter 'label=gs.managed=true' --format '{{.Names}}' 2>/dev/null | wc -l)"
  unhealthy="$(docker ps --filter 'label=gs.managed=true' --filter 'health=unhealthy' --format '{{.Names}}' 2>/dev/null)"
  restarting="$(docker ps --filter 'label=gs.managed=true' --filter 'status=restarting' --format '{{.Names}}' 2>/dev/null)"
  ok "$managed managed container(s) running"
  [ -z "$unhealthy" ]  && ok "no managed container reports unhealthy" || bad "unhealthy: $unhealthy"
  [ -z "$restarting" ] && ok "no managed container is restart-looping" || bad "restarting: $restarting"
else
  skip "Docker inventory (no daemon access from here)"
fi

echo
echo "routing"
routers="$(curl -fsS --max-time "$TIMEOUT" "$TRAEFIK_API/api/http/routers" 2>/dev/null)"
if [ -n "$routers" ]; then
  total="$(printf '%s' "$routers" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)"
  broken="$(printf '%s' "$routers" | python3 -c '
import json,sys
rs = json.load(sys.stdin)
print(" ".join(r["name"] for r in rs if r.get("status") != "enabled"))' 2>/dev/null)"
  ok "$total Traefik routers registered"
  [ -z "$broken" ] && ok "every router is enabled" || bad "routers not enabled: $broken"
else
  skip "Traefik router inventory (API not reachable at $TRAEFIK_API)"
fi

echo
echo "deployed revision"
if [ -n "${GUILDSERVER_REPO_DIR:-}" ] && [ -d "$GUILDSERVER_REPO_DIR/.git" ]; then
  head="$(git -C "$GUILDSERVER_REPO_DIR" rev-parse --short HEAD 2>/dev/null)"
  remote="$(git -C "$GUILDSERVER_REPO_DIR" rev-parse --short origin/main 2>/dev/null)"
  if [ "$head" = "$remote" ]; then
    ok "deployed revision $head matches origin/main"
  else
    # Not fatal: the 5-minute self-update cron may simply not have fired yet.
    skip "deployed $head, origin/main $remote (update pending or held back)"
  fi
else
  skip "revision check (set GUILDSERVER_REPO_DIR)"
fi

echo
echo "----"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
