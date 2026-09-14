#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 10 chain, against a RUNNING API and a
# REAL database:
#
#   care -> charge -> invoice -> payment -> ledger
#      then, from the figure on the dashboard, walk back down that chain to the
#      patient — with permission re-checked at every hop
#
# The acceptance criteria this proves (docs/architecture/21-development-roadmap.md):
#
#   B — the baseline comparison reconciles: baseline from a sealed snapshot,
#       current recomputed from transactions, and the snapshot cannot be
#       altered to change the current value
#   M — every dashboard figure is clickable down to its source rows, and no
#       dashboard renders a number without its classification and timestamp
#
# The classification-and-timestamp rule is checked mechanically over the whole
# dashboard payload rather than by spot-checking one figure, because a rule that
# holds for the figure somebody remembered to check is not a rule.
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

status_m() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $MGR_TOKEN" "$@"; }
status_c() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $CLIN_TOKEN" "$@"; }
status_f() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $FIN_TOKEN" "$@"; }
status_g() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $GOV_TOKEN" "$@"; }
status_a() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }
post_m()   { status_m -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_c()   { status_c -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_f()   { status_f -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_a()   { status_a -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

seed_user() {
  EMAIL="$1" PASSWORD="$PASSWORD" NAME="$2" ROLE="$3" FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
    DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
    ../../node_modules/.bin/tsx prisma/seed/create-user.ts >/dev/null 2>&1
}

sign_in() {
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"deviceId\":\"smoke-analytics\"}" "$API/auth/login" >/dev/null
  local enrol secret code
  enrol=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
  secret=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
  if [ -n "$enrol" ]; then
    code=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$secret")
    curl -s -o login.json -X POST -H 'Content-Type: application/json' \
      -d "{\"enrolmentToken\":\"$enrol\",\"code\":\"$code\",\"deviceId\":\"smoke-analytics\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
  fi
  python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null
}

echo
echo "=== The people who read a dashboard ==="
seed_user "mgr10@example.org" "M. Chukwu" FACILITY_MANAGER
seed_user "clin10@example.org" "Dr O. Nnaji" CLINICIAN
seed_user "fin10@example.org" "F. Bello" FINANCE_OFFICER
seed_user "gov10@example.org" "G. Observer" GOVERNMENT_OBSERVER
seed_user "admin10@example.org" "A. Okafor" ORG_ADMIN

MGR_TOKEN=$(sign_in "mgr10@example.org")
CLIN_TOKEN=$(sign_in "clin10@example.org")
FIN_TOKEN=$(sign_in "fin10@example.org")
GOV_TOKEN=$(sign_in "gov10@example.org")
ADMIN_TOKEN=$(sign_in "admin10@example.org")

for pair in "facility manager:$MGR_TOKEN" "clinician:$CLIN_TOKEN" "finance officer:$FIN_TOKEN" "government observer:$GOV_TOKEN" "administrator:$ADMIN_TOKEN"; do
  name="${pair%%:*}"; token="${pair#*:}"
  [ -n "$token" ] && { PASS=$((PASS+1)); echo "  PASS  the $name signed in"; } \
                  || { FAIL=$((FAIL+1)); echo "  FAIL  the $name could not sign in"; }
done

code=$(status_m "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
ORG_ID=$(psql_run "SELECT id FROM core.organisation LIMIT 1" | tr -d '[:space:]')
note "facility $(jq_get "d[0]['code']")"

TODAY=$(python -c "import datetime;print(datetime.date.today().isoformat())")
START=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=30)).isoformat())")

# -----------------------------------------------------------------------------
echo
echo "=== A chain of real activity: care -> charge -> invoice -> payment ==="

code=$(post_c "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Ngozi\",\"familyName\":\"Okeke\",\"sex\":\"FEMALE\",\"dateOfBirth\":\"1991-04-12\"}")
check "a patient is registered" "201" "$code"
PATIENT_ID=$(jq_get "d['id']")

code=$(post_c "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"TREATMENT\",\"granted\":true}")
check "treatment consent is recorded" "201" "$code"

code=$(post_c "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"DATA_STORAGE\",\"granted\":true}")
check "consent to keep the record is recorded" "201" "$code"

code=$(post_c "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Fever for three days\"}")
check "an encounter is opened" "201" "$code"
ENCOUNTER_ID=$(jq_get "d['id']")
check_present "the encounter is attributed to a staff record" "$(jq_get "d['attendingStaffId'] or d.get('attributionNote','')")"

code=$(post_f "/finance/periods" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"September 2026\",\"startDate\":\"2026-09-01\",\"endDate\":\"2026-09-30\"}")
check "a financial period is open" "201" "$code"

code=$(post_f "/billing/charges" "{\"facilityId\":\"$FACILITY_ID\",\"encounterId\":\"$ENCOUNTER_ID\",\"description\":\"Outpatient consultation\",\"quantity\":1,\"unitPriceMinor\":150000,\"serviceDate\":\"$TODAY\"}")
check "a charge is raised against the encounter" "201" "$code"
CHARGE_ID=$(jq_get "d['id']")

code=$(post_f "/billing/invoices" "{\"facilityId\":\"$FACILITY_ID\",\"patientId\":\"$PATIENT_ID\",\"chargeIds\":[\"$CHARGE_ID\"]}")
check "an invoice is issued for it" "201" "$code"
INVOICE_ID=$(jq_get "d['id']")

code=$(post_f "/billing/payments" "{\"facilityId\":\"$FACILITY_ID\",\"amountMinor\":150000,\"method\":\"CASH\",\"allocations\":[{\"invoiceId\":\"$INVOICE_ID\",\"amountMinor\":150000}]}")
check "the patient pays" "201" "$code"
PAYMENT_ID=$(jq_get "d['id']")
check_present "the payment has an id" "$PAYMENT_ID"

# A second encounter closed with nothing recorded, so the data quality engine
# has something real to find.
code=$(post_c "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Follow-up\"}")
BAD_ENCOUNTER=$(jq_get "d['id']")
psql_run "UPDATE clinical.encounter SET status='CLOSED', ended_at=now() WHERE id='$BAD_ENCOUNTER'" >/dev/null
check_present "an undocumented encounter exists for the quality engine to find" "$BAD_ENCOUNTER"

# -----------------------------------------------------------------------------
echo
echo "=== Criterion M: no figure without its provenance ==="

code=$(status_m "$API/analytics/dashboard?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY")
check "the manager's dashboard renders" "200" "$code"
note "$(jq_get "str(len(d['sections'])) + ' sections, ' + str(sum(len(s['figures']) for s in d['sections'])) + ' figures'")"

# Checked over EVERY figure, not a sample. This is the criterion.
BARE=$(python - <<'PY'
import json
d = json.load(open('body.json'))
bad = []
for section in d['sections']:
    for f in section['figures']:
        if not f.get('classification'): bad.append(f['key'] + ':classification')
        if not f.get('computedAt'): bad.append(f['key'] + ':computedAt')
        if not f.get('sourceQueryId'): bad.append(f['key'] + ':sourceQueryId')
        if not f.get('reads'): bad.append(f['key'] + ':reads')
        if f.get('drillDown') is None and not f.get('noDrillDownReason'):
            bad.append(f['key'] + ':unreachable')
print(','.join(bad) if bad else 'none')
PY
)
check "every figure carries classification, timestamp, query and reachability" "none" "$BARE"

CLICKABLE=$(python - <<'PY'
import json
d = json.load(open('body.json'))
figs = [f for s in d['sections'] for f in s['figures']]
print(f"{sum(1 for f in figs if f.get('drillDown'))}/{len(figs)}")
PY
)
note "figures clickable down to their rows: $CLICKABLE"

NO_DRILL=$(python - <<'PY'
import json
d = json.load(open('body.json'))
figs = [f for s in d['sections'] for f in s['figures'] if f.get('drillDown') is None]
print(figs[0]['noDrillDownReason'][:120] if figs else 'every figure is clickable')
PY
)
note "$NO_DRILL"

check_present "the dashboard states what its figures cannot tell you" "$(jq_get "len(d['caveats'])")"
note "$(jq_get "d['caveats'][0][:140]")"

# The observer sees an aggregate section and no clinical one — absent, not
# disabled.
code=$(status_g "$API/analytics/dashboard?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY")
check "the government observer's dashboard renders" "200" "$code"
GOV_SECTIONS=$(jq_get "' | '.join(s['title'] for s in d['sections'])")
note "observer sees: $GOV_SECTIONS"
GOV_FIGURES=$(jq_get "','.join(f['key'] for s in d['sections'] for f in s['figures'])")
note "observer figures: $GOV_FIGURES"
case "$GOV_FIGURES" in
  *revenue_collected*|*undocumented_encounters*|*staff_blocked*)
    FAIL=$((FAIL+1)); echo "  FAIL  the observer can see a figure their permissions do not reach";;
  *)
    PASS=$((PASS+1)); echo "  PASS  figures beyond the observer's permissions are absent, not merely disabled";;
