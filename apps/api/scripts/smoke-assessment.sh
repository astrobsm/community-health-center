#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 2 chain, against a RUNNING API and a
# REAL database:
#
#   facility -> evidence -> assessment -> responses -> findings
#            -> readiness score -> submit -> baseline preview -> seal
#            -> immutability -> lifecycle
#
# Two things about the shape of this test are deliberate:
#
#  - Evidence is captured BEFORE the answers that cite it, because that is the
#    order an assessor actually works in, and because ~60 items in the template
#    cannot be submitted without it.
#  - It uses TWO users, because separation of duties is part of the design: the
#    project manager captures, the administrator verifies and seals.
#
# Prerequisites: bash scripts/setup-local-demo.sh, then scripts/run-local.sh.
set -u

API="${API_BASE:-http://127.0.0.1:3100}/api/v1"
PGCONTAINER="${PGCONTAINER:-chc-mig-test}"
PM_EMAIL="${PM_EMAIL:-pm@example.org}"
PM_PASSWORD="${PM_PASSWORD:-correct-horse-battery-staple}"
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

note() { printf '        %s\n' "$1"; }
jq_get() { python -c "import json,sys;d=json.load(open('body.json'));print(eval(sys.argv[1],{'d':d,'json':json}))" "$1" 2>/dev/null; }

status()     { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $PM_TOKEN" "$@"; }
status_adm() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }

echo
echo "=== Sign in as both users ==="
curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PM_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke\"}" "$API/auth/login" >/dev/null
PM_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$PM_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  project manager signed in"; } \
                   || { FAIL=$((FAIL+1)); echo "  FAIL  project manager could not sign in"; }

# The administrator's role requires MFA, so enrol and complete it.
curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke\"}" "$API/auth/login" >/dev/null
ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)

if [ -n "$ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
fi
ADMIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$ADMIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  administrator signed in (MFA enrolled)"; } \
                      || { FAIL=$((FAIL+1)); echo "  FAIL  administrator could not sign in"; }

echo
echo "=== Facility ==="
code=$(status "$API/facilities")
check "the project manager sees their facility" "200" "$code"
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']") at stage $(jq_get "d[0]['lifecycleStage']")"
check "a new facility starts unassessed" "PRE_ASSESSMENT" "$(jq_get "d[0]['lifecycleStage']")"

echo
echo "=== Permissions are enforced per role ==="
code=$(status_adm -X POST -H 'Content-Type: application/json' \
  -d "{\"facilityId\":\"$FACILITY_ID\",\"assessmentType\":\"FIELD\"}" "$API/assessments")
check "the administrator CANNOT create an assessment" "403" "$code"

echo
echo "=== Evidence, captured first ==="
EVIDENCE_ID=$(python -c "import uuid;print(uuid.uuid4())")
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"id\":\"$EVIDENCE_ID\",\"facilityId\":\"$FACILITY_ID\",\"source\":\"OBSERVATION\",\"description\":\"Roof over the labour room; water ingress visible\",\"stage\":\"BEFORE\"}" \
  "$API/evidence")
check "evidence is registered" "201" "$code"
check "it starts as REPORTED, not VERIFIED" "REPORTED" "$(jq_get "d['classification']")"

# Re-sending the same id is the normal case for a retrying field device.
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"id\":\"$EVIDENCE_ID\",\"facilityId\":\"$FACILITY_ID\",\"source\":\"OBSERVATION\",\"description\":\"Roof over the labour room; water ingress visible\",\"stage\":\"BEFORE\"}" \
  "$API/evidence")
check "re-sending the same evidence is idempotent, not an error" "201" "$code"

code=$(status -X POST -H 'Content-Type: application/json' -d '{"verificationNote":"Self-verification attempt"}' \
  "$API/evidence/$EVIDENCE_ID/verify")
check "the capturer CANNOT verify their own evidence" "403" "$code"

code=$(status_adm -X POST -H 'Content-Type: application/json' \
  -d '{"verificationNote":"Inspected the labour room; ingress confirmed."}' \
  "$API/evidence/$EVIDENCE_ID/verify")
check "an independent verifier CAN verify it" "200" "$code"
check "verification promotes it to VERIFIED" "VERIFIED" "$(jq_get "d['classification']")"

echo
echo "=== Create and capture ==="
code=$(status -X POST -H 'Content-Type: application/json' \
  -d "{\"facilityId\":\"$FACILITY_ID\",\"assessmentType\":\"FIELD\",\"title\":\"Baseline field assessment\"}" \
  "$API/assessments")
