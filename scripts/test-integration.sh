#!/usr/bin/env bash
# Run integration tests against real Postgres, MySQL, and ClickHouse containers.
#
# Usage:
#   ./scripts/test-integration.sh            # start, test, stop
#   ./scripts/test-integration.sh --keep     # keep containers running after tests
#   ./scripts/test-integration.sh --no-start # assume containers already up, just run tests
set -euo pipefail

COMPOSE="docker compose -f docker-compose.test.yml"
KEEP=0
NO_START=0

for arg in "$@"; do
  case $arg in
    --keep)     KEEP=1 ;;
    --no-start) NO_START=1 ;;
  esac
done

cleanup() {
  if [[ $KEEP -eq 0 && $NO_START -eq 0 ]]; then
    echo ""
    echo "⏹  Stopping containers…"
    $COMPOSE down --volumes --remove-orphans
  fi
}
trap cleanup EXIT

# ─── Start containers ─────────────────────────────────────────────────────────
if [[ $NO_START -eq 0 ]]; then
  echo "🐳 Starting test containers…"
  $COMPOSE up -d --remove-orphans

  echo "⏳ Waiting for all services to be healthy…"
  # --wait requires Docker Compose v2.1+ ; it blocks until all healthchecks pass.
  $COMPOSE up -d --wait

  echo "✅ All services healthy."
fi

# ─── Run tests ────────────────────────────────────────────────────────────────
echo ""
echo "🧪 Running integration tests…"
echo ""

TEST_PG_URL="postgres://postgres:test@localhost:55432/testdb" \
TEST_MYSQL_URL="mysql://root:test@localhost:53306/testdb" \
TEST_CLICKHOUSE_URL="http://default:@localhost:58123/default" \
npx vitest run \
  src/drivers/postgres.test.ts \
  src/drivers/mysql.test.ts \
  src/drivers/clickhouse.test.ts

echo ""
echo "✅ Integration tests passed."