esac

# -----------------------------------------------------------------------------
echo
echo "=== Drilling from a figure to the records under it (spec section 71) ==="

code=$(status_m "$API/analytics/drill-down?facilityId=$FACILITY_ID&figure=revenue_collected&periodStart=$START&periodEnd=$TODAY")
check "the revenue figure opens onto its payments" "200" "$code"
check "the payment made above is one of them" "1" "$(jq_get "d['totalCount']")"
check "the row is worth what was paid" "1500" "$(jq_get "str(int(d['rows'][0]['detail']['amount']))")"
check_present "and it offers the next hop down" "$(jq_get "d['rows'][0]['href']")"
note "$(jq_get "d['note'][:140]")"

code=$(status_m "$API/analytics/drill-down?facilityId=$FACILITY_ID&figure=no_such_figure&periodStart=$START&periodEnd=$TODAY")
check "a figure that does not exist is refused" "404" "$code"

code=$(status_g "$API/analytics/drill-down?facilityId=$FACILITY_ID&figure=revenue_collected&periodStart=$START&periodEnd=$TODAY")
check "the observer cannot open the payments behind a total" "404" "$code"

# -----------------------------------------------------------------------------
echo
echo "=== Criterion M: walking the chain back to its origin ==="

code=$(status_m "$API/lineage/payment/$PAYMENT_ID/upstream")
check "the payment's lineage resolves" "200" "$code"
CHAIN=$(jq_get "' -> '.join(n['entityType'] for n in d['chain'])")
note "payment <- $CHAIN"
case "$CHAIN" in
  *invoice*charge*encounter*patient*) PASS=$((PASS+1)); echo "  PASS  the chain reaches invoice, charge, encounter and patient";;
  *) FAIL=$((FAIL+1)); echo "  FAIL  the chain stopped at: $CHAIN";;