check "the project manager creates a field assessment" "201" "$code"
ASSESSMENT_ID=$(jq_get "d['id']")

code=$(status "$API/assessments/$ASSESSMENT_ID")
check "the full instrument is returned in one call" "200" "$code"
note "$(jq_get "len(d['sections'])") sections, $(jq_get "sum(len(s['items']) for s in d['sections'])") items"
check "all seventeen sections are present" "17" "$(jq_get "len(d['sections'])")"

EVIDENCE_ID="$EVIDENCE_ID" python - <<'PYEOF'
import json, os, uuid
d = json.load(open('body.json'))
evidence_id = os.environ['EVIDENCE_ID']
responses, evidence_required = [], 0

for section in d['sections']:
    for item in section['items']:
        t = item['responseType']
        if t == 'BOOLEAN':    answer = True
        elif t == 'NUMBER':   answer = 3
        elif t == 'SCALE':    answer = 4
        elif t == 'CURRENCY': answer = 100000
        elif t == 'SELECT':
            answer = ((item.get('options') or {}).get('choices') or ['n/a'])[0]
        elif t == 'MULTISELECT':
            answer = ((item.get('options') or {}).get('choices') or ['n/a'])[:2]
        else:                 answer = 'Observed on site during the field visit.'

        # Items that demand evidence cite the evidence captured above.
        cites = []
        if item['evidenceRequired']:
            cites = [evidence_id]
            evidence_required += 1

        responses.append({
            'id': str(uuid.uuid4()),
            'itemId': item['id'],
            'answer': answer,
            'notApplicable': False,
            'classification': 'VERIFIED',
            'evidenceIds': cites,
        })

for i in range(0, len(responses), 100):
    json.dump({'responses': responses[i:i + 100]}, open(f'batch{i // 100}.json', 'w'))

print(f'{len(responses)} answers, {evidence_required} of which require evidence')
PYEOF

for batch in batch0.json batch1.json batch2.json; do
  [ -f "$batch" ] || continue
  code=$(status -X POST -H 'Content-Type: application/json' --data-binary "@$batch" \
    "$API/assessments/$ASSESSMENT_ID/responses")
  check "a batch of answers is accepted ($batch)" "200" "$code"
done

note "completion $(jq_get "d['progress']['completionPercent']")%, missing evidence $(jq_get "d['progress']['missingEvidence']")"
check "no item is left owing evidence" "0" "$(jq_get "d['progress']['missingEvidence']")"

echo
echo "=== Findings and prioritisation ==="
code=$(status -X POST -H 'Content-Type: application/json' -d "{
  \"facilityId\":\"$FACILITY_ID\",
  \"title\":\"Labour room roof leaks; ward unusable in rain\",
  \"severity\":\"HIGH\",
  \"priorityInputs\":{\"clinicalImportance\":5,\"safetyRisk\":5,\"urgency\":5,\"patientImpact\":5,\"sustainability\":4,\"costBurden\":2},
  \"estimatedCostMinor\":420000000,
  \"evidenceIds\":[\"$EVIDENCE_ID\"]
}" "$API/findings")
check "a finding is raised from evidence" "201" "$code"
check "a severe, urgent finding computes as P1" "P1" "$(jq_get "d['priorityClass']")"
note "priority score $(jq_get "d['priorityScore']")"

code=$(status -X POST -H 'Content-Type: application/json' -d "{
  \"facilityId\":\"$FACILITY_ID\",
  \"title\":\"Additional shelving for the pharmacy store\",
  \"priorityInputs\":{\"clinicalImportance\":1,\"safetyRisk\":0,\"urgency\":1,\"patientImpact\":1,\"sustainability\":2,\"costBurden\":1},
  \"priorityOverride\":\"P1\"
}" "$API/findings")
check "overriding a computed priority WITHOUT a reason is refused" "400" "$code"

code=$(status -X POST -H 'Content-Type: application/json' -d "{
  \"facilityId\":\"$FACILITY_ID\",
  \"title\":\"Additional shelving for the pharmacy store\",
  \"priorityInputs\":{\"clinicalImportance\":1,\"safetyRisk\":0,\"urgency\":1,\"patientImpact\":1,\"sustainability\":2,\"costBurden\":1},
  \"priorityOverride\":\"P1\",
  \"priorityOverrideReason\":\"Chairman has committed to a fixed opening date; store must be ready first.\"
}" "$API/findings")
check "overriding WITH a reason is accepted and recorded" "201" "$code"

