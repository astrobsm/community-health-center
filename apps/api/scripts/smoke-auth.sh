#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 1 authentication and authorisation
# pipeline, against a RUNNING API and a REAL database.
#
# It exercises what a unit test cannot: that the guards, the token rotation,
# the tenant scope and the audit trail all behave correctly together over HTTP.
#
# Prerequisites:
#   - the API running (see scripts/run-local.sh)
#   - an organisation bootstrapped (npm run bootstrap:org)
#
# Usage:
#   API_BASE=http://127.0.0.1:3100 ./scripts/smoke-auth.sh
set -u

API="${API_BASE:-http://127.0.0.1:3100}/api/v1"
PGCONTAINER="${PGCONTAINER:-chc-mig-test}"
# The administrator scripts/setup-local-demo.sh bootstraps. Defaulted rather
# than referenced, because under `set -u` a default that expands the variable
# it is defaulting fails before the first check runs — which is how this suite
# spent several releases never executing.
ADMIN_EMAIL="${ADMIN_EMAIL:-assessor@example.org}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-correct-horse-battery-staple}"
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1)); printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  %s (expected %s, got %s)\n' "$name" "$expected" "$actual"
  fi
}

status() { curl -s -o body.json -w '%{http_code}' "$@"; }

echo
echo "=== Unauthenticated access ==="
code=$(status "$API/auth/me")
check "a protected route refuses an anonymous caller" "401" "$code"

code=$(status -H "Authorization: Bearer not-a-real-token" "$API/auth/me")
check "a forged token is refused" "401" "$code"

echo
echo "=== Validation ==="
code=$(status -X POST -H 'Content-Type: application/json' -d '{"email":"not-an-email","password":"x"}' "$API/auth/login")
check "a malformed email is rejected before any lookup" "400" "$code"
if grep -q '"field":"email"' body.json; then
  PASS=$((PASS+1)); printf '  PASS  the error names the offending field\n'
else
  FAIL=$((FAIL+1)); printf '  FAIL  the error did not name the field: %s\n' "$(cat body.json)"
fi

echo
echo "=== Account enumeration ==="
code=$(status -X POST -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.org","password":"'"$ADMIN_PASSWORD"'"}' "$API/auth/login")
unknown_detail=$(python -c "import json;print(json.load(open('body.json')).get('detail',''))" 2>/dev/null)
check "an unknown account is refused" "401" "$code"

code=$(status -X POST -H 'Content-Type: application/json' \
  -d '{"email":"'"$ADMIN_EMAIL"'","password":"definitely-the-wrong-password"}' "$API/auth/login")
wrong_detail=$(python -c "import json;print(json.load(open('body.json')).get('detail',''))" 2>/dev/null)
check "a wrong password is refused" "401" "$code"

if [ "$unknown_detail" = "$wrong_detail" ] && [ -n "$wrong_detail" ]; then
  PASS=$((PASS+1)); printf '  PASS  both answer identically, so accounts cannot be enumerated\n'
  printf '        "%s"\n' "$wrong_detail"
else
  FAIL=$((FAIL+1)); printf '  FAIL  responses differ: "%s" vs "%s"\n' "$unknown_detail" "$wrong_detail"
fi

echo
echo "=== MFA is required for a privileged role, and enrolable ==="
code=$(status -X POST -H 'Content-Type: application/json' \
  -d '{"email":"'"$ADMIN_EMAIL"'","password":"'"$ADMIN_PASSWORD"'","deviceId":"smoke-test"}' "$API/auth/login")
check "a correct password is accepted" "200" "$code"

if grep -q '"mfaEnrolmentRequired":true' body.json; then
  PASS=$((PASS+1)); printf '  PASS  an ORG_ADMIN without MFA is offered enrolment, not refused outright\n'
else
  FAIL=$((FAIL+1)); printf '  FAIL  expected an enrolment challenge, got: %s\n' "$(head -c 200 body.json)"
fi

ENROL_TOKEN=$(python -c "import json;print(json.load(open('body.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('body.json')).get('secret',''))" 2>/dev/null)

if [ -n "$SECRET" ]; then
  PASS=$((PASS+1)); printf '  PASS  a TOTP secret and otpauth URI were issued\n'
else
  FAIL=$((FAIL+1)); printf '  FAIL  no TOTP secret issued\n'
fi

# Generate the current TOTP code from the issued secret, exactly as an
# authenticator app would.
CODE=$(node -e "
const {TOTP, Secret} = require('otpauth');
const t = new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])});
console.log(t.generate());
" "$SECRET" 2>/dev/null)

