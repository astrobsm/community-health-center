#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 5 chain, against a RUNNING API, a REAL
# database and REAL object storage:
#
#   generate from thin data -> gaps block submission -> fill the data ->
#   regenerate -> submit -> approve -> immutable -> regenerate supersedes ->
#   MOU carries the draft banner -> executed copy does not
#
# The acceptance criterion this proves (docs/architecture/21-development-roadmap.md):
#
#   "a full proposal generates from real data with every figure classified;
#    missing data renders as an explicit gap and blocks submission; an approved
#    version cannot be modified; the MOU carries the draft banner on every page."
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
  -d "{\"email\":\"$PM_EMAIL\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-doc\"}" "$API/auth/login" >/dev/null
PM_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$PM_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  project manager signed in"; } \
                   || { FAIL=$((FAIL+1)); echo "  FAIL  project manager could not sign in"; }

curl -s -o login.json -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke-doc\"}" "$API/auth/login" >/dev/null
ENROL=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
SECRET=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
CHALLENGE=$(python -c "import json;print(json.load(open('login.json')).get('mfaToken',''))" 2>/dev/null)

if [ -n "$ENROL" ]; then
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"enrolmentToken\":\"$ENROL\",\"code\":\"$CODE\",\"deviceId\":\"smoke-doc\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
elif [ -n "$CHALLENGE" ]; then
  SECRET=$(psql_run "SELECT mfa_secret FROM core.app_user WHERE email='$ADMIN_EMAIL'" | tr -d '[:space:]')
  CODE=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$SECRET")
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"mfaToken\":\"$CHALLENGE\",\"code\":\"$CODE\",\"deviceId\":\"smoke-doc\"}" "$API/auth/mfa/verify" >/dev/null
fi
ADMIN_TOKEN=$(python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null)
[ -n "$ADMIN_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  administrator signed in"; } \
                      || { FAIL=$((FAIL+1)); echo "  FAIL  administrator could not sign in"; }

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== A document type whose data does not exist yet ==="
code=$(post "/documents/generate" "{\"facilityId\":\"$FACILITY_ID\",\"documentType\":\"MONTHLY_REPORT\"}")
check "is refused, rather than produced empty" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 110)"

code=$(post "/documents/generate" "{\"facilityId\":\"$FACILITY_ID\",\"documentType\":\"MOU\"}")
check "an MOU is not produced through the report endpoint" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 110)"

echo
echo "=== Missing data renders as a gap and blocks submission (spec section 82) ==="
code=$(post "/documents/generate" "{\"facilityId\":\"$FACILITY_ID\",\"documentType\":\"FULL_PROPOSAL\"}")
check "a proposal generates even with nothing behind it" "200" "$code"
PROPOSAL_ID=$(jq_get "d['documentId']")
check "but it is not complete" "False" "$(jq_get "d['submission']['canSubmit']")"
check "and the threshold is stated" "95" "$(jq_get "d['submission']['threshold']")"
note "$(jq_get "d['submission']['reason']" | head -c 120)"
note "gaps: $(jq_get "', '.join(g['label'] for g in d['completeness']['gaps'][:4])")"

code=$(post "/documents/$PROPOSAL_ID/submit" '{}')
check "submitting it is refused" "422" "$code"
check_true "as a named business rule, not a generic failure" "$(jq_get "d['type'].endswith('document-incomplete')")"
check "and the gaps travel with the refusal" "4" "$(jq_get "len(d['gaps'])")"

code=$(status "$API/documents/$PROPOSAL_ID/content")
check "the rendered document reads back" "200" "$code"
python - <<'PYEOF'
import json
d = json.load(open('body.json'))
html = d['html']
checks = [
    ('says DATA NOT CAPTURED', 'DATA NOT CAPTURED' in html),
    ('never renders a gap as zero', '>0<' not in html.split('data-gap="true"')[1].split('</dd>')[0] if 'data-gap="true"' in html else False),
    ('says what would fix it', 'generate this report again' in html),
    ('lists the gaps in the appendix', 'Outstanding data (' in html),
]
open('checks.json','w').write(json.dumps(checks))
PYEOF
python -c "
import json
for name, ok in json.load(open('checks.json')):
    print(('  PASS  ' if ok else '  FAIL  ') + name)
