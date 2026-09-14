#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 6 chain, against a RUNNING API and a
# REAL database:
#
#   recommendation -> project -> phases -> tasks with dependencies -> critical
#   path -> purchase request -> approval -> quotations -> order -> goods
#   receipt -> ASSET -> commissioning -> invoice -> three-way match -> payment
#
# The acceptance criteria this proves (docs/architecture/21-development-roadmap.md):
#
#   Criterion E — procurement creates an asset
#   Criterion F — the asset becomes operational only when every commissioning
#                 check passes
#   And: a supplier invoice without a goods receipt cannot be paid.
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
status_fin() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $FIN_TOKEN" "$@"; }
post()       { status -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_adm()   { status_adm -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post_fin()   { status_fin -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

echo
echo "=== Sign in ==="
curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PM_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-exec\"}" "$API/auth/login" >/dev/null
PM_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$PM_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  project manager signed in"; } \
                   || { FAIL=$((FAIL+1)); echo "  FAIL  project manager could not sign in"; }

curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke-exec\"}" "$API/auth/login" >/dev/null
ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
CHALLENGE=$(python -c "import json;print(json.load(open('login.json')).get('mfaToken',''))" 2>/dev/null)

if [ -n "$ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke-exec\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
elif [ -n "$CHALLENGE" ]; then
  SECRET=$(psql_run "SELECT mfa_secret FROM core.app_user WHERE email='$ADMIN_EMAIL'" | tr -d '[:space:]')
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"mfaToken\":\"$CHALLENGE\",\"code\":\"$CODE\",\"deviceId\":\"smoke-exec\"}" "$API/auth/mfa/verify" >/dev/null
fi
ADMIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$ADMIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  administrator signed in"; } \
                      || { FAIL=$((FAIL+1)); echo "  FAIL  administrator could not sign in"; }

# A finance officer raises payments; the administrator approves them. Two
# different people, because that is the control being tested.
ORG_ID=$(psql_run "SELECT id FROM core.organisation LIMIT 1" | tr -d '[:space:]')
FIN_EMAIL="finance@example.org"
EMAIL="$FIN_EMAIL" PASSWORD="$PM_PASSWORD" NAME="F. Officer" ROLE=FINANCE_OFFICER \
  FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
  ../../node_modules/.bin/tsx prisma/seed/create-user.ts >/dev/null 2>&1

curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$FIN_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-exec\"}" "$API/auth/login" >/dev/null
FIN_ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
FIN_SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
if [ -n "$FIN_ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$FIN_SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$FIN_ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke-exec\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
fi
FIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$FIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  finance officer signed in"; } \
                    || { FAIL=$((FAIL+1)); echo "  FAIL  finance officer could not sign in"; }

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== A project delivers a recommendation ==="
code=$(post "/findings" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Labour room roof leaks\",\"severity\":\"HIGH\"}")
FINDING_ID=$(jq_get "d['id']")
code=$(post "/needs" "{\"facilityId\":\"$FACILITY_ID\",\"findingId\":\"$FINDING_ID\",\"title\":\"Weatherproof the labour room\"}")
NEED_ID=$(jq_get "d['id']")
code=$(post "/recommendations" "{\"needId\":\"$NEED_ID\",\"title\":\"Replace roof sheets and ceiling\"}")
RECOMMENDATION_ID=$(jq_get "d['id']")
check "the chain to a recommendation exists" "201" "$code"

code=$(post "/projects" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Labour room re-roofing\",\"category\":\"BUILDING\",\"priorityClass\":\"P1\"}")
check "a project with no recommendation and no reason is refused" "400" "$code"

code=$(post "/projects" "{\"facilityId\":\"$FACILITY_ID\",\"recommendationId\":\"$RECOMMENDATION_ID\",\"name\":\"Labour room re-roofing\",\"category\":\"BUILDING\",\"priorityClass\":\"P1\"}")
check "a project that delivers a recommendation is accepted" "201" "$code"
PROJECT_ID=$(jq_get "d['id']")
note "$(jq_get "d['reference']")"

echo
echo "=== Tasks, dependencies and the critical path ==="
code=$(post "/projects/phases" "{\"projectId\":\"$PROJECT_ID\",\"name\":\"Works\",\"sequence\":1}")
check "a phase is added" "201" "$code"
PHASE_ID=$(jq_get "d['id']")

code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Strip the old roof\",\"weight\":3,\"estimatedDays\":5}")
check "a task is added" "201" "$code"
TASK_A=$(jq_get "d['id']")

code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Fit new sheets\",\"weight\":5,\"estimatedDays\":3,\"dependsOn\":[{\"predecessorId\":\"$TASK_A\"}]}")
TASK_B=$(jq_get "d['id']")
code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Order the ceiling boards\",\"weight\":1,\"estimatedDays\":1,\"dependsOn\":[{\"predecessorId\":\"$TASK_A\"}]}")
TASK_C=$(jq_get "d['id']")
code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Fit the ceiling\",\"weight\":2,\"estimatedDays\":2,\"dependsOn\":[{\"predecessorId\":\"$TASK_B\"},{\"predecessorId\":\"$TASK_C\"}]}")
check "tasks with dependencies are accepted" "201" "$code"
TASK_D=$(jq_get "d['id']")

code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Impossible task\",\"estimatedDays\":1,\"dependsOn\":[{\"predecessorId\":\"$TASK_D\"}]}")
LOOP_TASK=$(jq_get "d['id']")
code=$(post "/projects/tasks" "{\"phaseId\":\"$PHASE_ID\",\"name\":\"Nonexistent predecessor\",\"estimatedDays\":1,\"dependsOn\":[{\"predecessorId\":\"11111111-1111-1111-1111-111111111111\"}]}")
check "a dependency on a task outside the project is refused" "400" "$code"

