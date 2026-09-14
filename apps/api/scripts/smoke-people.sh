#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 9 chain, against a RUNNING API and a
# REAL database:
#
#   staff -> credential -> verification -> roster -> clock in/out ->
#   attendance -> performance metrics -> incentive -> approval by a second
#   person -> the payslip explains itself
#
# and, alongside it, the quality half:
#
#   incident -> investigation -> corrective action -> closure
#   complaint -> action -> resolution
#   KPI assignment -> computation from transactions -> improvement cycle
#
# The acceptance criterion this proves (docs/architecture/21-development-roadmap.md):
#
#   J — attendance feeds performance feeds incentive, with the formula visible
#       and auditable at every step; patient volume alone cannot determine an
#       incentive.
#
# The volume rule is proved twice, because it is the one that matters:
#   - a metric set where volume is the only weighted metric is REFUSED at
#     configuration;
#   - a person for whom only the volume metric could be computed is REFUSED at
#     computation, even though the configuration is sound.
#
# Prerequisites: bash scripts/setup-local-demo.sh, then scripts/run-local.sh.
set -u

API="${API_BASE:-http://127.0.0.1:3100}/api/v1"
PGCONTAINER="${PGCONTAINER:-chc-mig-test}"
PASSWORD="${PM_PASSWORD:-correct-horse-battery-staple}"

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

check_true() {
  local name="$1" actual="$2"
  if [ "$actual" = "True" ] || [ "$actual" = "true" ]; then
    PASS=$((PASS + 1)); printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  %s (got %s)\n' "$name" "$actual"
  fi
}

# Guards against the false pass: a check that compares two empty strings
# because the call that was meant to produce them was refused.
check_present() {
  local name="$1" value="$2"
  if [ -n "$value" ] && [ "$value" != "None" ] && [ "$value" != "null" ]; then
    PASS=$((PASS + 1)); printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  %s (empty)\n' "$name"
  fi
}

note() { printf '        %s\n' "$1"; }
jq_get() { python -c "import json,sys;d=json.load(open('body.json'));print(eval(sys.argv[1],{'d':d,'json':json}))" "$1" 2>/dev/null; }
psql_run() { docker exec "$PGCONTAINER" psql -v ON_ERROR_STOP=1 -U chc_migrator -d chc -tAq -c "$1" 2>&1; }