echo
echo "=== Facility condition index ==="
code=$(status "$API/assessments/$ASSESSMENT_ID/readiness")
check "the readiness score is computed" "200" "$code"
note "overall $(jq_get "d['overall']")  coverage $(jq_get "d['coverage']")  domains $(jq_get "len(d['domains'])")"

echo
echo "=== Sealing is gated ==="
code=$(status_adm "$API/baselines/preview/$ASSESSMENT_ID")
check "the seal preview is available before committing" "200" "$code"
check "an unsubmitted assessment cannot be sealed" "False" "$(jq_get "d['gate']['canSeal']")"
note "blocker: $(jq_get "d['gate']['blockers'][0]" | head -c 90)"

code=$(status -X POST -H 'Content-Type: application/json' -d '{"acknowledgeIncomplete":false}' \
  "$API/assessments/$ASSESSMENT_ID/submit")
check "the assessment is submitted" "200" "$code"

code=$(status_adm "$API/baselines/preview/$ASSESSMENT_ID")
check "a submitted assessment can be sealed" "True" "$(jq_get "d['gate']['canSeal']")"
note "$(jq_get "d['summary']['metricsDerived']") metrics derived, $(jq_get "d['summary']['gaps']") gap(s) — gaps are reported, never filled in"

echo
echo "=== Seal Day 0 ==="
code=$(status -X POST -H 'Content-Type: application/json' \
  -d '{"label":"Baseline — Day 0","asOfDate":"2026-09-14","confirmIrreversible":true}' \
  "$API/baselines/seal/$ASSESSMENT_ID")
check "the project manager CANNOT seal (separation of duties)" "403" "$code"

code=$(status_adm -X POST -H 'Content-Type: application/json' \
  -d '{"label":"Baseline — Day 0","asOfDate":"2026-09-14","confirmIrreversible":true}' \
  "$API/baselines/seal/$ASSESSMENT_ID")
check "the administrator seals the baseline" "201" "$code"
BASELINE_ID=$(jq_get "d['id']")
note "sequence $(jq_get "d['sequence']"), $(jq_get "d['metricCount']") metrics, hash $(jq_get "d['contentHash']" | head -c 20)..."

code=$(status_adm "$API/baselines/$BASELINE_ID")
check "the sealed baseline reads back" "200" "$code"
check "its content hash verifies on read" "True" "$(jq_get "d['integrity']['intact']")"

code=$(status -X POST -H 'Content-Type: application/json' \
  --data-binary "@batch0.json" "$API/assessments/$ASSESSMENT_ID/responses")
check "a sealed assessment can no longer be edited" "409" "$code"

code=$(status_adm -X PATCH -H 'Content-Type: application/json' -d '{}' "$API/baselines/$BASELINE_ID")
check "modifying a sealed baseline is refused with an explanation" "409" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

echo
echo "=== The database refuses it too, not just the API ==="
RESULT=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "UPDATE assess.baseline_metric SET numeric_value = 999 WHERE metric_code = 'PATIENTS_PER_DAY'" 2>&1)
if echo "$RESULT" | grep -qi "sealed and immutable"; then
  PASS=$((PASS+1)); printf '  PASS  direct SQL cannot alter a sealed metric either\n'
  note "$(echo "$RESULT" | grep -m1 ERROR | cut -c1-95)"
else
  FAIL=$((FAIL+1)); printf '  FAIL  direct SQL was allowed: %s\n' "$RESULT"
fi

echo
echo "=== Lifecycle ==="
code=$(status_adm -X POST -H 'Content-Type: application/json' \
  -d '{"toStage":"PLANNING","reason":"Skipping ahead"}' "$API/facilities/$FACILITY_ID/transition")
check "the lifecycle cannot skip stages" "400" "$code"

code=$(status_adm -X POST -H 'Content-Type: application/json' \
  -d '{"toStage":"DUE_DILIGENCE","reason":"Pre-assessment complete"}' "$API/facilities/$FACILITY_ID/transition")
check "advancing without a submitted pre-assessment is refused" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 90)"

echo
echo "=== Audit ==="
AUDIT=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "SELECT action FROM audit.audit_log WHERE action LIKE 'assessment%' OR action LIKE 'evidence%' OR action LIKE 'baseline%' GROUP BY action ORDER BY action" 2>/dev/null)
echo "$AUDIT" | sed 's/^/        /'
for expected in "assessment.create" "assessment.submit" "evidence.verify" "baseline.seal"; do
  if echo "$AUDIT" | grep -q "^$expected$"; then
    PASS=$((PASS+1)); printf '  PASS  audited: %s\n' "$expected"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  not audited: %s\n' "$expected"
  fi
done

rm -f body.json login.json batch*.json

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