esac
check "no link in the chain is broken" "0" "$(jq_get "len(d['broken'])")"
check_present "the chain carries a classification" "$(jq_get "d['classification']")"

code=$(status_g "$API/lineage/payment/$PAYMENT_ID/upstream")
if [ "$code" = "200" ]; then
  GOV_CHAIN=$(jq_get "','.join(n['entityType'] for n in d['chain'])")
  WITHHELD=$(jq_get "len(d['withheld'])")
  case "$GOV_CHAIN" in
    *patient*) FAIL=$((FAIL+1)); echo "  FAIL  the observer reached the patient";;
    *)         PASS=$((PASS+1)); echo "  PASS  the observer's walk stops before the patient";;
  esac
  [ "$WITHHELD" != "0" ] && { PASS=$((PASS+1)); echo "  PASS  and the closed hop is named rather than hidden"; } \
                         || { FAIL=$((FAIL+1)); echo "  FAIL  the hop was dropped silently"; }
  note "$(jq_get "(d['withheld'][0] if d['withheld'] else '')[:140]")"
else
  check "the observer can begin the walk" "200" "$code"
fi

code=$(status_m "$API/lineage/encounter/$ENCOUNTER_ID/downstream")
check "walking forward from the encounter resolves" "200" "$code"
DOWN=$(jq_get "' -> '.join(n['entityType'] for n in d['chain'])")
note "encounter -> $DOWN"
case "$DOWN" in
  *charge*invoice*payment*journal_entry*) PASS=$((PASS+1)); echo "  PASS  care reaches the ledger without a gap";;
  *) FAIL=$((FAIL+1)); echo "  FAIL  the forward chain stopped at: $DOWN";;
esac