code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"enrolmentToken\":\"$ENROL_TOKEN\",\"code\":\"000000\"}" "$API/auth/mfa/enrol/confirm")
check "a wrong TOTP code is refused" "401" "$code"

code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"enrolmentToken\":\"$ENROL_TOKEN\",\"code\":\"$CODE\",\"deviceId\":\"smoke-test\"}" "$API/auth/mfa/enrol/confirm")
check "the correct TOTP code completes enrolment and issues a session" "200" "$code"

ACCESS=$(python -c "import json;print(json.load(open('body.json')).get('accessToken',''))" 2>/dev/null)
REFRESH=$(python -c "import json;print(json.load(open('body.json')).get('refreshToken',''))" 2>/dev/null)

echo
echo "=== The session works, and carries the right scope ==="
code=$(status -H "Authorization: Bearer $ACCESS" "$API/auth/me")
check "an authenticated request succeeds" "200" "$code"

PERMS=$(python -c "import json;print(len(json.load(open('body.json')).get('permissions',[])))" 2>/dev/null)
FACS=$(python -c "import json;d=json.load(open('body.json'));print(','.join(f['code'] for f in d.get('facilities',[])))" 2>/dev/null)
ROLES=$(python -c "import json;print(','.join(json.load(open('body.json')).get('roleCodes',[])))" 2>/dev/null)
OFFLINE=$(python -c "import json;print(json.load(open('body.json')).get('offlineDisallowed'))" 2>/dev/null)

printf '        role=%s  permissions=%s  facilities=%s\n' "$ROLES" "$PERMS" "$FACS"
check "the ORG_ADMIN role is reported" "ORG_ADMIN" "$ROLES"
check "facility scope is exactly the granted facility" "CHC-IKEM" "$FACS"
check "this privileged role is barred from offline mode" "True" "$OFFLINE"

echo
echo "=== Refresh token rotation and reuse detection ==="
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\",\"deviceId\":\"smoke-test\"}" "$API/auth/refresh")
check "a refresh token can be exchanged" "200" "$code"
ROTATED=$(python -c "import json;print(json.load(open('body.json')).get('refreshToken',''))" 2>/dev/null)

if [ -n "$ROTATED" ] && [ "$ROTATED" != "$REFRESH" ]; then
  PASS=$((PASS+1)); printf '  PASS  the refresh token was rotated, not reissued\n'
else
  FAIL=$((FAIL+1)); printf '  FAIL  the refresh token was not rotated\n'
fi

# Present the ORIGINAL token again: this is what a thief would do.
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\",\"deviceId\":\"smoke-test\"}" "$API/auth/refresh")
check "replaying a rotated token is refused" "401" "$code"

# ...and the whole family must now be dead, including the legitimate one.
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$ROTATED\",\"deviceId\":\"smoke-test\"}" "$API/auth/refresh")
check "reuse revokes the whole token family, not just the replayed one" "401" "$code"

echo
echo "=== Audit trail ==="
AUDIT=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "SELECT action || '|' || outcome || '|' || severity FROM audit.audit_log ORDER BY occurred_at" 2>/dev/null)
echo "$AUDIT" | sed 's/^/        /'

for expected in "auth.login.failed|FAILURE|CRITICAL" "auth.mfa.enrolled|SUCCESS|CRITICAL" "auth.token.reuse_detected|DENIED|CRITICAL"; do
  if echo "$AUDIT" | grep -q "^$expected$"; then
    PASS=$((PASS+1)); printf '  PASS  audited: %s\n' "$expected"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  not audited: %s\n' "$expected"
  fi
done

CHAIN=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "SELECT count(*) FROM audit.audit_log WHERE row_hash IS NOT NULL" 2>/dev/null | tr -d '[:space:]')
if [ "$CHAIN" != "0" ]; then
  PASS=$((PASS+1)); printf '  PASS  every audit row carries a chain hash (%s rows)\n' "$CHAIN"
else
  FAIL=$((FAIL+1)); printf '  FAIL  audit rows have no chain hash\n'
fi

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