code=$(status "$API/projects/$PROJECT_ID")
check "the project reads back" "200" "$code"
check "with its schedule computed" "11" "$(jq_get "d['schedule']['durationDays']")"
note "critical path: $(jq_get "', '.join(d['schedule']['criticalPath'])")"
check_true "the ceiling order has slack, the sheets do not" "$(jq_get "[t for t in d['tasks'] if 'ceiling boards' in t['name']][0]['slackDays'] > 0 and [t for t in d['tasks'] if 'new sheets' in t['name']][0]['slackDays'] == 0")"
check "nothing is done yet" "0" "$(jq_get "d['completion']['percent']")"

code=$(post "/projects/tasks/$TASK_A/progress" '{"percentComplete":100}')
check "progress is recorded" "200" "$code"
check "and the task is complete" "COMPLETED" "$(jq_get "d['status']")"

code=$(status "$API/projects/$PROJECT_ID")
check_true "completion is weighted, not counted" "$(jq_get "0 < d['completion']['percent'] < 30")"
note "completion $(jq_get "d['completion']['percent']")% across $(jq_get "d['completion']['countedTasks']") tasks"

echo
echo "=== Procurement: request, approval, quotations ==="
code=$(post "/procurement/suppliers" '{"name":"Ikem Roofing Ltd","contactName":"A. Roofer"}')
check "a supplier is registered" "201" "$code"
SUPPLIER_A=$(jq_get "d['id']")
code=$(post "/procurement/suppliers" '{"name":"Enugu Building Supplies"}')
SUPPLIER_B=$(jq_get "d['id']")

code=$(post "/procurement/requests" "{\"facilityId\":\"$FACILITY_ID\",\"projectId\":\"$PROJECT_ID\",\"title\":\"Roofing materials and beds\",\"justification\":\"Labour room re-roofing\",\"lines\":[{\"description\":\"Hospital bed\",\"quantity\":10,\"isCapitalItem\":true},{\"description\":\"Roofing sheet\",\"quantity\":40,\"isCapitalItem\":false}]}")
check "a purchase request is raised" "201" "$code"
REQUEST_ID=$(jq_get "d['id']")