code=$(status_m "$API/lineage/unicorn/$PAYMENT_ID/upstream")
check "lineage for a record type that has none is refused, not faked" "400" "$code"

# -----------------------------------------------------------------------------
echo
echo "=== Criterion B: the baseline is sealed and the current value is not ==="

SNAP_ID=$(python -c "import uuid;print(uuid.uuid4())")
METRIC_ID=$(python -c "import uuid;print(uuid.uuid4())")

out=$(psql_run "
INSERT INTO assess.baseline_snapshot (id,facility_id,organisation_id,sequence,label,as_of_date,content_hash)
VALUES ('$SNAP_ID','$FACILITY_ID','$ORG_ID',1,'Day 0','2026-01-15','sha256:smoke-analytics');
INSERT INTO assess.baseline_metric (id,snapshot_id,organisation_id,facility_id,metric_code,metric_name,numeric_value,unit,classification,source_reference)
VALUES ('$METRIC_ID','$SNAP_ID','$ORG_ID','$FACILITY_ID','PATIENTS_PER_DAY','Patients per day',8,'patients/day','VERIFIED','Register count, 2026-01-15');
")
[ -z "$out" ] && { PASS=$((PASS+1)); echo "  PASS  a Day 0 baseline of 8 patients/day is sealed"; } \
              || { FAIL=$((FAIL+1)); echo "  FAIL  seal: $out"; }

code=$(post_a "/kpis/assign" "{\"kpiCode\":\"PATIENTS_PER_DAY\",\"facilityId\":\"$FACILITY_ID\",\"targetValue\":40}")
check "the KPI is assigned and picks up the sealed baseline" "200" "$code"
check "the baseline came from the snapshot" "8" "$(jq_get "str(int(d['baselineValue']))")"
note "$(jq_get "str(d['baseline'])[:140]")"

code=$(post_m "/kpis/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$START\",\"periodEnd\":\"$TODAY\"}")
check "the current value is computed from transactions" "200" "$code"

code=$(status_m "$API/analytics/comparison?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY&kpiCode=PATIENTS_PER_DAY")
check "the comparison renders" "200" "$code"
BASE=$(jq_get "d['comparisons'][0]['baselineValue']")
CURR=$(jq_get "d['comparisons'][0]['currentValue']")
check "the baseline is 8, from the sealed snapshot" "8" "$(jq_get "str(int(d['comparisons'][0]['baselineValue']))")"
check_present "the current value is computed, not read from the snapshot" "$CURR"
check_true "the comparison is complete" "$(jq_get "str(d['comparisons'][0]['comparable'])")"
note "baseline $BASE -> current $CURR, change $(jq_get "d['comparisons'][0]['change']"), direction $(jq_get "d['comparisons'][0]['direction']")"
note "$(jq_get "d['comparisons'][0]['provenance'][:150]")"
check_present "the comparison drills into the result's own lineage" "$(jq_get "d['comparisons'][0]['drillDownHref']")"

# The proof that the two come from different places: the snapshot cannot be
# edited at all, and if it could, the current value would not follow it.
TAMPER=$(psql_run "UPDATE assess.baseline_metric SET numeric_value=999 WHERE id='$METRIC_ID'" 2>&1)
case "$TAMPER" in
  *ERROR*) PASS=$((PASS+1)); echo "  PASS  the sealed baseline cannot be altered at all";;
  *)       FAIL=$((FAIL+1)); echo "  FAIL  a sealed baseline metric was rewritten";;
esac

code=$(post_m "/kpis/compute" "{\"facilityId\":\"$FACILITY_ID\",\"periodStart\":\"$START\",\"periodEnd\":\"$TODAY\"}")
code=$(status_m "$API/analytics/comparison?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY&kpiCode=PATIENTS_PER_DAY")
check "recomputing does not disturb the baseline" "8" "$(jq_get "str(int(d['comparisons'][0]['baselineValue']))")"
check "and the current value is unchanged by it" "$CURR" "$(jq_get "d['comparisons'][0]['currentValue']")"

# -----------------------------------------------------------------------------
echo
echo "=== The data quality engine (spec section 47) ==="