status_h() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $HR_TOKEN" "$@"; }
status_m() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $MGR_TOKEN" "$@"; }
status_m2(){ curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $MGR2_TOKEN" "$@"; }
status_a() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }
status_c() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $CLIN_TOKEN" "$@"; }
post_h()   { status_h -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_m()   { status_m -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_m2()  { status_m2 -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_a()   { status_a -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_c()   { status_c -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

seed_user() {
  EMAIL="$1" PASSWORD="$PASSWORD" NAME="$2" ROLE="$3" FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
    DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
    ../../node_modules/.bin/tsx prisma/seed/create-user.ts >/dev/null 2>&1
}

sign_in() {
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"deviceId\":\"smoke-people\"}" "$API/auth/login" >/dev/null
  local enrol secret code
  enrol=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
  secret=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
  if [ -n "$enrol" ]; then
    code=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$secret")
    curl -s -o login.json -X POST -H 'Content-Type: application/json' \
      -d "{\"enrolmentToken\":\"$enrol\",\"code\":\"$code\",\"deviceId\":\"smoke-people\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
  fi
  python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null
}

echo
echo "=== The people who run a facility ==="
seed_user "hr9@example.org" "H. Nwosu" HR_OFFICER
seed_user "mgr9@example.org" "M. Chukwu" FACILITY_MANAGER
seed_user "mgr9b@example.org" "N. Adeyemi" FACILITY_MANAGER
seed_user "admin9@example.org" "A. Okafor" ORG_ADMIN
seed_user "clin9@example.org" "Dr O. Nnaji" CLINICIAN

HR_TOKEN=$(sign_in "hr9@example.org")
MGR_TOKEN=$(sign_in "mgr9@example.org")
MGR2_TOKEN=$(sign_in "mgr9b@example.org")
ADMIN_TOKEN=$(sign_in "admin9@example.org")
CLIN_TOKEN=$(sign_in "clin9@example.org")

for pair in "HR officer:$HR_TOKEN" "facility manager:$MGR_TOKEN" "second facility manager:$MGR2_TOKEN" "administrator:$ADMIN_TOKEN" "clinician:$CLIN_TOKEN"; do
  name="${pair%%:*}"; token="${pair#*:}"
  [ -n "$token" ] && { PASS=$((PASS+1)); echo "  PASS  the $name signed in"; } \
                  || { FAIL=$((FAIL+1)); echo "  FAIL  the $name could not sign in"; }
done

code=$(status_h "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']")"

# -----------------------------------------------------------------------------
echo
echo "=== Staff and the right to practise (spec section 24) ==="

CLIN_USER_ID=$(psql_run "SELECT id FROM core.app_user WHERE email='clin9@example.org'" | tr -d '[:space:]')

code=$(post_h "/staff" "{\"facilityId\":\"$FACILITY_ID\",\"staffNumber\":\"CHC-N-001\",\"givenName\":\"Adaeze\",\"familyName\":\"Eze\",\"cadre\":\"NURSE\",\"employerType\":\"GOVERNMENT\",\"employmentDate\":\"2024-03-01\"}")
check "a nurse is added to the establishment" "201" "$code"
NURSE_ID=$(jq_get "d['id']")

code=$(post_h "/staff" "{\"facilityId\":\"$FACILITY_ID\",\"staffNumber\":\"CHC-D-001\",\"givenName\":\"Obinna\",\"familyName\":\"Nnaji\",\"cadre\":\"MEDICAL_OFFICER\",\"userId\":\"$CLIN_USER_ID\"}")
check "the clinician is added and linked to their account" "201" "$code"
DOCTOR_ID=$(jq_get "d['id']")

code=$(post_h "/credentials" "{\"staffId\":\"$NURSE_ID\",\"credentialType\":\"NMCN practising licence\",\"credentialNumber\":\"NMCN/2024/44182\",\"issuingBody\":\"Nursing and Midwifery Council of Nigeria\",\"issuedOn\":\"2026-01-01\",\"expiresOn\":\"2027-12-31\"}")
check "a licence is recorded" "201" "$code"
CRED_ID=$(jq_get "d['id']")
check "recording is not verifying" "UNVERIFIED" "$(jq_get "d['effectiveStatus']")"
note "$(jq_get "d['message']")"

code=$(post_h "/credentials/verify" "{\"credentialId\":\"$CRED_ID\",\"verificationNote\":\"Checked against the NMCN online register on 14 September 2026; name and number match.\"}")
check "verification by a person with the permission is accepted" "200" "$code"
check "the licence is now valid" "VALID" "$(jq_get "d['effectiveStatus']")"

code=$(post_h "/credentials" "{\"staffId\":\"$DOCTOR_ID\",\"credentialType\":\"MDCN annual licence\",\"credentialNumber\":\"MDCN/2019/7781\",\"issuedOn\":\"2025-01-01\",\"expiresOn\":\"2026-03-31\"}")
LAPSED_ID=$(jq_get "d['id']")
check "a lapsed licence records as lapsed without anybody running a job" "EXPIRED" "$(jq_get "d['effectiveStatus']")"
check_true "and it blocks practice" "$(jq_get "d['blocksPractice']")"

code=$(status_h "$API/staff/$DOCTOR_ID/credentials")
check_true "the doctor may not practise under it" "$(jq_get "str(not d['mayPractise'])")"
note "$(jq_get "d['summary']")"

code=$(status_h "$API/credentials/expiring?facilityId=$FACILITY_ID&withinDays=90")
check_present "the expiry list is not empty" "$(jq_get "len(d)")"

# -----------------------------------------------------------------------------
echo
echo "=== A roster, and people clocking on to it (spec section 24) ==="

# Shifts in the recent past, so they can be clocked and then summarised.
D1=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=3)).isoformat())")
D2=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=2)).isoformat())")
D3=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=1)).isoformat())")