code=$(post "/procurement/requests/$REQUEST_ID/decide" '{"decision":"APPROVED"}')
check "the requester cannot approve their own request" "403" "$code"

code=$(post_adm "/procurement/requests/$REQUEST_ID/decide" '{"decision":"APPROVED"}')
check "a second person can" "200" "$code"

code=$(post "/procurement/quotations" "{\"purchaseRequestId\":\"$REQUEST_ID\",\"supplierId\":\"$SUPPLIER_A\",\"lines\":[{\"description\":\"Hospital bed\",\"quantity\":10,\"unitPriceMinor\":50000},{\"description\":\"Roofing sheet\",\"quantity\":40,\"unitPriceMinor\":12500}]}")
check "a quotation is recorded" "201" "$code"
QUOTE_A=$(jq_get "d['id']")

code=$(post "/procurement/quotations" "{\"purchaseRequestId\":\"$REQUEST_ID\",\"supplierId\":\"$SUPPLIER_B\",\"lines\":[{\"description\":\"Hospital bed\",\"quantity\":10,\"unitPriceMinor\":45000},{\"description\":\"Roofing sheet\",\"quantity\":40,\"unitPriceMinor\":12000}]}")
QUOTE_B=$(jq_get "d['id']")
note "quote A $(jq_get "d['totalMinor']") vs quote B"

code=$(post "/procurement/quotations/$QUOTE_A/select" '{}')
check "choosing other than the cheapest without a reason is refused" "400" "$code"

code=$(post "/procurement/quotations/$QUOTE_A/select" '{"selectionReason":"Only supplier who can deliver before the rains; the cheaper quote is eight weeks out."}')
check "with a reason it is accepted" "200" "$code"
check "and it is recorded that this was not the cheapest" "False" "$(jq_get "d['wasCheapest']")"

code=$(post "/procurement/orders" "{\"purchaseRequestId\":\"$REQUEST_ID\",\"quotationId\":\"$QUOTE_A\",\"orderedOn\":\"2026-09-15\"}")
check "the order is placed" "201" "$code"
ORDER_ID=$(jq_get "d['id']")
BED_LINE=$(jq_get "[l for l in d['lines'] if l['description']=='Hospital bed'][0]['id']")
SHEET_LINE=$(jq_get "[l for l in d['lines'] if l['description']=='Roofing sheet'][0]['id']")
check_true "the bed line is marked capital, the sheets are not" "$(jq_get "[l for l in d['lines'] if l['description']=='Hospital bed'][0]['isCapitalItem'] and not [l for l in d['lines'] if l['description']=='Roofing sheet'][0]['isCapitalItem']")"

echo
echo "=== An invoice with nothing received cannot be paid ==="
code=$(post "/procurement/invoices" "{\"supplierId\":\"$SUPPLIER_A\",\"purchaseOrderId\":\"$ORDER_ID\",\"invoiceNumber\":\"INV-EARLY\",\"invoiceDate\":\"2026-09-16\",\"amountMinor\":1000000,\"taxMinor\":0,\"totalMinor\":1000000}")
check "the invoice is recorded" "201" "$code"
EARLY_INVOICE=$(jq_get "d['id']")
check "and immediately blocked by the match" "BLOCKED" "$(jq_get "d['matchStatus']")"
note "$(jq_get "d['match']['findings'][0]['detail']")"

code=$(post_fin "/procurement/invoices/$EARLY_INVOICE/pay" '{"amountMinor":1000000,"method":"BANK_TRANSFER"}')
check "paying it is refused" "409" "$code"
check_true "as a named business rule" "$(jq_get "d['type'].endswith('three-way-match-failed')")"

