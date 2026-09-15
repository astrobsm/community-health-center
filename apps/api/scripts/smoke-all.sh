#!/usr/bin/env bash
#
# Run every release acceptance suite, each against a freshly built database.
#
# A suite that runs second on a database another suite has already used fails
# for reasons that have nothing to do with the code — duplicate staff numbers,
# references already taken, a period already closed. Re-running one and reading
# the failures as real is a good way to spend a morning. So this resets between
# every suite, which is slow and is the only way the totals mean anything.
#
# Usage:  bash scripts/smoke-all.sh            (all suites)
#         bash scripts/smoke-all.sh clinical   (one of them)
set -u

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SUITES="${*:-auth assessment planning partnership documents execution clinical operations people analytics ai}"

API_PORT="${API_PORT:-3100}"
LOG="${SMOKE_LOG:-/tmp/chc-smoke-all.log}"

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=""

stop_api() {
  taskkill //F //IM node.exe >/dev/null 2>&1 || pkill -f 'node dist/src/main.js' >/dev/null 2>&1 || true
  sleep 2
}

start_api() {
  stop_api
  DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
  REDIS_URL="redis://localhost:56379" \
  STORAGE_ENDPOINT="http://127.0.0.1:59000" \
  STORAGE_ACCESS_KEY_ID=minioadmin STORAGE_SECRET_ACCESS_KEY=minioadmin \
  API_PORT="$API_PORT" \
    nohup bash scripts/run-local.sh >> "$LOG" 2>&1 &

  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/meta/health" 2>/dev/null)" = "200" ]; then
      return 0
    fi
    sleep 2
  done

  echo "    the API did not start; see $LOG"
  return 1
}

: > "$LOG"

echo
echo "============================================================"
echo " Every release acceptance suite, each on a fresh database"
echo "============================================================"

for suite in $SUITES; do
  script="scripts/smoke-$suite.sh"

  if [ ! -f "$script" ]; then
    echo
    echo "--- $suite: no such suite ($script) ---"
    FAILED_SUITES="$FAILED_SUITES $suite(missing)"
    continue
  fi

  echo
  echo "--- $suite ---"
  printf '    resetting the database... '
  if ! bash scripts/setup-local-demo.sh >> "$LOG" 2>&1; then
    echo "FAILED (see $LOG)"
    FAILED_SUITES="$FAILED_SUITES $suite(setup)"
    continue
  fi
  echo 'done'

  # The AI suite starts and stops the API itself, four times, because the kill
  # switch is boot configuration.
  if [ "$suite" != "ai" ]; then
    printf '    starting the API... '
    if ! start_api; then
      FAILED_SUITES="$FAILED_SUITES $suite(api)"
      continue
    fi
    echo 'done'
  fi

  output=$(bash "$script" 2>&1)
  line=$(printf '%s' "$output" | grep -E '^PASSED [0-9]+ +FAILED [0-9]+' | tail -1)

  if [ -z "$line" ]; then
    echo "    NO RESULT — the suite did not reach its summary"
    printf '%s\n' "$output" | tail -15
    FAILED_SUITES="$FAILED_SUITES $suite(no-result)"
    continue
  fi

  pass=$(printf '%s' "$line" | awk '{print $2}')
  fail=$(printf '%s' "$line" | awk '{print $4}')

  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))

  if [ "$fail" -eq 0 ]; then
    printf '    %-12s %3d passed\n' "$suite" "$pass"
  else
    printf '    %-12s %3d passed, %d FAILED\n' "$suite" "$pass" "$fail"
    printf '%s\n' "$output" | grep '  FAIL' | sed 's/^/      /'
    FAILED_SUITES="$FAILED_SUITES $suite"
  fi
done

stop_api

echo
echo "============================================================"
printf ' TOTAL  %d passed   %d failed\n' "$TOTAL_PASS" "$TOTAL_FAIL"
[ -n "$FAILED_SUITES" ] && printf ' Suites with failures:%s\n' "$FAILED_SUITES"
echo "============================================================"

[ "$TOTAL_FAIL" -eq 0 ] && [ -z "$FAILED_SUITES" ]