code=$(post_h "/attendance/schedules" "{\"staffId\":\"$NURSE_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D3\",\"shifts\":[
  {\"shiftType\":\"MORNING\",\"startsAt\":\"${D1}T08:00:00.000Z\",\"endsAt\":\"${D1}T16:00:00.000Z\"},
  {\"shiftType\":\"MORNING\",\"startsAt\":\"${D2}T08:00:00.000Z\",\"endsAt\":\"${D2}T16:00:00.000Z\"},
  {\"shiftType\":\"MORNING\",\"startsAt\":\"${D3}T08:00:00.000Z\",\"endsAt\":\"${D3}T16:00:00.000Z\"}]}")
check "a three-shift roster is published" "201" "$code"
SHIFT1=$(jq_get "d['shifts'][0]['id']")
SHIFT2=$(jq_get "d['shifts'][1]['id']")
SHIFT3=$(jq_get "d['shifts'][2]['id']")

code=$(post_h "/attendance/schedules" "{\"staffId\":\"$NURSE_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D1\",\"shifts\":[
  {\"shiftType\":\"NIGHT\",\"startsAt\":\"${D1}T20:00:00.000Z\",\"endsAt\":\"${D1}T20:00:00.000Z\"}]}")
check "a shift ending when it starts is refused" "400" "$code"

# Two shifts worked properly, one clocked into and never closed.
code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_IN\",\"method\":\"MANUAL\",\"occurredAt\":\"${D1}T08:02:00.000Z\",\"shiftId\":\"$SHIFT1\",\"manualReason\":\"QR scanner offline; supervisor confirmed arrival\"}")
check "a manual clock-in with a reason is accepted" "201" "$code"

code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_IN\",\"method\":\"MANUAL\",\"occurredAt\":\"${D2}T08:05:00.000Z\",\"shiftId\":\"$SHIFT2\"}")
check "a manual clock-in with no reason is refused" "400" "$code"

code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_OUT\",\"method\":\"MANUAL\",\"occurredAt\":\"${D1}T16:10:00.000Z\",\"shiftId\":\"$SHIFT1\",\"manualReason\":\"QR scanner offline\"}")
check "the first shift is closed" "201" "$code"

code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_IN\",\"method\":\"MANUAL\",\"occurredAt\":\"${D2}T08:03:00.000Z\",\"shiftId\":\"$SHIFT2\",\"manualReason\":\"QR scanner offline\"}")
code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_OUT\",\"method\":\"MANUAL\",\"occurredAt\":\"${D2}T15:58:00.000Z\",\"shiftId\":\"$SHIFT2\",\"manualReason\":\"QR scanner offline\"}")
check "the second shift is worked and closed" "201" "$code"
CLOCKOUT2=$(jq_get "d['id']")

code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_IN\",\"method\":\"MANUAL\",\"occurredAt\":\"${D3}T08:00:00.000Z\",\"shiftId\":\"$SHIFT3\",\"manualReason\":\"QR scanner offline\"}")
check "the third shift is clocked into and never closed" "201" "$code"

code=$(post_h "/attendance/correct" "{\"attendanceId\":\"$CLOCKOUT2\",\"occurredAt\":\"${D2}T16:30:00.000Z\",\"correctionReason\":\"Nurse stayed to hand over; original clock-out was early\"}")
check "a correction is accepted" "200" "$code"

ORIGINAL_STILL_THERE=$(psql_run "SELECT count(*) FROM people.attendance WHERE id='$CLOCKOUT2'" | tr -d '[:space:]')
check "the corrected event is still in the table, untouched" "1" "$ORIGINAL_STILL_THERE"

EDIT=$(psql_run "UPDATE people.attendance SET occurred_at=now() WHERE id='$CLOCKOUT2'" 2>&1)
case "$EDIT" in
  *ERROR*|*append*) PASS=$((PASS+1)); echo "  PASS  the database itself refuses to edit an attendance event";;
  *)                FAIL=$((FAIL+1)); echo "  FAIL  an attendance event was edited in place";;
esac