" | tee gapchecks.txt
PASS=$((PASS + $(grep -c 'PASS' gapchecks.txt)))
FAIL=$((FAIL + $(grep -c 'FAIL' gapchecks.txt)))

echo
echo "=== Real data behind the figures ==="
code=$(post "/findings" "{\"facilityId\":\"$FACILITY_ID\",\"title\":\"Labour room roof leaks\",\"severity\":\"HIGH\"}")
FINDING_ID=$(jq_get "d['id']")
code=$(post "/needs" "{\"facilityId\":\"$FACILITY_ID\",\"findingId\":\"$FINDING_ID\",\"title\":\"Weatherproof the labour room\"}")
NEED_ID=$(jq_get "d['id']")
code=$(post "/recommendations" "{\"needId\":\"$NEED_ID\",\"title\":\"Replace roof sheets and ceiling\"}")
RECOMMENDATION_ID=$(jq_get "d['id']")
code=$(post "/capex-plans" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Revitalisation phase 1\"}")
PLAN_ID=$(jq_get "d['id']")
code=$(post "/capex-plans/lines" "{\"capexPlanId\":\"$PLAN_ID\",\"recommendationId\":\"$RECOMMENDATION_ID\",\"category\":\"BUILDING\",\"description\":\"Roof sheets and ceiling\",\"quantity\":1,\"unitCostMinor\":180000000,\"priorityClass\":\"P1\",\"costBasis\":\"Quotation from Ikem Roofing\"}")
check "a costed capital line exists" "201" "$code"

echo
echo "=== A capital plan generated from it ==="
code=$(post "/documents/generate" "{\"facilityId\":\"$FACILITY_ID\",\"documentType\":\"CAPITAL_PLAN\"}")
check "the capital plan generates" "200" "$code"
CAPEX_DOC_ID=$(jq_get "d['documentId']")
check "it is complete" "True" "$(jq_get "d['submission']['canSubmit']")"
check "and every figure is classified" "0" "$(jq_get "len(d['completeness']['gaps'])")"
note "classifications: $(jq_get "d['completeness']['classificationSummary']")"
note "weakest basis: $(jq_get "d['completeness']['weakestClassification']")"
CAPEX_HASH=$(jq_get "d['contentHash']")
note "content hash $CAPEX_HASH"

code=$(status "$API/documents/$CAPEX_DOC_ID/content")
check "the artefact reads back from storage" "200" "$code"
check "with the hash it was issued under" "$CAPEX_HASH" "$(jq_get "d['contentHash']")"
check_true "the hash is embedded in the document itself" "$(jq_get "d['contentHash'] in d['html']")"
check_true "every figure carries a classification" "$(jq_get "'data-classification=' in d['html']")"
check_true "the provenance block names who generated it" "$(jq_get "'Document provenance' in d['html'] and 'Project Manager' in d['html']")"
check_true "and says it is not approved" "$(jq_get "'not approved' in d['html']")"
check_true "it states the total is a sum of its own lines" "$(jq_get "'Sum of 1 line' in d['html']")"

echo
echo "=== Approval is somebody else's job ==="
code=$(post "/documents/$CAPEX_DOC_ID/submit" '{}')
check "the project manager submits it" "200" "$code"

code=$(post "/documents/$CAPEX_DOC_ID/decide" '{"decision":"APPROVED"}')
check "the generator cannot approve their own document" "403" "$code"

code=$(post_adm "/documents/$CAPEX_DOC_ID/decide" '{"decision":"REJECTED"}')
check "rejecting without a reason is refused" "400" "$code"

code=$(post_adm "/documents/$CAPEX_DOC_ID/decide" '{"decision":"APPROVED","note":"Reviewed against the quotation."}')
check "the administrator approves it" "200" "$code"
check "the version is APPROVED" "APPROVED" "$(jq_get "d['status']")"
note "$(jq_get "d['note']")"