echo
echo "=== Goods receipt creates an asset (criterion E) ==="
code=$(post "/procurement/receipts" "{\"purchaseOrderId\":\"$ORDER_ID\",\"receivedOn\":\"2026-09-20\",\"lines\":[{\"purchaseOrderLineId\":\"$BED_LINE\",\"description\":\"Hospital bed\",\"quantityReceived\":10,\"quantityAccepted\":10,\"quantityRejected\":0,\"unitCostMinor\":50000,\"isCapitalItem\":true},{\"purchaseOrderLineId\":\"$SHEET_LINE\",\"description\":\"Roofing sheet\",\"quantityReceived\":40,\"quantityAccepted\":38,\"quantityRejected\":2,\"rejectionReason\":\"Two sheets arrived creased along the ridge.\",\"unitCostMinor\":12500,\"isCapitalItem\":false}]}")
check "the goods are received" "201" "$code"
check "ten capital units became ten assets" "10" "$(jq_get "len(d['assetsCreated'])")"
note "$(jq_get "d['note']")"

code=$(post "/procurement/receipts" "{\"purchaseOrderId\":\"$ORDER_ID\",\"receivedOn\":\"2026-09-20\",\"lines\":[{\"description\":\"Mystery item\",\"quantityReceived\":5,\"quantityAccepted\":3,\"quantityRejected\":0,\"unitCostMinor\":100}]}")
check "a receipt that does not account for every unit is refused" "400" "$code"

code=$(post "/procurement/receipts" "{\"purchaseOrderId\":\"$ORDER_ID\",\"receivedOn\":\"2026-09-20\",\"lines\":[{\"description\":\"Mystery item\",\"quantityReceived\":5,\"quantityAccepted\":3,\"quantityRejected\":2,\"unitCostMinor\":100}]}")
check "rejecting without saying why is refused" "400" "$code"

code=$(status "$API/assets?facilityId=$FACILITY_ID")
check "the asset register reads back" "200" "$code"
check "with ten assets on it" "10" "$(jq_get "d['serviceReadiness']['total']")"
check "none of them yet usable" "0" "$(jq_get "d['serviceReadiness']['commissioned']")"
ASSET_ID=$(jq_get "d['assets'][0]['id']")
ASSET_TAG=$(jq_get "d['assets'][0]['assetTag']")
check_true "each traces back to the order that bought it" "$(jq_get "d['assets'][0]['provenance']['purchaseOrder'].startswith('PO-')")"
note "$(jq_get "d['serviceReadiness']['note']")"

echo
echo "=== An asset is usable only when every check passes (criterion F) ==="
code=$(post "/assets/$ASSET_ID/advance" '{"status":"COMMISSIONED"}')
check "it cannot be commissioned straight from RECEIVED" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

code=$(post "/assets/$ASSET_ID/advance" '{"status":"INSTALLED"}')
check "it is installed" "200" "$code"

code=$(post "/assets/$ASSET_ID/commissioning" '{"functionalTestPassed":true,"safetyCheckPassed":true,"staffTrained":true,"consumablesAvailable":true,"utilitiesConnected":false}')
check "four of five checks are recorded" "200" "$code"
check "and it is not ready" "False" "$(jq_get "d['readiness']['ready']")"
note "$(jq_get "d['nextStep']")"

code=$(post "/assets/$ASSET_ID/advance" '{"status":"TESTED"}')
check "it is tested" "200" "$code"

code=$(post "/assets/$ASSET_ID/advance" '{"status":"COMMISSIONED"}')
check "but cannot be commissioned on four of five" "400" "$code"

code=$(post "/assets/$ASSET_ID/commissioning" '{"functionalTestPassed":true,"safetyCheckPassed":true,"staffTrained":true,"consumablesAvailable":true,"utilitiesConnected":true}')
check "the last check is recorded" "200" "$code"
check_true "and now it is ready" "$(jq_get "d['readiness']['ready']")"

code=$(post "/assets/$ASSET_ID/advance" '{"status":"COMMISSIONED"}')
check "now it can be commissioned" "200" "$code"
note "$(jq_get "d['note']")"