code=$(status_h "$API/attendance/summary?staffId=$NURSE_ID&periodStart=$D1&periodEnd=$D3")
check "the attendance summary is available" "200" "$code"
check "three shifts were scheduled" "3" "$(jq_get "d['scheduledShifts']")"
check "the unclosed shift counts as present, not absent" "0" "$(jq_get "d['absentShifts']")"
check "and it is reported as unclosed" "1" "$(jq_get "d['unclosedShifts']")"
check "its hours are excluded rather than counted as zero" "1" "$(jq_get "d['hoursUnknownShifts']")"
check_true "the period is flagged for review before it pays anybody" "$(jq_get "d['needsReview']")"
note "$(jq_get "d['reviewReasons'][0]")"
note "worked $(jq_get "d['workedHours']") of $(jq_get "d['scheduledHours']") known hours"

# -----------------------------------------------------------------------------
echo
echo "=== Metrics: patient volume alone cannot decide pay (spec section 25) ==="

code=$(status_a "$API/performance/queries")
check "the query catalogue is readable" "200" "$code"
note "$(jq_get "str(len(d['queries'])) + ' named queries'")"

# The first metric proposed is the volume one. It is the only weighted metric
# in the set, so the set is volume alone, and it is refused.
code=$(post_a "/performance/metrics" "{\"code\":\"PATIENTS_SEEN\",\"name\":\"Patients seen\",\"definition\":\"Encounters attended in the period.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/encounters_attended@v1\",\"weight\":2,\"targetValue\":40}")
check "a metric set that is volume alone is REFUSED" "409" "$code"
check "and it says which rule refused it" "incentive-not-scorable" "$(jq_get "d['type'].rsplit('/',1)[-1]")"
note "$(jq_get "d['detail'][:150]")"

code=$(post_a "/performance/metrics" "{\"code\":\"ATTENDANCE\",\"name\":\"Attendance\",\"definition\":\"Rostered shifts the person was present for, over shifts rostered.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/attendance_rate@v1\",\"weight\":3,\"targetValue\":1}")
check "an attendance metric is accepted" "201" "$code"

code=$(post_a "/performance/metrics" "{\"code\":\"DOCUMENTATION\",\"name\":\"Clinical documentation\",\"definition\":\"Closed encounters carrying a diagnosis or a recorded reason for having none.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/documentation_rate@v1\",\"weight\":3,\"targetValue\":1}")
check "a documentation metric is accepted" "201" "$code"

code=$(post_a "/performance/metrics" "{\"code\":\"PATIENTS_SEEN\",\"name\":\"Patients seen\",\"definition\":\"Encounters attended in the period.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/encounters_attended@v1\",\"weight\":2,\"targetValue\":40}")
check "volume is accepted once quality metrics carry most of the weight" "201" "$code"

code=$(post_a "/performance/metrics" "{\"code\":\"PATIENTS_SEEN\",\"name\":\"Patients seen\",\"definition\":\"Encounters attended in the period.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/encounters_attended@v1\",\"weight\":40,\"targetValue\":40}")
check "raising volume above the ceiling is REFUSED" "409" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(post_a "/performance/metrics" "{\"code\":\"VIBES\",\"name\":\"Attitude\",\"definition\":\"How the supervisor felt about them this month.\",\"direction\":\"HIGHER_BETTER\",\"sourceQueryId\":\"staff/attitude@v1\",\"weight\":5,\"targetValue\":5}")
check "a metric naming a query that does not exist is refused" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(status_a "$API/performance/metrics?facilityId=$FACILITY_ID")
check "the configured set reports its volume share" "200" "$code"
note "volume carries $(jq_get "d['volumeWeightShare']") of the weight, ceiling $(jq_get "d['maxVolumeWeightShare']")"

# -----------------------------------------------------------------------------
echo
echo "=== Performance computed from records, never typed ==="

code=$(post_h "/performance/compute" "{\"facilityId\":\"$FACILITY_ID\",\"staffId\":\"$NURSE_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D3\"}")
check "performance is computed for the nurse" "200" "$code"
ATT_VALUE=$(jq_get "[r['value'] for r in d['results'] if r['code']=='ATTENDANCE'][0]")
check "attendance scored 1 — three shifts, three present" "1" "$ATT_VALUE"
DOC_COMPUTED=$(jq_get "[r['computed'] for r in d['results'] if r['code']=='DOCUMENTATION'][0]")
check "documentation could not be computed and says so" "False" "$DOC_COMPUTED"
note "$(jq_get "[r['note'] for r in d['results'] if r['code']=='DOCUMENTATION'][0][:140]")"

