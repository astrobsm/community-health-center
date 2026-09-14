#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 4 chain, against a RUNNING API and a
# REAL database:
#
#   partnership -> parties -> revenue share model v1 -> settlement from the
#   posted ledger -> capital recovery -> renegotiation (v2) -> the settled
#   period is UNCHANGED -> obligations
#
# The acceptance criterion this proves (docs/architecture/21-development-roadmap.md):
#
#   "three distinct waterfall configurations (surplus share, gross revenue
#    share, hybrid) produce correct results against hand-computed fixtures,
#    including cap and floor edge cases; changing the model version does not
#    alter a previously computed period."
#
# The three configurations and their edge cases are exhaustively covered by
# waterfall.spec.ts against hand-computed figures; this script proves the same
# engine gives those answers through the HTTP API, reading real journal lines
# rather than a fixture object.
#
# The ledger is seeded with SQL because the posting API is Release 8. That is
# the input to this release, not the subject of it — but it is real double
# entry, and the deferred balance trigger would refuse it otherwise.
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
psql_run() { docker exec "$PGCONTAINER" psql -v ON_ERROR_STOP=1 -U chc_migrator -d chc -tAq -c "$1" 2>&1; }

status()     { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $PM_TOKEN" "$@"; }
status_adm() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }
post()       { status -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_adm()   { status_adm -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

echo
echo "=== Sign in as both users ==="
curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PM_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-partner\"}" "$API/auth/login" >/dev/null
PM_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$PM_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  project manager signed in"; } \
                   || { FAIL=$((FAIL+1)); echo "  FAIL  project manager could not sign in"; }

curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke-partner\"}" "$API/auth/login" >/dev/null
ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
CHALLENGE=$(python -c "import json;print(json.load(open('login.json')).get('mfaToken',''))" 2>/dev/null)

if [ -n "$ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke-partner\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
elif [ -n "$CHALLENGE" ]; then
  SECRET=$(psql_run "SELECT mfa_secret FROM core.app_user WHERE email='$ADMIN_EMAIL'" | tr -d '[:space:]')
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"mfaToken\":\"$CHALLENGE\",\"code\":\"$CODE\",\"deviceId\":\"smoke-partner\"}" "$API/auth/mfa/verify" >/dev/null
fi
ADMIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$ADMIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  administrator signed in"; } \
                      || { FAIL=$((FAIL+1)); echo "  FAIL  administrator could not sign in"; }

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
ORG_ID=$(psql_run "SELECT id FROM core.organisation LIMIT 1" | tr -d '[:space:]')
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== A month of real double entry ==="
#   revenue            100,000,000 kobo   (₦1,000,000)
#   direct costs        30,000,000
#   operating expenses  40,000,000
#   operating surplus   30,000,000
PERIOD_ID=$(python -c "import uuid;print(uuid.uuid4())")
ENTRY_ID=$(python -c "import uuid;print(uuid.uuid4())")
PAYMENT_ID=$(python -c "import uuid;print(uuid.uuid4())")

out=$(psql_run "
INSERT INTO fin.financial_period (id,organisation_id,facility_id,name,start_date,end_date,status)
VALUES ('$PERIOD_ID','$ORG_ID','$FACILITY_ID','September 2026','2026-09-01','2026-09-30','OPEN');

INSERT INTO fin.journal_entry (id,organisation_id,facility_id,financial_period_id,reference,entry_date,description,source_type)
VALUES ('$ENTRY_ID','$ORG_ID','$FACILITY_ID','$PERIOD_ID','JE-SEP-001','2026-09-30','September trading','smoke');

INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
SELECT gen_random_uuid(),'$ENTRY_ID',id,'$ORG_ID','$FACILITY_ID',0,100000000 FROM fin.financial_account WHERE code='4110' AND organisation_id='$ORG_ID';
INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
SELECT gen_random_uuid(),'$ENTRY_ID',id,'$ORG_ID','$FACILITY_ID',30000000,0 FROM fin.financial_account WHERE code='5110' AND organisation_id='$ORG_ID';
INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
SELECT gen_random_uuid(),'$ENTRY_ID',id,'$ORG_ID','$FACILITY_ID',40000000,0 FROM fin.financial_account WHERE code='6110' AND organisation_id='$ORG_ID';
INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
SELECT gen_random_uuid(),'$ENTRY_ID',id,'$ORG_ID','$FACILITY_ID',30000000,0 FROM fin.financial_account WHERE code='1110' AND organisation_id='$ORG_ID';

INSERT INTO fin.payment (id,organisation_id,facility_id,reference,direction,amount_minor,method)
VALUES ('$PAYMENT_ID','$ORG_ID','$FACILITY_ID','PAY-CAPITAL-001','OUTBOUND',8000000,'BANK_TRANSFER');
")
if [ -z "$out" ]; then
  PASS=$((PASS+1)); echo "  PASS  a balanced month is posted to the ledger"
else
  FAIL=$((FAIL+1)); echo "  FAIL  ledger seed: $out"
fi

echo
echo "=== The partnership ==="
code=$(post "/partnerships" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Ikem revitalisation partnership\"}")
check "the project manager cannot agree a partnership" "403" "$code"

code=$(post_adm "/partnerships" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Ikem revitalisation partnership\",\"commencementDate\":\"2026-09-01\",\"termMonths\":120}")
check "the administrator can" "201" "$code"
PARTNERSHIP_ID=$(jq_get "d['id']")

code=$(post_adm "/partnerships/parties" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyRole\":\"GOVERNMENT\",\"legalName\":\"Enugu State Ministry of Health\",\"representative\":\"The Honourable Commissioner\"}")
check "the government is recorded as a party" "201" "$code"
GOV_ID=$(jq_get "d['id']")

code=$(post_adm "/partnerships/parties" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyRole\":\"PARTNER\",\"legalName\":\"Bonnesante Medicals Ltd\"}")
check "and so is the operating partner" "201" "$code"
PARTNER_ID=$(jq_get "d['id']")

echo
echo "=== The waterfall is configuration, never code (spec section 35) ==="
STEPS="[
  {\"sequence\":1,\"label\":\"Staff incentives\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.1,\"capMinor\":2000000},
  {\"sequence\":2,\"label\":\"Maintenance reserve\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.1,\"floorMinor\":5000000},
  {\"sequence\":3,\"label\":\"Government entitlement\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.4,\"beneficiaryPartyId\":\"$GOV_ID\"},
  {\"sequence\":4,\"label\":\"Partner capital recovery\",\"basis\":\"RESIDUAL\",\"isCapitalRecovery\":true,\"beneficiaryPartyId\":\"$PARTNER_ID\"},
  {\"sequence\":5,\"label\":\"Partner return\",\"basis\":\"RESIDUAL\",\"rate\":0.5,\"beneficiaryPartyId\":\"$PARTNER_ID\"},
  {\"sequence\":6,\"label\":\"Reinvestment\",\"basis\":\"RESIDUAL\"}
]"

code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Agreed terms\",\"shareType\":\"SURPLUS_SHARE\",\"effectiveFrom\":\"2026-09-01\",\"steps\":$STEPS}")
check "the agreed terms are recorded as version 1" "201" "$code"
check "with six ordered steps" "6" "$(jq_get "d['stepCount']")"

code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Contradictory\",\"shareType\":\"SURPLUS_SHARE\",\"effectiveFrom\":\"2026-10-01\",\"steps\":[{\"sequence\":1,\"label\":\"Impossible\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.1,\"capMinor\":1000000,\"floorMinor\":2000000}]}")
check "a floor above a cap is refused, not silently resolved" "400" "$code"

code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Foreign party\",\"shareType\":\"SURPLUS_SHARE\",\"effectiveFrom\":\"2026-10-01\",\"steps\":[{\"sequence\":1,\"label\":\"Somebody else\",\"basis\":\"RESIDUAL\",\"beneficiaryPartyId\":\"11111111-1111-1111-1111-111111111111\"}]}")
check "a step paying a party outside the partnership is refused" "400" "$code"

echo
echo "=== Settlement, computed from the ledger ==="
code=$(status "$API/partnerships/$PARTNERSHIP_ID/settlement/$PERIOD_ID")
check "the project manager cannot compute a settlement" "403" "$code"

code=$(status_adm "$API/partnerships/$PARTNERSHIP_ID/settlement/$PERIOD_ID")
check "the administrator can" "200" "$code"
check "gross revenue comes from the posted entries" "100000000" "$(jq_get "d['grossRevenueMinor']")"
check "as do the direct costs" "30000000" "$(jq_get "d['directCostMinor']")"
check "and the operating expenses" "40000000" "$(jq_get "d['operatingExpenseMinor']")"
check "leaving a surplus of 30,000,000 kobo" "30000000" "$(jq_get "d['operatingSurplusMinor']")"

check "staff incentives are held to their cap" "2000000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==1][0]['allocatedMinor']")"
check_true "and the cap is reported, not hidden" "$(jq_get "[a for a in d['allocations'] if a['sequence']==1][0]['capApplied']")"
check "the maintenance reserve is lifted to its floor" "5000000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==2][0]['allocatedMinor']")"
check "the government gets 40% of the surplus" "12000000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==3][0]['allocatedMinor']")"
check "capital recovery takes nothing while nothing is outstanding" "0" "$(jq_get "[a for a in d['allocations'] if a['sequence']==4][0]['allocatedMinor']")"
check "every kobo is accounted for" "30000000" "$(jq_get "d['totalAllocatedMinor']")"
check "with nothing left over" "0" "$(jq_get "d['residualMinor']")"

check_true "an open period is marked provisional" "$(jq_get "d['isProvisional']")"
note "$(jq_get "d.get('provisionalNote','')" | head -c 100)"

echo
echo "=== Capital recovery traces to money that really moved (spec section 74) ==="
code=$(post_adm "/partnerships/recovery-events" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"eventType\":\"INVESTMENT\",\"amountMinor\":8000000,\"occurredOn\":\"2026-09-05\"}")
check "capital claimed as invested with no payment behind it is refused" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

code=$(post_adm "/partnerships/recovery-events" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"eventType\":\"INVESTMENT\",\"amountMinor\":8000000,\"occurredOn\":\"2026-09-05\",\"sourcePaymentId\":\"$PAYMENT_ID\",\"description\":\"Theatre equipment\"}")
check "with the payment that funded it, it is accepted" "201" "$code"

code=$(post_adm "/partnerships/recovery-events" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"eventType\":\"RECOVERY\",\"amountMinor\":20000000,\"occurredOn\":\"2026-09-30\"}")
check "recovering more than was invested is refused" "400" "$code"

code=$(status "$API/partnerships/$PARTNERSHIP_ID/capital-recovery")
check "the capital position reads back" "200" "$code"
check "8,000,000 invested" "8000000" "$(jq_get "d['position']['investedMinor']")"
check "8,000,000 still outstanding" "8000000" "$(jq_get "d['position']['outstandingMinor']")"
check "and it is an actual, not a projection" "ACTUAL" "$(jq_get "d['position']['classification']")"

code=$(status_adm "$API/partnerships/$PARTNERSHIP_ID/settlement/$PERIOD_ID")
check "the recovery step now caps at what the partner is owed" "8000000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==4][0]['allocatedMinor']")"
check "the partner return takes half of what is left" "1500000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==5][0]['allocatedMinor']")"
check "and reinvestment sweeps the rest" "1500000" "$(jq_get "[a for a in d['allocations'] if a['sequence']==6][0]['allocatedMinor']")"
check "the surplus is still distributed exactly" "30000000" "$(jq_get "d['totalAllocatedMinor']")"
note "government $(jq_get "[p for p in d['byParty'] if p['partyId']=='$GOV_ID'][0]['allocatedMinor']") | partner $(jq_get "[p for p in d['byParty'] if p['partyId']=='$PARTNER_ID'][0]['allocatedMinor']")"

echo
echo "=== Closing the period makes the figures final ==="
psql_run "UPDATE fin.financial_period SET status='CLOSED', closed_at=now() WHERE id='$PERIOD_ID'" >/dev/null
code=$(status_adm "$API/partnerships/$PARTNERSHIP_ID/settlement/$PERIOD_ID")
check "the settlement still computes" "200" "$code"
check "and is no longer provisional" "False" "$(jq_get "d['isProvisional']")"
SETTLED_GOV=$(jq_get "[a for a in d['allocations'] if a['sequence']==3][0]['allocatedMinor']")
SETTLED_VERSION=$(jq_get "d['revenueShareModelVersion']")
# Captured for the comparison after the renegotiation. If they are blank, that
# comparison would pass by comparing nothing to nothing.
check "the settled figures were actually captured" "12000000" "$SETTLED_GOV"
note "settled on version $SETTLED_VERSION: government $SETTLED_GOV kobo"

echo
echo "=== A renegotiation does not reach back (doc 12 section 9) ==="
NEW_STEPS="[
  {\"sequence\":1,\"label\":\"Government entitlement\",\"basis\":\"GROSS_REVENUE\",\"rate\":0.1,\"beneficiaryPartyId\":\"$GOV_ID\"},
  {\"sequence\":2,\"label\":\"Partner\",\"basis\":\"RESIDUAL\",\"beneficiaryPartyId\":\"$PARTNER_ID\"}
]"
code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Renegotiated terms\",\"shareType\":\"GROSS_REVENUE_SHARE\",\"effectiveFrom\":\"2026-10-01\",\"steps\":$NEW_STEPS}")
check "version 2 is agreed, effective from October" "201" "$code"
check "it is version 2" "2" "$(jq_get "d['versionNumber']")"

code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Backdated\",\"shareType\":\"HYBRID\",\"effectiveFrom\":\"2026-09-15\",\"steps\":$NEW_STEPS}")
check "a version backdated over one already in force is refused" "400" "$code"

