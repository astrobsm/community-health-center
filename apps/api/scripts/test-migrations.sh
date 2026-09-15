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

echo "==> Application and AI roles"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -q -U chc_migrator -d chc -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='chc_app') THEN CREATE ROLE chc_app LOGIN PASSWORD 'apppw'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ai_reader') THEN CREATE ROLE ai_reader LOGIN PASSWORD 'aipw'; END IF;
END \$\$;
GRANT USAGE ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT EXECUTE ON FUNCTION core.authenticate_lookup(citext), core.user_scope_lookup(uuid) TO chc_app;
GRANT USAGE ON SCHEMA analytics TO chc_app;
GRANT SELECT ON analytics.daily_financial, analytics.view_refresh TO chc_app;
REVOKE ALL ON analytics.mv_daily_financial FROM chc_app;
ALTER ROLE chc_app NOBYPASSRLS;
REVOKE ALL ON ALL TABLES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader;
REVOKE ALL ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader;
GRANT USAGE ON SCHEMA analytics TO ai_reader;
GRANT SELECT ON analytics.ai_daily_clinical, analytics.ai_daily_supply, analytics.ai_quality_summary TO ai_reader;
REVOKE ALL ON analytics.mv_daily_financial, analytics.daily_financial FROM ai_reader;
ALTER ROLE ai_reader NOBYPASSRLS;
ALTER ROLE ai_reader SET default_transaction_read_only = on;
" >/dev/null

echo "==> Verifying invariants"
PGCONTAINER="$CONTAINER" bash "$HERE/verify-invariants.sh"