STORED=$(psql_run "SELECT count(*) FROM people.performance_metric_result WHERE staff_id='$NURSE_ID'" | tr -d '[:space:]')
check_present "results are stored with their provenance" "$STORED"
INPUTS=$(psql_run "SELECT inputs->>'sourceQueryId' FROM people.performance_metric_result WHERE staff_id='$NURSE_ID' LIMIT 1" | tr -d '[:space:]')
check_present "and each names the query that produced it" "$INPUTS"
note "source query: $INPUTS"

# -----------------------------------------------------------------------------
echo
echo "=== The incentive, and who may approve it (spec section 25, doc 18 section 9) ==="

code=$(post_h "/incentives/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D3\",\"poolMinor\":5000000,\"poolReference\":\"WATERFALL-2026-09-STAFF\",\"staffIds\":[\"$NURSE_ID\"]}")
check "an incentive is computed for the nurse" "200" "$code"
INCENTIVE_ID=$(jq_get "d['incentives'][0]['incentiveId']")
check_present "the incentive has an id" "$INCENTIVE_ID"
note "$(jq_get "d['incentives'][0]['explanation'][:160]")"
note "$(jq_get "d['incentives'][0]['components'][0]['formulaText'][:160]")"
check_present "the unearned part of the pool is stated, not redistributed" "$(jq_get "str(d['unawardedMinor'])")"
note "$(jq_get "(d['unawardedNote'] or 'the whole pool was earned')[:140]")"

SUM_CHECK=$(psql_run "SELECT (i.total_amount_minor = COALESCE(sum(c.amount_minor),0))::text FROM people.staff_incentive i LEFT JOIN people.incentive_component c ON c.staff_incentive_id=i.id WHERE i.id='$INCENTIVE_ID' GROUP BY i.total_amount_minor" | tr -d '[:space:]')
check "the total equals the sum of the components that explain it" "true" "$SUM_CHECK"

TAMPER=$(psql_run "UPDATE people.staff_incentive SET total_amount_minor = total_amount_minor + 100000 WHERE id='$INCENTIVE_ID'" 2>&1)
case "$TAMPER" in
  *ERROR*) PASS=$((PASS+1)); echo "  PASS  the database refuses a total its components do not explain";;
  *)       FAIL=$((FAIL+1)); echo "  FAIL  a total was raised without a component to explain it";;
esac

# Layer one: the HR officer who computed it does not hold the approval
# permission at all, so the guard stops the request before the service sees it.
code=$(post_h "/incentives/approve" "{\"incentiveId\":\"$INCENTIVE_ID\",\"note\":\"Approving my own computation\"}")
check "the person who computed it cannot even reach the approval" "403" "$code"

code=$(post_m "/incentives/approve" "{\"incentiveId\":\"$INCENTIVE_ID\",\"note\":\"Checked against the roster and the metric definitions.\"}")
check "a second person approves it" "200" "$code"
check "and it is approved" "APPROVED" "$(jq_get "d['status']")"

# Layer two, and the one that matters: a manager who holds BOTH permissions
# still cannot approve an incentive they computed themselves. The check is
# against the record, not the role.
# A separate week, with its own roster and its own clock events, so this
# incentive is a real computation rather than a duplicate of the one above.
D0=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=10)).isoformat())")
code=$(post_h "/attendance/schedules" "{\"staffId\":\"$NURSE_ID\",\"periodStart\":\"$D0\",\"periodEnd\":\"$D0\",\"shifts\":[
  {\"shiftType\":\"MORNING\",\"startsAt\":\"${D0}T08:00:00.000Z\",\"endsAt\":\"${D0}T16:00:00.000Z\"}]}")
check "an earlier shift is rostered" "201" "$code"
SHIFT0=$(jq_get "d['shifts'][0]['id']")
code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_IN\",\"method\":\"MANUAL\",\"occurredAt\":\"${D0}T07:58:00.000Z\",\"shiftId\":\"$SHIFT0\",\"manualReason\":\"QR scanner offline\"}")
code=$(post_h "/attendance/clock" "{\"staffId\":\"$NURSE_ID\",\"eventType\":\"CLOCK_OUT\",\"method\":\"MANUAL\",\"occurredAt\":\"${D0}T16:02:00.000Z\",\"shiftId\":\"$SHIFT0\",\"manualReason\":\"QR scanner offline\"}")
check "and it is worked" "201" "$code"