code=$(status_adm "$API/partnerships/$PARTNERSHIP_ID/settlement/$PERIOD_ID")
check "September still settles on the terms that were in force then" "$SETTLED_VERSION" "$(jq_get "d['revenueShareModelVersion']")"
check "and the government is owed exactly what it was owed before" "$SETTLED_GOV" "$(jq_get "[a for a in d['allocations'] if a['sequence']==3][0]['allocatedMinor']")"

echo
echo "=== Obligations (spec section 36) ==="
code=$(post_adm "/partnerships/obligations" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyId\":\"$GOV_ID\",\"description\":\"Second the four existing nursing staff to the facility\",\"dueDate\":\"2026-10-31\"}")
check "an obligation is recorded against a party" "201" "$code"
OBLIGATION_ID=$(jq_get "d['id']")
check "with a reference" "OB-001" "$(jq_get "d['reference']")"

code=$(post_adm "/partnerships/obligations/$OBLIGATION_ID/settle" '{"status":"MET"}')
check "marking it met on no evidence is refused" "400" "$code"

code=$(post_adm "/partnerships/obligations/$OBLIGATION_ID/settle" '{"status":"MET","evidenceNote":"Secondment letter dated 12 October, copy on file as EV-0007."}')
check "with evidence it is accepted" "200" "$code"

code=$(status "$API/partnerships/$PARTNERSHIP_ID")
check "the partnership reads back" "200" "$code"
check "with both parties" "2" "$(jq_get "len(d['parties'])")"
check "and both versions of the terms" "2" "$(jq_get "len(d['revenueShareModels'])")"
check_true "the version in force today is identified" "$(jq_get "any(m['inForceToday'] for m in d['revenueShareModels'])")"

echo
echo "=== Audit ==="
AUDIT=$(psql_run "SELECT action FROM audit.audit_log WHERE action LIKE 'partnership%' GROUP BY action ORDER BY action")
echo "$AUDIT" | sed 's/^/        /'
for expected in "partnership.create" "partnership.party.add" "partnership.revenue_share.create" "partnership.recovery.record" "partnership.obligation.settle"; do
  if echo "$AUDIT" | grep -q "^$expected$"; then
    PASS=$((PASS+1)); printf '  PASS  audited: %s\n' "$expected"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  not audited: %s\n' "$expected"
  fi
done

rm -f body.json login.json

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
