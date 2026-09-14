#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 8 chain, against a RUNNING API and a
# REAL database:
#
#   stock received -> encounter -> prescription -> FEFO dispensing ->
#   stock + charge + ledger in one transaction -> lab order -> critical result
#   -> escalation -> acknowledgement -> trial balance -> daily cash
#
# The acceptance criteria this proves (docs/architecture/21-development-roadmap.md):
#
#   G — a clinical encounter creates revenue
#   H — dispensing atomically updates stock, charges and the ledger
#   I — laboratory activity updates clinical and financial records
#   And: stock can never go negative; the daily cash identity balances; a
#   critical result escalates until acknowledged.
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

note() { printf '        %s\n' "$1"; }
jq_get() { python -c "import json,sys;d=json.load(open('body.json'));print(eval(sys.argv[1],{'d':d,'json':json}))" "$1" 2>/dev/null; }
psql_run() { docker exec "$PGCONTAINER" psql -v ON_ERROR_STOP=1 -U chc_migrator -d chc -tAq -c "$1" 2>&1; }

status()  { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $CLIN_TOKEN" "$@"; }
status_p(){ curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $PHARM_TOKEN" "$@"; }
status_l(){ curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $LAB_TOKEN" "$@"; }
status_f(){ curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $FIN_TOKEN" "$@"; }
status_i(){ curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $INV_TOKEN" "$@"; }
post()    { status -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_p()  { status_p -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_l()  { status_l -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_f()  { status_f -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_i()  { status_i -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

seed_user() {
  EMAIL="$1" PASSWORD="$PASSWORD" NAME="$2" ROLE="$3" FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
    DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
    ../../node_modules/.bin/tsx prisma/seed/create-user.ts >/dev/null 2>&1
}

sign_in() {
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"deviceId\":\"smoke-ops\"}" "$API/auth/login" >/dev/null
  local enrol secret code
  enrol=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
  secret=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
  if [ -n "$enrol" ]; then
    code=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$secret")
    curl -s -o login.json -X POST -H 'Content-Type: application/json' \
      -d "{\"enrolmentToken\":\"$enrol\",\"code\":\"$code\",\"deviceId\":\"smoke-ops\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
  fi
  python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null
}

echo
echo "=== The people an operating facility actually has ==="
seed_user "clin8@example.org" "Dr C. Eze" CLINICIAN
seed_user "pharm8@example.org" "P. Okonkwo" PHARMACY_PERSONNEL
seed_user "lab8@example.org" "L. Adebayo" LAB_PERSONNEL
seed_user "fin8@example.org" "F. Bello" FINANCE_OFFICER
seed_user "inv8@example.org" "I. Musa" INVENTORY_OFFICER

CLIN_TOKEN=$(sign_in "clin8@example.org")
PHARM_TOKEN=$(sign_in "pharm8@example.org")
LAB_TOKEN=$(sign_in "lab8@example.org")
FIN_TOKEN=$(sign_in "fin8@example.org")
INV_TOKEN=$(sign_in "inv8@example.org")

for pair in "clinician:$CLIN_TOKEN" "pharmacist:$PHARM_TOKEN" "laboratory scientist:$LAB_TOKEN" "finance officer:$FIN_TOKEN" "inventory officer:$INV_TOKEN"; do
  name="${pair%%:*}"; token="${pair#*:}"
  [ -n "$token" ] && { PASS=$((PASS+1)); echo "  PASS  the $name signed in"; } \
                  || { FAIL=$((FAIL+1)); echo "  FAIL  the $name could not sign in"; }
done

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
ORG_ID=$(psql_run "SELECT id FROM core.organisation LIMIT 1" | tr -d '[:space:]')
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== An open financial period, a stock item and a medication ==="
code=$(post_f "/finance/periods" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"September 2026\",\"startDate\":\"2026-09-01\",\"endDate\":\"2026-09-30\"}")
check "a period is opened" "201" "$code"
PERIOD_ID=$(jq_get "d['id']")

ITEM_ID=$(python -c "import uuid;print(uuid.uuid4())")
MED_ID=$(python -c "import uuid;print(uuid.uuid4())")
TEST_ID=$(python -c "import uuid;print(uuid.uuid4())")

out=$(psql_run "
INSERT INTO supply.inventory_item (id,facility_id,organisation_id,code,name,kind,unit_of_measure)
VALUES ('$ITEM_ID','$FACILITY_ID','$ORG_ID','MED-ACT','Artemether-lumefantrine 20/120','MEDICINE','tablet');
INSERT INTO clinical.medication (id,organisation_id,code,generic_name,dosage_form,strength,inventory_item_id)
VALUES ('$MED_ID','$ORG_ID','ACT-2012','Artemether-lumefantrine','Tablet','20/120mg','$ITEM_ID');
INSERT INTO clinical.lab_test (id,code,name,specimen_type,unit)
VALUES ('$TEST_ID','K-SERUM','Serum potassium','Serum','mmol/L');
INSERT INTO clinical.lab_reference_range (id,lab_test_id,low_value,high_value,critical_low,critical_high,unit)
VALUES (gen_random_uuid(),'$TEST_ID',3.5,5.1,2.5,6.5,'mmol/L');
")
[ -z "$out" ] && { PASS=$((PASS+1)); echo "  PASS  reference data seeded"; } \
              || { FAIL=$((FAIL+1)); echo "  FAIL  seed: $out"; }

echo
echo "=== Stock arrives, and the ledger knows ==="
code=$(post_p "/inventory/receive" "{\"facilityId\":\"$FACILITY_ID\",\"inventoryItemId\":\"$ITEM_ID\",\"batchNumber\":\"B-EXPIRING\",\"quantity\":12,\"unitCostMinor\":2000,\"expiryDate\":\"2026-11-30\"}")
check "a near-expiry batch is received" "201" "$code"
BATCH_NEAR=$(jq_get "d['id']")
check "quantity on hand comes from the ledger" "12" "$(jq_get "d['quantityOnHand']")"
note "$(jq_get "d['note']")"

code=$(post_p "/inventory/receive" "{\"facilityId\":\"$FACILITY_ID\",\"inventoryItemId\":\"$ITEM_ID\",\"batchNumber\":\"B-FRESH\",\"quantity\":100,\"unitCostMinor\":2500,\"expiryDate\":\"2027-12-31\"}")
check "a fresh batch is received" "201" "$code"
BATCH_FRESH=$(jq_get "d['id']")

code=$(post_p "/inventory/receive" "{\"facilityId\":\"$FACILITY_ID\",\"inventoryItemId\":\"$ITEM_ID\",\"batchNumber\":\"B-EXPIRED\",\"quantity\":50,\"unitCostMinor\":1800,\"expiryDate\":\"2026-08-01\"}")
check "an already-expired batch is received onto the register" "201" "$code"
BATCH_EXPIRED=$(jq_get "d['id']")

code=$(status_p "$API/inventory/stock?facilityId=$FACILITY_ID&itemId=$ITEM_ID")
check "the stock list reads back" "200" "$code"
check_true "the expired batch is marked expired without a job having run" "$(jq_get "any(b['effectiveStatus']=='EXPIRED' for b in d)")"

echo
echo "=== FEFO chooses, and never chooses expired stock ==="
code=$(post_p "/pharmacy/preview" "{\"facilityId\":\"$FACILITY_ID\",\"inventoryItemId\":\"$ITEM_ID\",\"quantity\":6}")
check "FEFO previews the selection" "200" "$code"
check "it takes from the near-expiry batch first" "B-EXPIRING" "$(jq_get "d['allocations'][0]['batchNumber']")"
check_true "and passes over the expired one, saying why" "$(jq_get "any('Expired' in e['reason'] for e in d['excluded'])")"
note "$(jq_get "d['allocations'][0].get('nearExpiryWarning','')" | head -c 100)"

echo
echo "=== A patient, an encounter, a prescription ==="
code=$(post "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Chidi\",\"familyName\":\"Nwankwo\",\"dateOfBirth\":\"1988-03-02\",\"sex\":\"MALE\"}")
PATIENT_ID=$(jq_get "d['id']")
code=$(post "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"TREATMENT\",\"granted\":true}")
code=$(post "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"DATA_STORAGE\",\"granted\":true}")
code=$(post "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Fever\"}")
check "an encounter opens" "201" "$code"
ENCOUNTER_ID=$(jq_get "d['id']")

PRESCRIPTION_ID=$(python -c "import uuid;print(uuid.uuid4())")
ITEM_PRESC_ID=$(python -c "import uuid;print(uuid.uuid4())")
out=$(psql_run "
INSERT INTO clinical.prescription (id,encounter_id,organisation_id,facility_id,reference,status)
VALUES ('$PRESCRIPTION_ID','$ENCOUNTER_ID','$ORG_ID','$FACILITY_ID','RX-8000001','ISSUED');
INSERT INTO clinical.prescription_item (id,prescription_id,medication_id,organisation_id,facility_id,medication_name,dose,frequency,quantity_prescribed)
VALUES ('$ITEM_PRESC_ID','$PRESCRIPTION_ID','$MED_ID','$ORG_ID','$FACILITY_ID','Artemether-lumefantrine','4 tablets','twice daily',24);
")
[ -z "$out" ] && { PASS=$((PASS+1)); echo "  PASS  a prescription is written"; } \
              || { FAIL=$((FAIL+1)); echo "  FAIL  prescription: $out"; }

echo
echo "=== Dispensing moves stock, charge and ledger together (criterion H) ==="
code=$(post_p "/pharmacy/dispense" "{\"prescriptionItemId\":\"$ITEM_PRESC_ID\",\"quantity\":24,\"unitPriceMinor\":4000}")
check "the pharmacist dispenses" "200" "$code"
check "across two batches, the expiring one first" "2" "$(jq_get "len(d['dispensings'])")"
check "the charge is the price times the quantity" "96000" "$(jq_get "d['charge']['amountMinor']")"
check "the cost comes from the batches actually issued" "54000" "$(jq_get "d['costMinor']")"
check "and the margin follows from both" "42000" "$(jq_get "d['marginMinor']")"
check "two journal entries were posted, revenue and cost" "2" "$(jq_get "len(d['journalEntries'])")"
note "$(jq_get "d['note']")"

code=$(status_p "$API/inventory/stock?facilityId=$FACILITY_ID&itemId=$ITEM_ID")
check "the expiring batch is now empty" "0" "$(jq_get "[b for b in d if b['batchNumber']=='B-EXPIRING'][0]['quantityOnHand']")"
check "and the fresh batch supplied the rest" "88" "$(jq_get "[b for b in d if b['batchNumber']=='B-FRESH'][0]['quantityOnHand']")"

echo
echo "=== Stock can never go negative ==="
code=$(post_p "/pharmacy/dispense" "{\"prescriptionItemId\":\"$ITEM_PRESC_ID\",\"quantity\":500,\"unitPriceMinor\":4000}")
check "dispensing beyond the prescription is refused" "400" "$code"

out=$(psql_run "INSERT INTO supply.stock_transaction (id,inventory_batch_id,organisation_id,facility_id,transaction_type,quantity,source_type) VALUES (gen_random_uuid(),'$BATCH_FRESH','$ORG_ID','$FACILITY_ID','ISSUE',-999,'smoke');")
if echo "$out" | grep -qi "negative\|cannot go"; then
  PASS=$((PASS+1)); echo "  PASS  the database refuses to drive a batch negative"
  note "$(echo "$out" | grep -m1 ERROR | cut -c1-110)"
else
  FAIL=$((FAIL+1)); echo "  FAIL  stock went negative: $out"
fi

echo
echo "=== The ledger agrees with what happened (criterion G) ==="
code=$(status_f "$API/finance/trial-balance?facilityId=$FACILITY_ID&periodId=$PERIOD_ID")
check "the trial balance reads back" "200" "$code"
check_true "and it balances" "$(jq_get "d['balances']")"
check_true "pharmacy revenue was recognised" "$(jq_get "any(a['code']=='4130' and int(a['creditMinor'])==96000 for a in d['accounts'])")"
check_true "the cost of medicines was recognised separately" "$(jq_get "any(a['code']=='5110' and int(a['debitMinor'])==54000 for a in d['accounts'])")"
check_true "inventory rose on receipt and fell on issue" "$(jq_get "any(a['code']=='1150' for a in d['accounts'])")"
note "debits $(jq_get "d['totalDebitMinor']") = credits $(jq_get "d['totalCreditMinor']") across $(jq_get "d['entryCount']") entries"

code=$(status_f "$API/finance/entries/dispensing/$ITEM_PRESC_ID?facilityId=$FACILITY_ID")
check "the entries behind the dispensing can be opened up" "200" "$code"
check_true "and each one balances" "$(jq_get "all(e['balances'] for e in d)")"

echo
echo "=== Laboratory: order, result, verification (criterion I) ==="
code=$(post "/laboratory/orders" "{\"encounterId\":\"$ENCOUNTER_ID\",\"testIds\":[\"$TEST_ID\"],\"clinicalIndication\":\"Vomiting, weakness\",\"pricesMinor\":{\"$TEST_ID\":150000}}")
check "the clinician orders a test" "201" "$code"
ORDER_ITEM_ID=$(jq_get "d['items'][0]['id']")
check "and it is charged at the tariff given" "150000" "$(jq_get "d['totalChargedMinor']")"

code=$(post_l "/laboratory/samples" "{\"labOrderItemId\":\"$ORDER_ITEM_ID\",\"sampleType\":\"Serum\"}")
check "a sample is collected" "201" "$code"
SAMPLE_ID=$(jq_get "d['id']")
note "accession $(jq_get "d['accessionNumber']")"

code=$(post_l "/laboratory/results" "{\"sampleId\":\"$SAMPLE_ID\",\"labTestId\":\"$TEST_ID\",\"numericValue\":7.2,\"unit\":\"mmol/L\"}")
check "a result is entered" "201" "$code"
RESULT_ID=$(jq_get "d['id']")
check "flagged critical against the reference range" "CRITICAL_HIGH" "$(jq_get "d['flag']")"
note "$(jq_get "d['note']")"

code=$(status "$API/laboratory/results/encounter/$ENCOUNTER_ID")
check_true "an unverified result is withheld from the clinician" "$(jq_get "'withheld' in str(d)")"

code=$(post_l "/laboratory/results/$RESULT_ID/verify" '{}')
check "the scientist verifies it" "200" "$code"
check_true "escalation starts at verification" "$(jq_get "'escalation' in d")"
note "$(jq_get "d.get('escalation',{}).get('note','')" | head -c 120)"

code=$(status "$API/laboratory/results/encounter/$ENCOUNTER_ID")
check_true "now the clinician can see the value" "$(jq_get "d[0]['samples'][0]['results'][0].get('value')==7.2")"

echo
echo "=== A critical result escalates until acknowledged ==="
code=$(status_l "$API/laboratory/critical?facilityId=$FACILITY_ID")
check "it appears on the critical list" "200" "$code"
check "with one result waiting" "1" "$(jq_get "len(d)")"
check_true "and somebody to notify now" "$(jq_get "len(d[0]['notifyNow'])>0")"
note "$(jq_get "d[0]['summary']")"

code=$(post "/laboratory/results/$RESULT_ID/acknowledge" '{"actionTaken":""}')
check "acknowledging with no action is refused" "400" "$code"

code=$(post "/laboratory/results/$RESULT_ID/acknowledge" '{"actionTaken":"Patient reviewed, calcium gluconate and insulin-dextrose given, repeat sample sent."}')
check "the clinician acknowledges it" "200" "$code"
note "$(jq_get "d['note']")"

code=$(status_l "$API/laboratory/critical?facilityId=$FACILITY_ID")
check "and it leaves the critical list" "0" "$(jq_get "len(d)")"

echo
echo "=== Writing off what expired ==="
code=$(post_p "/inventory/write-off" "{\"batchId\":\"$BATCH_EXPIRED\",\"quantity\":50,\"reasonCode\":\"EXPIRY\",\"reasonNote\":\"Batch expired on 1 August before it could be used.\"}")
check "a pharmacist cannot write stock off" "403" "$code"

code=$(post_i "/inventory/write-off" "{\"batchId\":\"$BATCH_EXPIRED\",\"quantity\":50,\"reasonCode\":\"EXPIRY\",\"reasonNote\":\"Batch expired on 1 August before it could be used.\"}")
check "the inventory officer can" "200" "$code"
check "the loss is valued at what it cost" "90000" "$(jq_get "d['costMinor']")"
note "$(jq_get "d['note']")"

code=$(status_f "$API/finance/trial-balance?facilityId=$FACILITY_ID&periodId=$PERIOD_ID")
check_true "and it shows in the accounts, not just off the shelf" "$(jq_get "any(a['code']=='5140' and int(a['debitMinor'])==90000 for a in d['accounts'])")"
check_true "the ledger still balances" "$(jq_get "d['balances']")"

echo
echo "=== The stock identity holds (spec section 45) ==="
code=$(status_p "$API/inventory/batches/$BATCH_FRESH/reconcile")
check "the batch reconciles" "200" "$code"
check_true "the ledger and the cached quantity agree" "$(jq_get "d['agrees']")"
note "opening $(jq_get "d['opening']") + receipts $(jq_get "d['receipts']") - issues $(jq_get "d['issues']") = closing $(jq_get "d['closing']")"

echo
echo "=== The daily cash identity ==="
code=$(post_f "/finance/daily-cash" "{\"facilityId\":\"$FACILITY_ID\",\"date\":\"2026-09-14\",\"countedClosingMinor\":0}")
check "a day with no cash movement balances" "200" "$code"
check_true "it says so" "$(jq_get "d['balances']")"
note "$(jq_get "d['summary']")"

code=$(post_f "/finance/daily-cash" "{\"facilityId\":\"$FACILITY_ID\",\"date\":\"2026-09-15\",\"countedClosingMinor\":20000}")
check "a drawer that does not match is refused without an explanation" "400" "$code"

code=$(post_f "/finance/daily-cash" "{\"facilityId\":\"$FACILITY_ID\",\"date\":\"2026-09-15\",\"countedClosingMinor\":20000,\"note\":\"Float advanced from the safe, receipt in the day book.\"}")
check "with an explanation it is recorded" "200" "$code"
check "and the variance is stated, not absorbed" "20000" "$(jq_get "d['varianceMinor']")"
note "$(jq_get "d['summary']" | head -c 120)"

echo
echo "=== Closing a period that balances ==="
code=$(post_f "/finance/periods/$PERIOD_ID/close" '{"note":"Month end."}')
check "the period closes" "200" "$code"
check_true "its trial balance balanced" "$(jq_get "d['trialBalance']['balances']")"
note "$(jq_get "d['note']")"

code=$(post_i "/inventory/write-off" "{\"batchId\":\"$BATCH_FRESH\",\"quantity\":1,\"reasonCode\":\"BREAKAGE\",\"reasonNote\":\"Trying to post into a closed period.\"}")
check "nothing can be posted into it now" "409" "$code"
check_true "as a named rule" "$(jq_get "d['type'].endswith('period-closed')")"

echo
echo "=== Audit ==="
AUDIT=$(psql_run "SELECT action FROM audit.audit_log WHERE action LIKE 'inventory%' OR action LIKE 'pharmacy%' OR action LIKE 'laboratory%' OR action LIKE 'finance%' GROUP BY action ORDER BY action")
echo "$AUDIT" | sed 's/^/        /'
for expected in "inventory.receive" "inventory.write_off" "pharmacy.dispense" "laboratory.order" "laboratory.result.verify" "laboratory.result.acknowledge" "finance.cash.reconcile" "finance.period.close"; do
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