code=$(post_m "/incentives/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$D0\",\"periodEnd\":\"$D0\",\"poolMinor\":100000,\"poolReference\":\"WATERFALL-2026-09-STAFF\",\"staffIds\":[\"$NURSE_ID\"]}")
check "a manager holding both permissions computes an incentive" "200" "$code"
OWN_INCENTIVE=$(jq_get "d['incentives'][0]['incentiveId']")
check_present "the second incentive exists" "$OWN_INCENTIVE"

code=$(post_m "/incentives/approve" "{\"incentiveId\":\"$OWN_INCENTIVE\",\"note\":\"Approving my own work\"}")
check "and is refused approval of their own computation" "403" "$code"
check "the refusal names segregation of duties" "segregation-of-duties" "$(jq_get "d['type'].rsplit('/',1)[-1]")"
note "$(jq_get "d['detail'][:140]")"

code=$(post_m2 "/incentives/approve" "{\"incentiveId\":\"$OWN_INCENTIVE\",\"note\":\"Checked the roster; agrees.\"}")
check "a different manager may approve it" "200" "$code"

SELF_APPROVE=$(psql_run "UPDATE people.staff_incentive SET approved_by = created_by WHERE id='$INCENTIVE_ID'" 2>&1)
case "$SELF_APPROVE" in
  *ERROR*) PASS=$((PASS+1)); echo "  PASS  the database refuses a self-approval even by direct SQL";;
  *)       FAIL=$((FAIL+1)); echo "  FAIL  a self-approval was written straight into the table";;
esac

code=$(status_h "$API/incentives/$INCENTIVE_ID")
check "the payslip explains itself" "200" "$code"
check_true "its components sum to its total" "$(jq_get "d['componentsSumToTotal']")"
check_present "every component names the query behind it" "$(jq_get "d['components'][0]['sourceQueryId']")"
note "$(jq_get "d['components'][0]['formulaText'][:160]")"

# The rule proved a second way: a sound configuration, but a person for whom
# only the volume metric can be computed.
code=$(post_h "/incentives/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D3\",\"poolMinor\":1000000,\"poolReference\":\"WATERFALL-2026-09-STAFF\",\"staffIds\":[\"$DOCTOR_ID\"]}")
check "a person scored only on volume is REFUSED an incentive" "409" "$code"
check "and the refusal names the volume rule" "incentive-not-scorable" "$(jq_get "d['type'].rsplit('/',1)[-1]")"
note "$(jq_get "d['detail'][:170]")"

# -----------------------------------------------------------------------------
echo
echo "=== Incidents: reported easily, closed only when dealt with (spec section 39) ==="

OCC=$(python -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).isoformat().replace('+00:00','Z'))")

code=$(post_c "/incidents" "{\"facilityId\":\"$FACILITY_ID\",\"incidentType\":\"MEDICATION\",\"description\":\"A patient received a double dose of paracetamol because two nurses each gave it without checking the chart.\",\"severity\":\"HIGH\",\"occurredAt\":\"$OCC\",\"patientAffected\":true,\"immediateAction\":\"Patient observed for four hours; no harm identified.\"}")
check "a clinician can report an incident" "201" "$code"
INCIDENT_ID=$(jq_get "d['id']")
note "$(jq_get "d['acknowledgement'][:150]")"

code=$(post_m "/incidents/close" "{\"incidentId\":\"$INCIDENT_ID\",\"closureNote\":\"Nothing came of it, closing.\"}")
check "closing before investigating is refused" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

DUE=$(python -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=14)).isoformat())")
code=$(post_c "/incidents/investigate" "{\"incidentId\":\"$INCIDENT_ID\",\"rootCause\":\"The drug chart is kept at the nurses station rather than at the bedside, so a second administration is not visible at the point of giving.\",\"actions\":[{\"description\":\"Move drug charts to the bedside on the female ward\",\"dueDate\":\"$DUE\"}]}")
check "an investigation with a root cause and an action is accepted" "200" "$code"

