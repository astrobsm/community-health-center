#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 3 chain, against a RUNNING API and a
# REAL database:
#
#   finding -> need -> recommendation -> capex line -> approval
#           -> financial model -> 60 projected periods -> sensitivity
#           -> change impact -> approve -> locked (423) -> unlock -> new version
#
# The acceptance criterion this proves (docs/architecture/21-development-roadmap.md):
#
#   "findings become needs become recommendations become capex lines; a model
#    produces 60 periods with break-even and payback; changing a locked
#    assumption is blocked until unlocked and shows a full impact preview
#    before it is applied."
#
# Two users again, because separation of duties is the point: the project
# manager builds the plan and the model, the administrator approves them and is
# the only one who can unlock an approved model.
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

check_true() {
  local name="$1" actual="$2"
  if [ "$actual" = "True" ] || [ "$actual" = "true" ]; then
    PASS=$((PASS + 1)); printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  %s (got %s)\n' "$name" "$actual"
  fi
}

note() { printf '        %s\n' "$1"; }
jq_get() { python -c "import json,sys;d=json.load(open('body.json'));print(eval(sys.argv[1],{'d':d,'json':json}))" "$1" 2>/dev/null; }

status()     { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $PM_TOKEN" "$@"; }
status_adm() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }

post()     { status -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_adm() { status_adm -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

echo
echo "=== Sign in as both users ==="
curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PM_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-plan\"}" "$API/auth/login" >/dev/null
PM_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$PM_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  project manager signed in"; } \
                   || { FAIL=$((FAIL+1)); echo "  FAIL  project manager could not sign in"; }

curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke-plan\"}" "$API/auth/login" >/dev/null
ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
CHALLENGE=$(python -c "import json;print(json.load(open('login.json')).get('mfaToken',''))" 2>/dev/null)

if [ -n "$ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke-plan\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
elif [ -n "$CHALLENGE" ]; then
  # Already enrolled by an earlier smoke run: read the stored secret and answer
  # the challenge. Reading it from the database is acceptable in a local demo
  # and nowhere else.
  SECRET=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
    "SELECT mfa_secret FROM core.app_user WHERE email='$ADMIN_EMAIL'" 2>/dev/null | tr -d '[:space:]')
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"mfaToken\":\"$CHALLENGE\",\"code\":\"$CODE\",\"deviceId\":\"smoke-plan\"}" "$API/auth/mfa/verify" >/dev/null
fi
ADMIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$ADMIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  administrator signed in"; } \
                      || { FAIL=$((FAIL+1)); echo "  FAIL  administrator could not sign in"; }

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== A finding, which is where every need must come from ==="
code=$(post "/findings" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Labour room roof leaks over the delivery bed\",\"severity\":\"HIGH\",\"description\":\"Water ingress observed during rain; ceiling stained across two metres.\"}")
check "a finding is recorded" "201" "$code"
FINDING_ID=$(jq_get "d['id']")
FINDING_REF=$(jq_get "d['reference']")
FINDING_PRIORITY=$(jq_get "d['priorityClass']")
note "$FINDING_REF at $FINDING_PRIORITY"

echo
echo "=== Needs: evidenced, or explained ==="
code=$(post "/needs" "{\"facilityId\":\"$FACILITY_ID\",\"findingId\":\"$FINDING_ID\",\"title\":\"Weatherproof the labour room\"}")
check "a need derived from a finding is accepted" "201" "$code"
NEED_ID=$(jq_get "d['id']")
note "$(jq_get "d['reference']")"

code=$(post "/needs" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Something we simply want\"}")
check "a need with no finding and no reason is refused" "400" "$code"
note "$(jq_get "d.get('detail', d.get('message',''))" | head -c 100)"

code=$(post "/needs" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Fire extinguisher servicing\",\"unlinkedReason\":\"Required by the state fire service inspection letter of 12 August.\"}")
check "a need with a stated reason is accepted" "201" "$code"

echo
echo "=== Recommendations inherit the priority that was computed, not re-guessed ==="
code=$(post "/recommendations" "{\"needId\":\"$NEED_ID\",\"title\":\"Replace roof sheets and ceiling over the labour room\",\"expectedOutcome\":\"Deliveries can continue during the rains\"}")
check "a recommendation is created" "201" "$code"
RECOMMENDATION_ID=$(jq_get "d['id']")
check "it inherits the finding's priority class" "$FINDING_PRIORITY" "$(jq_get "d['priorityClass']")"

echo
echo "=== CAPEX ==="
code=$(post "/capex-plans" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Revitalisation phase 1\"}")
check "a CAPEX plan is created" "201" "$code"
PLAN_ID=$(jq_get "d['id']")

code=$(post "/capex-plans/lines" "{\"capexPlanId\":\"$PLAN_ID\",\"recommendationId\":\"$RECOMMENDATION_ID\",\"category\":\"BUILDING\",\"description\":\"Roof sheets and ceiling, labour room\",\"quantity\":1,\"unit\":\"job\",\"unitCostMinor\":180000000,\"priorityClass\":\"P1\",\"costBasis\":\"Quotation from Ikem Roofing, 2 September 2026\"}")
check "a costed line is added" "201" "$code"
LINE_ID=$(jq_get "d['id']")
check "an estimate is labelled ESTIMATED, not presented as a price" "ESTIMATED" "$(jq_get "d['classification']")"

code=$(status "$API/capex-plans/$PLAN_ID")
check "the plan reads back" "200" "$code"
check "the total is computed from the lines" "180000000" "$(jq_get "d['totals']['estimatedMinor']")"
check "nothing is approved yet" "0" "$(jq_get "d['totals']['approvedLineCount']")"
check_true "every line traces to a finding" "$(jq_get "d['traceability']['fullyTraced']")"
note "trace: $(jq_get "d['lines'][0]['traceability']['finding']") -> $(jq_get "d['lines'][0]['traceability']['need']") -> $(jq_get "d['lines'][0]['traceability']['recommendation']")"

echo
echo "=== Approval is somebody else's job ==="
code=$(post "/capex-plans/lines/$LINE_ID/approve" '{"approvedCostMinor":180000000}')
check "the estimator cannot approve their own line" "403" "$code"

code=$(post_adm "/capex-plans/lines/$LINE_ID/approve" '{"approvedCostMinor":150000000}')
check "approving at a different figure without a reason is refused" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

code=$(post_adm "/capex-plans/lines/$LINE_ID/approve" '{"approvedCostMinor":150000000,"reason":"Negotiated down after a second quotation from Enugu Roofing."}')
check "the administrator approves it with a reason" "200" "$code"
check "an approved figure is no longer merely an estimate" "VERIFIED" "$(jq_get "d['classification']")"

echo
echo "=== The five-year model ==="
# A facility that opens under-used and grows into its costs: loss-making at
# first, so break-even and payback are real events rather than month one.
ASSUMPTIONS='{"patientsPerDay":20,"operatingDaysPerMonth":24,"serviceLines":[{"code":"CONS","name":"Consultation","share":0.55,"tariffMinor":150000,"variableCostRatio":0.05},{"code":"PHARM","name":"Pharmacy","share":0.3,"tariffMinor":250000,"variableCostRatio":0.62},{"code":"LAB","name":"Laboratory","share":0.15,"tariffMinor":300000,"variableCostRatio":0.4}],"annualGrowthRate":0.35,"annualInflationRate":0.1,"fixedMonthlyCostMinor":22000000,"staffMonthlyCostMinor":40000000,"incentivePoolRate":0.1,"collectionRate":0.92,"collectionLagDays":30,"capexSchedule":[{"periodIndex":0,"amountMinor":260000000,"label":"Phase 1 works"}],"workingCapitalMinor":120000000,"openingCashMinor":0,"depreciationYears":10}'

code=$(post "/financial-models" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Five-year model\",\"startDate\":\"2026-10-01\",\"assumptions\":$ASSUMPTIONS}")
check "the project manager can build a model" "201" "$code"
MODEL_ID=$(jq_get "d['id']")

code=$(post "/financial-models/$MODEL_ID/scenarios/BASE/compute" '{}')
check "the base scenario computes" "200" "$code"
check "it produces sixty monthly periods" "60" "$(jq_get "d['summary']['periods']")"
check "it finds the month the facility starts covering its costs" "21" "$(jq_get "d['summary']['breakEvenPeriod']")"
check "and the month the investment is recovered" "46" "$(jq_get "d['summary']['paybackPeriod']")"
note "working capital required: $(jq_get "d['summary']['requiredWorkingCapitalMinor']") kobo, lowest at month $(jq_get "d['summary']['lowestCashPeriod']")"
check "every figure is labelled PROJECTED" "PROJECTED" "$(jq_get "d['summary']['classification']")"

code=$(post "/financial-models/$MODEL_ID/scenarios/STRESS/compute" '{"overrides":{"patientsPerDay":14,"collectionRate":0.7}}')
check "a stress scenario computes from its own assumptions" "200" "$code"
check "a case that never breaks even says None, not a fabricated month" "None" "$(jq_get "d['summary']['breakEvenPeriod']")"
check "and reports no payback either" "None" "$(jq_get "d['summary']['paybackPeriod']")"

code=$(status "$API/financial-models/$MODEL_ID/scenarios/BASE")
check "the stored periods read back" "200" "$code"
check "sixty of them" "60" "$(jq_get "len(d['periods'])")"
check "and they are not stale" "False" "$(jq_get "d['stale']")"

code=$(status "$API/financial-models/$MODEL_ID/sensitivity")
check "sensitivity runs" "200" "$code"
check "six variations for each of seven drivers" "42" "$(jq_get "len(d['entries'])")"
note "most sensitive: $(jq_get "', '.join(d['mostSensitiveDrivers'][:3])")"

echo
echo "=== Change impact, before anything is written (spec section 72) ==="
code=$(post "/financial-models/$MODEL_ID/assumptions/serviceLine.CONS.tariffMinor/preview" '{"value":200000}')
check "a preview is produced" "200" "$code"
check "it does not require an unlock while the model is a draft" "False" "$(jq_get "d['requiresUnlock']")"
note "$(jq_get "' | '.join(f\"{i['label']}: {i['before']} -> {i['after']}\" for i in d['impacts'][:3])")"

code=$(post "/financial-models/$MODEL_ID/assumptions/serviceLine.CONS.tariffMinor" '{"value":200000,"reason":"Tariff revised by the LGA health committee on 1 October.","confirmImpact":true}')
check "the change applies to a draft model" "200" "$code"
check_true "and the scenarios are flagged for recompute" "$(jq_get "d['recomputeRequired']")"

code=$(status "$API/financial-models/$MODEL_ID/scenarios/BASE")
check_true "the stored scenario now reads as stale" "$(jq_get "d['stale']")"
note "changed since it was computed: $(jq_get "', '.join(d['changedSince'])")"

code=$(post "/financial-models/$MODEL_ID/scenarios/BASE/compute" '{}')
check "recomputing clears it" "200" "$code"

echo
echo "=== Approval locks the model ==="
code=$(post "/financial-models/$MODEL_ID/approve" '{"note":"Reviewed with the LGA health committee."}')
check "the modeller cannot approve their own model" "403" "$code"

code=$(post_adm "/financial-models/$MODEL_ID/approve" '{"note":"Reviewed with the LGA health committee."}')
check "the administrator approves it" "200" "$code"
note "locked $(jq_get "d['lockedAssumptions']") assumptions"

code=$(post "/financial-models/$MODEL_ID/assumptions/serviceLine.CONS.tariffMinor" '{"value":260000,"reason":"Trying to slip a change past the approval.","confirmImpact":true}')
check "changing a locked assumption is refused with 423 Locked" "423" "$code"
check_true "and identifies the rule, RFC 9457 style" "$(jq_get "d['type'].endswith('model-locked')")"
note "$(jq_get "d['detail']" | head -c 120)"

code=$(post "/financial-models/$MODEL_ID/assumptions/serviceLine.CONS.tariffMinor/preview" '{"value":260000}')
check "the impact can still be previewed on an approved model" "200" "$code"
check_true "and it says an unlock would be required" "$(jq_get "d['requiresUnlock']")"

echo
echo "=== Unlocking supersedes rather than overwrites ==="
code=$(post "/financial-models/$MODEL_ID/unlock" '{"reason":"Tariff schedule revised by the state after approval."}')
check "the project manager cannot unlock" "403" "$code"

code=$(post_adm "/financial-models/$MODEL_ID/unlock" '{"reason":"Tariff schedule revised by the state after approval."}')
check "the administrator can" "200" "$code"
NEW_MODEL_ID=$(jq_get "d['workingVersion']['id']")
check "the approved version is superseded, not edited" "SUPERSEDED" "$(jq_get "d['superseded']['status']")"
check "and a new working version is opened" "2" "$(jq_get "d['workingVersion']['versionNumber']")"

code=$(status "$API/financial-models/$MODEL_ID")
check "the approved version is still readable" "200" "$code"
check "with its assumptions still locked" "True" "$(jq_get "all(a['isLocked'] for a in d['assumptions'])")"

code=$(post "/financial-models/$NEW_MODEL_ID/assumptions/serviceLine.CONS.tariffMinor" '{"value":260000,"reason":"Tariff schedule revised by the state on 1 November.","confirmImpact":true}')
check "the change applies in the new version" "200" "$code"

# Authorship carried over from v1, so the administrator who unlocked it can
# still approve it — otherwise a single-administrator organisation could never
# re-approve anything.
code=$(post_adm "/financial-models/$NEW_MODEL_ID/approve" '{}')
check "a new version cannot be approved before it is recomputed" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 110)"

echo
echo "=== Risk register ==="
code=$(post "/risks" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Roofing contractor unavailable before the rains\",\"likelihood\":4,\"impact\":4,\"category\":\"DELIVERY\",\"mitigation\":\"Two contractors pre-qualified; works scheduled for the dry season.\"}")
check "a risk is registered" "201" "$code"
check "the score is likelihood x impact" "16" "$(jq_get "d['riskScore']")"
check "banded for the register" "EXTREME" "$(jq_get "d['band']")"

code=$(post "/risks" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Government counterpart funding delayed\",\"likelihood\":3,\"impact\":5}")
check "a risk with no mitigation is still accepted" "201" "$code"

code=$(status "$API/risks?facilityId=$FACILITY_ID")
check "the register reads back highest first" "200" "$code"
check_true "an unmitigated risk is called out rather than left blank" "$(jq_get "any(r['unmitigated'] for r in d)")"

echo
echo "=== Compliance register (spec section 83) ==="
code=$(status "$API/compliance?facilityId=$FACILITY_ID")
check "the register reads" "200" "$code"
check_true "and carries its disclaimer" "$(jq_get "'PROFESSIONAL REVIEW' in d['disclaimer']")"

echo
echo "=== Audit ==="
AUDIT=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "SELECT action FROM audit.audit_log WHERE action LIKE 'planning%' OR action LIKE 'financial_model%' GROUP BY action ORDER BY action" 2>/dev/null)
echo "$AUDIT" | sed 's/^/        /'
for expected in "planning.need.create" "planning.capex_line.approve" "financial_model.approve" "financial_model.unlock" "financial_model.assumption.change"; do
  if echo "$AUDIT" | grep -q "^$expected$"; then
    PASS=$((PASS+1)); printf '  PASS  audited: %s\n' "$expected"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  not audited: %s\n' "$expected"
  fi
done

REASON=$(docker exec "$PGCONTAINER" psql -U chc_migrator -d chc -tAq -c \
  "SELECT reason FROM audit.audit_log WHERE action='financial_model.unlock' AND reason IS NOT NULL ORDER BY occurred_at DESC LIMIT 1" 2>/dev/null | tr -d '\r')
if [ -n "$REASON" ]; then
  PASS=$((PASS+1)); printf '  PASS  the unlock recorded why\n'; note "$REASON"
else
  FAIL=$((FAIL+1)); printf '  FAIL  the unlock recorded no reason\n'
fi

rm -f body.json login.json

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
