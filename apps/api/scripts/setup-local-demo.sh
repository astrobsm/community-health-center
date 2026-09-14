#!/usr/bin/env bash
#
# Brings up a clean local environment for manual testing and the smoke suites:
# a fresh PostgreSQL and Redis, all migrations, reference data, one
# organisation with one facility, and the two users that separation of duties
# requires.
#
# It creates NO patients, encounters, payments or stock — only the structure a
# real deployment starts with (spec §91).
#
# Usage:  bash scripts/setup-local-demo.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PG_CONTAINER="${PG_CONTAINER:-chc-mig-test}"
REDIS_CONTAINER="${REDIS_CONTAINER:-chc-redis-test}"
MINIO_CONTAINER="${MINIO_CONTAINER:-chc-minio-test}"
PG_PORT="${PG_PORT:-55432}"
REDIS_PORT="${REDIS_PORT:-56379}"
MINIO_PORT="${MINIO_PORT:-59000}"
PRISMA="../../node_modules/.bin/prisma"
TSX="../../node_modules/.bin/tsx"

export DATABASE_URL="postgresql://chc_migrator:testpw@localhost:$PG_PORT/chc"

echo "==> Recreating containers"
docker rm -f "$PG_CONTAINER" "$REDIS_CONTAINER" "$MINIO_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$PG_CONTAINER" \
  -e POSTGRES_DB=chc -e POSTGRES_USER=chc_migrator -e POSTGRES_PASSWORD=testpw \
  -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --name "$REDIS_CONTAINER" -p "$REDIS_PORT:6379" redis:7-alpine >/dev/null

# Object storage, so evidence uploads are genuinely exercised rather than
# stubbed. Without it the media path would only ever be tested in theory.
docker run -d --name "$MINIO_CONTAINER"   -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin   -p "$MINIO_PORT:9000" quay.io/minio/minio:latest server /data >/dev/null

for _ in $(seq 1 60); do
  docker exec "$PG_CONTAINER" pg_isready -U chc_migrator -d chc >/dev/null 2>&1 && break
  sleep 1
done
echo "    ready"

echo "==> Object storage buckets"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$MINIO_PORT/minio/health/live"; then break; fi
  sleep 1
done
docker run --rm --network host --entrypoint sh quay.io/minio/mc:latest -c "
  mc alias set local http://127.0.0.1:$MINIO_PORT minioadmin minioadmin >/dev/null 2>&1
  mc mb --ignore-existing local/chc-evidence >/dev/null 2>&1
  mc mb --ignore-existing local/chc-documents >/dev/null 2>&1
  echo '    buckets ready (private; access is via pre-signed URLs only)'
" || echo "    WARNING: bucket creation failed; evidence uploads will not work"

echo "==> Migrations"
$PRISMA migrate deploy

echo "==> Application database role"
docker exec "$PG_CONTAINER" psql -q -U chc_migrator -d chc -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='chc_app') THEN CREATE ROLE chc_app LOGIN PASSWORD 'apppw'; END IF;
END \$\$;
GRANT USAGE ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT EXECUTE ON FUNCTION core.authenticate_lookup(citext), core.user_scope_lookup(uuid) TO chc_app;
ALTER ROLE chc_app NOBYPASSRLS;
" >/dev/null

echo "==> Reference data"
$TSX prisma/seed/index.ts | tail -8

echo "==> Organisation, facility and administrator"
ORG_NAME="${ORG_NAME:-Ikem Health Partnership}" \
ORG_CODE="${ORG_CODE:-IHP}" \
FACILITY_NAME="${FACILITY_NAME:-Community Health Centre, Ikem}" \
FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
STATE="${STATE:-Enugu}" \
LGA="${LGA:-Isi-Uzo}" \
ADMIN_EMAIL="${ADMIN_EMAIL:-assessor@example.org}" \
ADMIN_NAME="${ADMIN_NAME:-A. Administrator}" \
ADMIN_PASSWORD="${ADMIN_PASSWORD:-correct-horse-battery-staple}" \
  $TSX prisma/seed/bootstrap-organisation.ts | grep -Ev 'role |chart of accounts|^  ' | tail -6

echo "==> Project manager"
EMAIL="${PM_EMAIL:-pm@example.org}" \
NAME="P. Manager" \
PASSWORD="${PM_PASSWORD:-correct-horse-battery-staple}" \
ROLE=PROJECT_MANAGER \
FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
  $TSX prisma/seed/create-user.ts

echo
echo "Ready. Start the API with:  bash scripts/run-local.sh"
echo "  DATABASE_URL=$DATABASE_URL"
echo "  REDIS_URL=redis://localhost:$REDIS_PORT"
echo "  STORAGE_ENDPOINT=http://127.0.0.1:$MINIO_PORT"