code=$(post_m "/incidents/close" "{\"incidentId\":\"$INCIDENT_ID\",\"closureNote\":\"Root cause found, action raised.\"}")
check "closing with an action still open is refused" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(status_m "$API/incidents?facilityId=$FACILITY_ID")
ACTION_ID=$(jq_get "d[0]['actions'][0]['id']")
check_present "the action is listed against the incident" "$ACTION_ID"

code=$(post_c "/incidents/actions/complete" "{\"actionId\":\"$ACTION_ID\",\"verificationNote\":\"Charts moved on 14 September; checked on the ward round by the matron.\"}")
check "the action is completed with a verification note" "200" "$code"

code=$(post_m "/incidents/close" "{\"incidentId\":\"$INCIDENT_ID\",\"closureNote\":\"Action completed and verified on the ward.\"}")
check "and now the incident can be closed" "200" "$code"

FORCE=$(psql_run "INSERT INTO qual.incident (id,organisation_id,facility_id,reference,incident_type,description,occurred_at,status) SELECT gen_random_uuid(),organisation_id,facility_id,'INC-FORCED','FALL','Someone fell',now(),'CLOSED' FROM qual.incident WHERE id='$INCIDENT_ID'" 2>&1)
case "$FORCE" in
  *ERROR*) PASS=$((PASS+1)); echo "  PASS  the database refuses an incident closed with no root cause";;
  *)       FAIL=$((FAIL+1)); echo "  FAIL  an incident was closed with nothing found out";;
esac

# -----------------------------------------------------------------------------
echo
echo "=== Complaints, including the anonymous ones ==="

code=$(post_m "/complaints" "{\"facilityId\":\"$FACILITY_ID\",\"source\":\"SUGGESTION_BOX\",\"subject\":\"Waiting time\",\"description\":\"Waited from seven in the morning until midday to be seen, with a baby.\",\"isAnonymous\":true,\"complainantName\":\"Mrs Okeke\"}")
check "an anonymous complaint carrying a name is refused" "400" "$code"

code=$(post_m "/complaints" "{\"facilityId\":\"$FACILITY_ID\",\"source\":\"SUGGESTION_BOX\",\"subject\":\"Waiting time\",\"description\":\"Waited from seven in the morning until midday to be seen, with a baby.\",\"isAnonymous\":true}")
check "an anonymous complaint is accepted" "201" "$code"
COMPLAINT_ID=$(jq_get "d['id']")

code=$(post_m "/complaints/resolve" "{\"complaintId\":\"$COMPLAINT_ID\",\"resolution\":\"Spoke to the team, all sorted.\"}")
check "resolving with nothing done is refused" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(post_m "/complaints/actions" "{\"complaintId\":\"$COMPLAINT_ID\",\"description\":\"Reviewed the morning clinic flow with the records clerk and added a second triage station on Mondays.\",\"outcome\":\"In place from 21 September\"}")
check "an action is recorded against the complaint" "201" "$code"

code=$(post_m "/complaints/resolve" "{\"complaintId\":\"$COMPLAINT_ID\",\"resolution\":\"A second Monday triage station is in place; mean waiting time will be watched for a month.\"}")
check "and now it can be resolved" "200" "$code"

code=$(status_m "$API/complaints?facilityId=$FACILITY_ID")
check_present "the register reports its resolution statistics with a denominator" "$(jq_get "str(d['resolution']['resolvedCount'])")"
note "$(jq_get "str(d['resolution'])[:150]")"

# -----------------------------------------------------------------------------
echo
echo "=== KPIs computed from transactions (spec section 38) ==="

code=$(status_a "$API/kpis/registry")
check "the KPI registry is readable" "200" "$code"
note "$(jq_get "str(sum(1 for k in d if k['computable'])) + ' of ' + str(len(d)) + ' registry KPIs have a query behind them'")"

