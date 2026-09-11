#!/usr/bin/env bash
# Bring the ephemeral test stack up (or down) and export its connection strings.
#
#   ./scripts/test-env.sh up      # start postgres+redis, run migrations
#   ./scripts/test-env.sh down    # tear down, including volumes
#   eval "$(./scripts/test-env.sh env)"   # export TEST_DATABASE_URL etc.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="guildserver-test"
COMPOSE=(docker compose -p "$PROJECT" -f "$ROOT/docker-compose.test.yml")

export TEST_DATABASE_URL="postgresql://test:test@localhost:5433/guildserver_test"
export TEST_REDIS_URL="redis://localhost:6380/0"
export TEST_S3_ENDPOINT="http://127.0.0.1:9100"
export TEST_S3_ACCESS_KEY="gs-test-access"
export TEST_S3_SECRET_KEY="gs-test-secret-key"

case "${1:-up}" in
  up)
    "${COMPOSE[@]}" up -d --wait
    echo "Running migrations against $TEST_DATABASE_URL"
    DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @guildserver/database db:migrate
    echo "Test stack ready."
    ;;
  down)
    "${COMPOSE[@]}" down -v
    ;;
  env)
    echo "export TEST_DATABASE_URL='$TEST_DATABASE_URL'"
    echo "export DATABASE_URL='$TEST_DATABASE_URL'"
    echo "export REDIS_URL='$TEST_REDIS_URL'"
    echo "export TEST_S3_ENDPOINT='$TEST_S3_ENDPOINT'"
    ;;
  *)
    echo "usage: $0 {up|down|env}" >&2
    exit 1
    ;;
esac
