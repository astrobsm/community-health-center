#!/usr/bin/env bash
#
# Runs the compiled API against the local Docker containers.
#
# Compiled rather than run through tsx: esbuild does not emit decorator
# metadata, which NestJS needs for constructor injection.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export NODE_ENV="${NODE_ENV:-development}"
export DATABASE_URL="${DATABASE_URL:-postgresql://chc_migrator:devpassword@localhost:5432/chc}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export API_PORT="${API_PORT:-3000}"
export API_HOST="${API_HOST:-127.0.0.1}"
export API_BASE_URL="${API_BASE_URL:-http://localhost:$API_PORT}"

# Object storage, defaulted to the MinIO container setup-local-demo.sh
# creates. Without these the API starts happily and then fails the first
# time somebody generates a document, with InvalidAccessKeyId from the S3
# client — which reads like a code fault and is not one.
export STORAGE_ENDPOINT="${STORAGE_ENDPOINT:-http://127.0.0.1:59000}"
export STORAGE_ACCESS_KEY_ID="${STORAGE_ACCESS_KEY_ID:-minioadmin}"
export STORAGE_SECRET_ACCESS_KEY="${STORAGE_SECRET_ACCESS_KEY:-minioadmin}"

../../node_modules/.bin/tsc -p tsconfig.json
exec node dist/src/main.js