echo
echo "=== An approved version cannot be modified (spec section 50) ==="
VERSION_ID=$(psql_run "SELECT id FROM qual.document_version WHERE document_id='$CAPEX_DOC_ID' AND status='APPROVED'" | tr -d '[:space:]')
out=$(psql_run "UPDATE qual.document_version SET content_hash='sha256:tampered' WHERE id='$VERSION_ID'")
if echo "$out" | grep -q "immutable"; then
  PASS=$((PASS+1)); echo "  PASS  the database refuses to alter it"
  note "$(echo "$out" | grep -m1 ERROR | cut -c1-110)"
else
  FAIL=$((FAIL+1)); echo "  FAIL  an approved version was altered: $out"
fi

echo
echo "=== Regenerating supersedes rather than overwrites ==="
code=$(post "/documents/generate" "{\"facilityId\":\"$FACILITY_ID\",\"documentType\":\"CAPITAL_PLAN\"}")
check "a second version generates" "200" "$code"
check "it is version 2" "2" "$(jq_get "d['versionNumber']")"

code=$(status "$API/documents/$CAPEX_DOC_ID/content?version=1")
check "version 1 is still retrievable" "200" "$code"
check "and is still marked APPROVED" "APPROVED" "$(jq_get "d['status']")"

echo
echo "=== The MOU (spec section 52) ==="
code=$(post_adm "/partnerships" "{\"facilityId\":\"$FACILITY_ID\",\"name\":\"Ikem revitalisation partnership\",\"commencementDate\":\"2026-10-01\",\"termMonths\":120}")
PARTNERSHIP_ID=$(jq_get "d['id']")

code=$(post_adm "/contracts/generate" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"contractType\":\"MOU\"}")
check "an MOU with one party is refused" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

code=$(post_adm "/partnerships/parties" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyRole\":\"GOVERNMENT\",\"legalName\":\"Enugu State Ministry of Health\",\"representative\":\"The Honourable Commissioner\"}")
GOV_ID=$(jq_get "d['id']")
code=$(post_adm "/partnerships/parties" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyRole\":\"PARTNER\",\"legalName\":\"Bonnesante Medicals Ltd\"}")
PARTNER_ID=$(jq_get "d['id']")