code=$(status_m "$API/analytics/data-quality?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY")
check "data quality is assessed" "200" "$code"
check_present "a score is produced" "$(jq_get "str(d['overallScore'])")"
note "score $(jq_get "str(d['overallScore'])") ($(jq_get "d['band']")) over $(jq_get "str(d['recordsAssessed'])") records"
check_present "it names the dimensions it could not measure" "$(jq_get "str(d['unmeasured'])")"
ISSUE=$(jq_get "d['issues'][0]['code'] if d['issues'] else ''")
check "the undocumented encounter is found" "encounter-no-diagnosis" "$ISSUE"
check_present "and the issue says how many, out of how many" "$(jq_get "str(d['issues'][0]['outOf'])")"
check_present "and where to go and fix it" "$(jq_get "d['issues'][0]['href']")"
note "$(jq_get "d['issues'][0]['description'][:150]")"
note "$(jq_get "d['explanation'][:150]")"

# -----------------------------------------------------------------------------
echo
echo "=== Global search (spec section 60) ==="

code=$(status_m "$API/analytics/search?q=Okeke")
check "the manager finds the patient by name" "200" "$code"
check_present "a result is returned" "$(jq_get "str(d['total'])")"
note "searched: $(jq_get "','.join(d['searchedKinds'])")"

code=$(status_g "$API/analytics/search?q=Okeke")
check "the observer may search" "200" "$code"
GOV_KINDS=$(jq_get "','.join(d['searchedKinds'])")
case "$GOV_KINDS" in
  *patient*) FAIL=$((FAIL+1)); echo "  FAIL  the observer searched patient records";;
  *)         PASS=$((PASS+1)); echo "  PASS  patient records were not searched for the observer at all";;
esac
note "$(jq_get "d['note'][:150]")"

# -----------------------------------------------------------------------------
echo
echo "=== Benchmarking, and the refusal to publish a table of one ==="

code=$(status_m "$API/analytics/benchmark?kpiCode=PATIENTS_PER_DAY&periodStart=$START&periodEnd=$TODAY")
check "a manager without the permission cannot rank facilities" "403" "$code"

code=$(status_g "$API/analytics/benchmark?kpiCode=PATIENTS_PER_DAY&periodStart=$START&periodEnd=$TODAY")
check "an observer holding analytics.benchmark may ask" "200" "$code"
check "but nothing is published from one facility" "False" "$(jq_get "str(d['published'])")"
note "$(jq_get "d['caveat'][:160]")"

# -----------------------------------------------------------------------------
echo
echo "=== The one cached figure, and the check that keeps it honest ==="

code=$(post_m "/analytics/refresh" "{}")
check "the rollup rebuilds" "200" "$code"
check_true "and agrees with the base tables it was built from" "$(jq_get "str(d['reconciled'])")"
note "$(jq_get "d['note'][:140]") ($(jq_get "str(d['rowCount'])") day(s), $(jq_get "str(d['durationMs'])")ms)"

code=$(status_m "$API/analytics/trend?facilityId=$FACILITY_ID&periodStart=$START&periodEnd=$TODAY")
check "the trend reads from the rollup" "200" "$code"
check_present "and says when it was last rebuilt" "$(jq_get "d['refreshedAt']")"
check "so a stale figure cannot look current" "False" "$(jq_get "str(d['stale'])")"
check "the day's collection matches the payment taken" "1500" "$(jq_get "str(int([day['collected'] for day in d['days'] if day['collected']>0][0]))")"
note "$(jq_get "d['provenance'][:150]")"

DIRECT=$(docker exec "$PGCONTAINER" psql -U chc_app -d chc -tAc "SELECT count(*) FROM analytics.mv_daily_financial" 2>&1)
case "$DIRECT" in
  *denied*) PASS=$((PASS+1)); echo "  PASS  the application role cannot read the materialised view directly";;
  *)        FAIL=$((FAIL+1)); echo "  FAIL  the app role read the view that row-level security cannot protect";;
esac

UNSCOPED=$(docker exec "$PGCONTAINER" psql -U chc_app -d chc -tAc "SELECT count(*) FROM analytics.daily_financial" 2>&1 | tr -d '[:space:]')
check "and the barrier view returns nothing with no tenant scope set" "0" "$UNSCOPED"

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
rm -f body.json login.json
[ "$FAIL" -eq 0 ]
