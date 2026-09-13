#!/usr/bin/env bash
#
# End-to-end migration test: empty database -> migrated -> fixtures -> invariants.
#
# Spins up a throwaway PostgreSQL 16, applies every migration in order, loads
# fixtures, and runs the invariant suite. This is the Release 0 acceptance gate
# (docs/architecture/21-development-roadmap.md).
#
# Usage:  npm run db:test-migrate  --workspace @chc/api

set -euo pipefail

CONTAINER=chc-mig-test
PORT="${PGPORT_TEST:-55432}"
IMAGE=postgres:16-alpine
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$HERE")"
PRISMA_BIN="$API_DIR/../../node_modules/.bin/prisma"

cleanup() {
  if [ "${KEEP_CONTAINER:-0}" != "1" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> Starting a throwaway PostgreSQL 16 on port $PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=chc \
  -e POSTGRES_USER=chc_migrator \
  -e POSTGRES_PASSWORD=testpw \
  -p "$PORT:5432" "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U chc_migrator -d chc >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "    ready"

echo "==> Applying migrations to an empty database"
DATABASE_URL="postgresql://chc_migrator:testpw@localhost:$PORT/chc" "$PRISMA_BIN" migrate deploy

echo "==> Loading fixtures"
docker cp "$HERE/fixtures.sql" "$CONTAINER:/tmp/fixtures.sql" >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U chc_migrator -d chc -q -f /tmp/fixtures.sql

echo "==> Verifying invariants"
PGCONTAINER="$CONTAINER" bash "$HERE/verify-invariants.sh"