code=$(status "$API/assets?facilityId=$FACILITY_ID")
check "one asset now counts toward service readiness" "1" "$(jq_get "d['serviceReadiness']['commissioned']")"
check "and nine do not" "9" "$(jq_get "d['serviceReadiness']['awaitingCommissioning']")"

echo
echo "=== The three-way match releases payment ==="
code=$(post "/procurement/invoices" "{\"supplierId\":\"$SUPPLIER_A\",\"purchaseOrderId\":\"$ORDER_ID\",\"invoiceNumber\":\"INV-GOOD\",\"invoiceDate\":\"2026-09-21\",\"amountMinor\":975000,\"taxMinor\":0,\"totalMinor\":975000}")
check "an invoice for what was accepted is recorded" "201" "$code"
GOOD_INVOICE=$(jq_get "d['id']")
note "500,000 of beds plus 475,000 of sheets accepted = $(jq_get "d['match']['receivedValueMinor']")"

code=$(status "$API/procurement/invoices/$GOOD_INVOICE/match")
check "the match reads back" "200" "$code"
check "it is not blocked" "VARIANCE" "$(jq_get "d['status']")"
note "$(jq_get "'; '.join(f[\"code\"] for f in d['findings'])")"

code=$(post "/procurement/invoices/$GOOD_INVOICE/pay" '{"amountMinor":975000,"method":"BANK_TRANSFER","varianceApprovalReason":"Two sheets were rejected and credited separately."}')
check "the project manager cannot raise a payment" "403" "$code"

code=$(post_fin "/procurement/invoices/$GOOD_INVOICE/pay" '{"amountMinor":975000,"method":"BANK_TRANSFER"}')
check "raising it without accepting the variance is refused" "400" "$code"

code=$(post_fin "/procurement/invoices/$GOOD_INVOICE/pay" '{"amountMinor":975000,"method":"BANK_TRANSFER","varianceApprovalReason":"Two sheets were rejected; the supplier has agreed a credit note."}')
check "the finance officer raises it" "200" "$code"
PAYMENT_ID=$(jq_get "d['paymentId']")
check "it is not yet approved" "False" "$(jq_get "d['approved']")"
note "$(jq_get "d['note']")"

code=$(post_fin "/procurement/payments/$PAYMENT_ID/approve" '{}')
check "the person who raised it cannot approve it" "403" "$code"

code=$(post_adm "/procurement/payments/$PAYMENT_ID/approve" '{"note":"Checked against the delivery note."}')
check "a second person can" "200" "$code"
check_true "and it is released" "$(jq_get "d['approved']")"

code=$(post_fin "/procurement/invoices/$GOOD_INVOICE/pay" '{"amountMinor":975000,"method":"BANK_TRANSFER","varianceApprovalReason":"Trying to pay the same invoice twice."}')
check "paying the same invoice twice is refused" "409" "$code"

echo
echo "=== Maintenance ==="
code=$(post "/assets/maintenance" "{\"assetId\":\"$ASSET_ID\",\"maintenanceType\":\"PREVENTIVE\",\"performedOn\":\"2026-09-22\",\"description\":\"Initial service\",\"nextDueOn\":\"2026-03-22\"}")
check "maintenance is recorded" "201" "$code"

code=$(status "$API/assets/maintenance/due?facilityId=$FACILITY_ID")
check "the due list reads back" "200" "$code"
check_true "and a past date shows as overdue" "$(jq_get "d[0]['overdue']")"

echo
echo "=== Audit ==="
AUDIT=$(psql_run "SELECT action FROM audit.audit_log WHERE action LIKE 'procurement%' OR action LIKE 'project%' OR action LIKE 'asset%' GROUP BY action ORDER BY action")
echo "$AUDIT" | sed 's/^/        /'
for expected in "project.create" "procurement.request.decide" "procurement.quotation.select" "procurement.receipt.create" "asset.advance" "procurement.payment.raise" "procurement.payment.approve"; do
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