STEPS="[
  {\"sequence\":1,\"label\":\"Staff incentives\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.1,\"capMinor\":2000000},
  {\"sequence\":2,\"label\":\"Government entitlement\",\"basis\":\"OPERATING_SURPLUS\",\"rate\":0.4,\"beneficiaryPartyId\":\"$GOV_ID\"},
  {\"sequence\":3,\"label\":\"Partner capital recovery\",\"basis\":\"RESIDUAL\",\"isCapitalRecovery\":true,\"beneficiaryPartyId\":\"$PARTNER_ID\"}
]"
code=$(post_adm "/partnerships/revenue-share-models" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"name\":\"Agreed terms\",\"shareType\":\"SURPLUS_SHARE\",\"effectiveFrom\":\"2026-10-01\",\"steps\":$STEPS}")
check "the agreed waterfall is recorded" "201" "$code"

code=$(post_adm "/partnerships/obligations" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"partyId\":\"$GOV_ID\",\"description\":\"Second four nursing staff to the facility\",\"dueDate\":\"2026-11-30\"}")

code=$(post_adm "/contracts/generate" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"contractType\":\"MOU\"}")
check "the MOU generates" "200" "$code"
CONTRACT_ID=$(jq_get "d['contractId']")
note "$(jq_get "d['clauseCount']") clauses, reference $(jq_get "d['reference']")"

code=$(status_adm "$API/contracts/$CONTRACT_ID/content")
check "it reads back" "200" "$code"
python - <<'PYEOF'
import json
d = json.load(open('body.json'))
html = d['html']
# Matched without the em dash: how Windows decodes this heredoc is not the
# subject of the test, and a mis-decoded literal would fail a banner that is
# actually present.
banner = 'SUBJECT TO LEGAL, GOVERNMENT AND PROFESSIONAL REVIEW'
sections = html.count('<section class="document-section"')
banner_divs = html.count('class="draft-banner"') + html.count('draft-banner page-banner')
checks = [
    ('the draft banner is present', banner in html),
    ('it appears on every section, not only the first', banner_divs >= sections + 1),
    ('it is fixed to every page when printed', '.draft-banner { position: fixed;' in html),
    ('the requirement is in the document metadata', 'data-draft-banner="required"' in html),
    ('the waterfall in the clause matches the one configured', '40% of the operating surplus' in html),
    ('a capped step says so', 'capped at NGN 20,000.00' in html),
    ('the capital recovery step is limited to what is outstanding', 'limited to the capital then outstanding' in html),
    ('the recorded obligation appears as a clause', 'second four nursing staff' in html),
    ('no clause asserts what the law requires', 'does not determine which requirements apply' in html),
    ('the legal review notice is carried', 'SUBJECT TO APPLICABLE LAW' in html),
    ('it is titled as people actually refer to it', 'Memorandum of Understanding' in html),
]
open('checks.json','w').write(json.dumps(checks))
PYEOF
python -c "
import json
for name, ok in json.load(open('checks.json')):
    print(('  PASS  ' if ok else '  FAIL  ') + name)
" | tee mouchecks.txt
PASS=$((PASS + $(grep -c 'PASS' mouchecks.txt)))
FAIL=$((FAIL + $(grep -c 'FAIL' mouchecks.txt)))

echo
echo "=== The banner comes off only on execution ==="
code=$(post_adm "/contracts/$CONTRACT_ID/execute" '{"storageKey":"document/signed/mou-001.pdf","effectiveFrom":"2026-10-01","signatories":[{"name":"The Honourable Commissioner","title":"Commissioner for Health","signedOn":"2026-09-30"}]}')
check "executing with one signatory is refused" "400" "$code"

code=$(post_adm "/contracts/$CONTRACT_ID/execute" '{"storageKey":"document/signed/mou-001.pdf","effectiveFrom":"2026-10-01","signatories":[{"name":"The Honourable Commissioner","title":"Commissioner for Health","signedOn":"2026-09-30"},{"name":"A. Director","title":"Managing Director","signedOn":"2026-09-30"}]}')
check "with the signed file and two signatories it is accepted" "200" "$code"
EXECUTED_VERSION=$(jq_get "d['versionNumber']")

code=$(status_adm "$API/contracts/$CONTRACT_ID/content?version=$EXECUTED_VERSION")
check "the executed copy reads back" "200" "$code"
check_true "and carries no draft banner" "$(jq_get "'GOVERNMENT AND PROFESSIONAL REVIEW' not in d['html']")"
check_true "it is marked as the executed copy" "$(jq_get "d['isExecutedCopy']")"

code=$(status_adm "$API/contracts/$CONTRACT_ID/content?version=1")
check_true "the negotiated draft still carries its banner" "$(jq_get "'GOVERNMENT AND PROFESSIONAL REVIEW' in d['html']")"

code=$(post_adm "/contracts/generate" "{\"partnershipId\":\"$PARTNERSHIP_ID\",\"contractType\":\"MOU\"}")
check "an executed agreement cannot be redrafted" "409" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

echo
echo "=== Audit ==="
AUDIT=$(psql_run "SELECT action FROM audit.audit_log WHERE action LIKE 'document%' OR action LIKE 'contract%' GROUP BY action ORDER BY action")
echo "$AUDIT" | sed 's/^/        /'
for expected in "document.generate" "document.submit" "document.approve" "contract.generate" "contract.execute"; do
  if echo "$AUDIT" | grep -q "^$expected$"; then
    PASS=$((PASS+1)); printf '  PASS  audited: %s\n' "$expected"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  not audited: %s\n' "$expected"
  fi
done

rm -f body.json login.json checks.json gapchecks.txt mouchecks.txt

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