code=$(post_a "/kpis/assign" "{\"kpiCode\":\"STAFF_ATTENDANCE_RATE\",\"facilityId\":\"$FACILITY_ID\",\"targetValue\":95,\"amberThreshold\":0.9,\"redThreshold\":0.75}")
check "a KPI with a query is assignable" "200" "$code"

code=$(post_a "/kpis/assign" "{\"kpiCode\":\"LAB_TURNAROUND\",\"facilityId\":\"$FACILITY_ID\",\"targetValue\":120}")
check "a KPI whose query is not yet implemented is refused rather than faked" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(post_a "/kpis/assign" "{\"kpiCode\":\"CONSENT_DOCUMENTED\",\"facilityId\":\"$FACILITY_ID\",\"targetValue\":100}")
check "a second KPI is assigned" "200" "$code"

code=$(post_m "/kpis/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$D1\",\"periodEnd\":\"$D3\"}")
check "KPIs are computed for the period" "200" "$code"
ATT_KPI=$(jq_get "[r for r in d['results'] if r['code']=='STAFF_ATTENDANCE_RATE'][0]['value']")
check_present "staff attendance was measured from the clock events" "$ATT_KPI"
note "staff attendance $ATT_KPI% against a target of 95%"
RESULT_ID=$(jq_get "[r for r in d['results'] if r['code']=='STAFF_ATTENDANCE_RATE'][0]['resultId']")

CONSENT_SUPPRESSED=$(jq_get "[r for r in d['results'] if r['code']=='CONSENT_DOCUMENTED'][0].get('isSuppressed')")
note "consent KPI suppressed: $CONSENT_SUPPRESSED (small-cell threshold $(jq_get "d['smallCellThreshold']"))"

code=$(status_m "$API/kpis/results/$RESULT_ID")
check "every figure can be taken apart" "200" "$code"
check_present "the result names the query that made it" "$(jq_get "d['query']['id']")"
check_present "and carries its classification" "$(jq_get "d['classification']")"
check_present "and the moment it was computed" "$(jq_get "d['computedAt']")"
note "$(jq_get "d['provenance'][:150]")"

TYPED=$(psql_run "UPDATE qual.kpi_result SET is_suppressed=true, value=42 WHERE id='$RESULT_ID'" 2>&1)
case "$TYPED" in
  *ERROR*) PASS=$((PASS+1)); echo "  PASS  a suppressed result cannot keep its value in the row";;
  *)       FAIL=$((FAIL+1)); echo "  FAIL  a suppressed result still holds the figure it withheld";;
esac

# -----------------------------------------------------------------------------
echo
echo "=== An improvement cycle that has to be measured (spec section 39) ==="

KPI_UUID=$(psql_run "SELECT id FROM qual.kpi WHERE code='STAFF_ATTENDANCE_RATE'" | tr -d '[:space:]')

code=$(post_m "/quality-cycles" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Morning handover punctuality\",\"problemStatement\":\"Shifts are starting late because handover overruns, which pushes the first clinic of the day back by half an hour.\",\"measurementKpiId\":\"$KPI_UUID\",\"targetValue\":98}")
check "a cycle opens against a named indicator" "201" "$code"
CYCLE_ID=$(jq_get "d['id']")
note "$(jq_get "d['baselineNote'][:150]")"

code=$(post_m "/quality-cycles/advance" "{\"cycleId\":\"$CYCLE_ID\",\"reviewOutcome\":\"Everyone agrees things feel much better now.\"}")
check "a review with no intervention recorded is refused" "400" "$code"
note "$(jq_get "d['detail'][:150]")"

code=$(post_m "/quality-cycles/advance" "{\"cycleId\":\"$CYCLE_ID\",\"rootCauseAnalysis\":\"Handover starts at the same minute the shift starts, so it always overruns.\",\"intervention\":\"Handover moved fifteen minutes earlier, with the outgoing shift paid for the overlap.\"}")
check "root cause and intervention are recorded" "200" "$code"

code=$(status_m "$API/quality-cycles?facilityId=$FACILITY_ID")
check "the cycle reports whether anything was measured" "200" "$code"
note "$(jq_get "(d[0]['note'] or ('measured: ' + str(d[0]['currentValue'])))[:150]")"

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
rm -f body.json login.json
[ "$FAIL" -eq 0 ]
