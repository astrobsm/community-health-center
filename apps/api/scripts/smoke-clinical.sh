#!/usr/bin/env bash
#
# End-to-end smoke test of the Release 7 chain, against a RUNNING API and a
# REAL database:
#
#   duplicate check -> registration -> consent -> encounter -> triage (BMI) ->
#   note -> sign -> amend -> diagnosis -> close -> timeline -> merge ->
#   consent withdrawal
#
# The acceptance criteria this proves (docs/architecture/21-development-roadmap.md):
#
#   an amendment preserves every prior version; the timeline renders a complete
#   patient history; a consent withdrawal takes effect immediately.
#
# The offline half of the criterion is covered by the Playwright suite and the
# outbox tests from Release 2, which this release's records travel through
# unchanged.
#
# Prerequisites: bash scripts/setup-local-demo.sh, then scripts/run-local.sh.
set -u

API="${API_BASE:-http://127.0.0.1:3100}/api/v1"
PGCONTAINER="${PGCONTAINER:-chc-mig-test}"
PM_PASSWORD="${PM_PASSWORD:-correct-horse-battery-staple}"

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

status()  { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $DOC_TOKEN" "$@"; }
status2() { curl -s -o body.json -w '%{http_code}' -H "Authorization: Bearer $DOC2_TOKEN" "$@"; }
post()    { status -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }
post2()   { status2 -X POST -H 'Content-Type: application/json' -d "$2" "$API$1"; }

seed_user() {
  EMAIL="$1" PASSWORD="$PM_PASSWORD" NAME="$2" ROLE="$3" \
    FACILITY_CODE="${FACILITY_CODE:-CHC-IKEM}" \
    DATABASE_URL="postgresql://chc_migrator:testpw@localhost:55432/chc" \
    ../../node_modules/.bin/tsx prisma/seed/create-user.ts >/dev/null 2>&1
}

sign_in() {
  curl -s -o login.json -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PM_PASSWORD\",\"deviceId\":\"smoke-clin\"}" "$API/auth/login" >/dev/null
  local enrol secret code
  enrol=$(python -c "import json;print(json.load(open('login.json')).get('enrolmentToken',''))" 2>/dev/null)
  secret=$(python -c "import json;print(json.load(open('login.json')).get('secret',''))" 2>/dev/null)
  if [ -n "$enrol" ]; then
    code=$(node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(process.argv[1])}).generate())" "$secret")
    curl -s -o login.json -X POST -H 'Content-Type: application/json' \
      -d "{\"enrolmentToken\":\"$enrol\",\"code\":\"$code\",\"deviceId\":\"smoke-clin\"}" "$API/auth/mfa/enrol/confirm" >/dev/null
  fi
  python -c "import json;print(json.load(open('login.json')).get('accessToken',''))" 2>/dev/null
}

echo
echo "=== Two clinicians, because a record belongs to whoever wrote it ==="
seed_user "clinician@example.org" "Dr A. Okafor" CLINICIAN
seed_user "clinician2@example.org" "Dr B. Nwosu" CLINICAL_LEAD

DOC_TOKEN=$(sign_in "clinician@example.org")
DOC2_TOKEN=$(sign_in "clinician2@example.org")
[ -n "$DOC_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  the clinician signed in"; } \
                    || { FAIL=$((FAIL+1)); echo "  FAIL  the clinician could not sign in"; }
[ -n "$DOC2_TOKEN" ] && { PASS=$((PASS+1)); echo "  PASS  the clinical lead signed in"; } \
                     || { FAIL=$((FAIL+1)); echo "  FAIL  the clinical lead could not sign in"; }

code=$(status "$API/facilities")
FACILITY_ID=$(jq_get "d[0]['id']")
note "facility $(jq_get "d[0]['code']")"

echo
echo "=== Registration guards against duplicates without blocking care ==="
code=$(post "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Ada\",\"familyName\":\"Chukwu\",\"dateOfBirth\":\"1990-04-12\",\"sex\":\"FEMALE\",\"phone\":\"08031234567\"}")
check "a patient is registered" "201" "$code"
PATIENT_ID=$(jq_get "d['id']")
MRN=$(jq_get "d['mrn']")
note "MRN $MRN"

code=$(post "/patients/duplicate-check" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Ada\",\"familyName\":\"Chuku\",\"dateOfBirth\":\"1990-04-12\"}")
check "a near-match is surfaced before registering" "200" "$code"
check "with one candidate" "1" "$(jq_get "len(d)")"
note "$(jq_get "d[0]['reasons'][0] if d else ''")"

code=$(post "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Ada\",\"familyName\":\"Chuku\",\"dateOfBirth\":\"1990-04-12\",\"sex\":\"FEMALE\"}")
check "registration proceeds anyway" "201" "$code"
DUPLICATE_ID=$(jq_get "d['id']")
check "and the pair is flagged for review" "1" "$(jq_get "len(d['duplicateCandidates'])")"
note "$(jq_get "d.get('note','')" | head -c 110)"

code=$(post "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"Emeka\",\"familyName\":\"Obi\",\"ageYears\":40,\"sex\":\"MALE\"}")
check "a patient with only an age is registered" "201" "$code"
AGE_ONLY_ID=$(jq_get "d['id']")
check_true "and the date of birth is marked an estimate" "$(jq_get "d['dateOfBirthEstimated']")"
note "$(jq_get "d.get('dateOfBirthNote','')")"

code=$(post "/patients" "{\"facilityId\":\"$FACILITY_ID\",\"givenName\":\"No\",\"familyName\":\"Age\",\"sex\":\"MALE\"}")
check "a patient with neither a date of birth nor an age is refused" "400" "$code"

code=$(status "$API/patients/$PATIENT_ID")
check "the patient reads back" "200" "$code"
check "with an age computed from a recorded date" "RECORDED" "$(jq_get "d['age']['basis']")"

echo
echo "=== Consent gates care (spec section 84) ==="
code=$(post "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Fever for three days\"}")
check "an encounter without consent is refused" "403" "$code"
note "$(jq_get "d.get('detail','')" | head -c 120)"

code=$(post "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"TREATMENT\",\"granted\":true,\"privacyNoticeVersion\":\"v1\"}")
check "treatment consent is recorded" "201" "$code"
code=$(post "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"DATA_STORAGE\",\"granted\":true,\"privacyNoticeVersion\":\"v1\"}")
check "so is consent to keep the record" "201" "$code"
code=$(post "/patients/consents" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"SMS_CONTACT\",\"granted\":true,\"privacyNoticeVersion\":\"v1\"}")
check "and the optional one" "201" "$code"

code=$(post "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Fever for three days\"}")
check "now the encounter opens" "201" "$code"
ENCOUNTER_ID=$(jq_get "d['id']")
note "$(jq_get "d['reference']")"

echo
echo "=== Triage: BMI is computed, never typed ==="
code=$(post "/encounters/triage" "{\"encounterId\":\"$ENCOUNTER_ID\",\"systolicBp\":118,\"diastolicBp\":76,\"pulse\":88,\"temperatureC\":38.4,\"weightKg\":62,\"heightCm\":165,\"triageCategory\":\"YELLOW\"}")
check "vitals are recorded" "201" "$code"
check "and the database computed the BMI" "22.77" "$(jq_get "d['bmi']")"
note "$(jq_get "d['bmiNote']")"

echo
echo "=== A note is a draft until it is signed (spec section 43) ==="
code=$(post "/encounters/notes" "{\"encounterId\":\"$ENCOUNTER_ID\",\"presentingComplaint\":\"Fever, headache\",\"assessment\":\"Malaria\",\"plan\":\"ACT, review in 3 days\",\"allergies\":\"Penicillin\"}")
check "a note is created as a draft" "201" "$code"
NOTE_ID=$(jq_get "d['id']")
check "in DRAFT" "DRAFT" "$(jq_get "d['status']")"

code=$(status "$API/patients/$PATIENT_ID")
check_true "the allergy was promoted to the patient record" "$(jq_get "'Penicillin' in (d['allergySummary'] or '')")"

code=$(post "/encounters/notes/$NOTE_ID/update" '{"assessment":"Malaria, uncomplicated"}')
check "its author may edit it freely" "200" "$code"

code=$(post2 "/encounters/notes/$NOTE_ID/update" '{"assessment":"Somebody else editing"}')
check "another clinician may not" "409" "$code"
note "$(jq_get "d.get('detail','')" | head -c 100)"

code=$(post "/encounters/notes/$NOTE_ID/sign" '{}')
check "the author signs it" "200" "$code"
note "$(jq_get "d['note']")"

code=$(post "/encounters/notes/$NOTE_ID/update" '{"assessment":"Trying to edit after signing"}')
check "and now nobody may edit it" "409" "$code"
check_true "as a named rule, not a generic conflict" "$(jq_get "d['type'].endswith('clinical-record-immutable')")"

echo
echo "=== An amendment preserves every prior version ==="
code=$(post "/encounters/notes/$NOTE_ID/amend" '{"assessment":"Typhoid"}')
check "an amendment with no reason is refused" "400" "$code"

code=$(post "/encounters/notes/$NOTE_ID/amend" '{"assessment":"Typhoid","amendmentReason":"Blood film negative; widal positive on the repeat sample."}')
check "an amendment with a reason is accepted" "200" "$code"
AMENDMENT_ID=$(jq_get "d['id']")
check "and it supersedes the original" "$NOTE_ID" "$(jq_get "d['supersedes']")"
note "$(jq_get "d['note']")"

code=$(post "/encounters/notes/$NOTE_ID/amend" '{"assessment":"Something else","amendmentReason":"Trying to fork the chain in two."}')
check "amending a superseded version is refused" "400" "$code"

code=$(post "/encounters/notes/$AMENDMENT_ID/amend" '{"plan":"Ciprofloxacin","amendmentReason":"Changed the antibiotic after the sensitivity came back."}')
check "amending the current version is accepted" "200" "$code"

echo
echo "=== Diagnoses amend rather than overwrite (doc 13 section 7) ==="
code=$(post "/encounters/diagnoses" "{\"encounterId\":\"$ENCOUNTER_ID\",\"term\":\"Malaria\",\"code\":\"B54\",\"diagnosisType\":\"PROVISIONAL\"}")
check "a provisional diagnosis is recorded" "201" "$code"
DIAGNOSIS_ID=$(jq_get "d['id']")

code=$(post "/encounters/diagnoses/$DIAGNOSIS_ID/amend" '{"diagnosisType":"RULED_OUT","amendmentReason":"Blood film negative on two occasions."}')
check "it is ruled out by amendment" "200" "$code"
check_true "with the earlier reasoning kept" "$(jq_get "'retained' in d['note']")"

echo
echo "=== Closing an encounter ==="
code=$(post "/encounters/$ENCOUNTER_ID/close" '{"disposition":"Discharged home"}')
check "closing is allowed once a diagnosis exists" "200" "$code"
note "$(jq_get "d.get('warning','no unsigned notes')" | head -c 100)"

code=$(post "/encounters" "{\"patientId\":\"$PATIENT_ID\",\"encounterType\":\"OPD\",\"chiefComplaint\":\"Dressing change\"}")
BARE_ENCOUNTER=$(jq_get "d['id']")
code=$(post "/encounters/$BARE_ENCOUNTER/close" '{"disposition":"Discharged home"}')
check "closing with no diagnosis and no explanation is refused" "400" "$code"
note "$(jq_get "d.get('detail','')" | head -c 110)"

code=$(post "/encounters/$BARE_ENCOUNTER/close" '{"disposition":"Discharged home","noDiagnosisReason":"Dressing change only; no new clinical problem."}')
check "with an explanation it closes" "200" "$code"

echo
echo "=== The timeline renders a complete history ==="
code=$(status "$API/encounters/timeline/$PATIENT_ID")
check "the timeline reads back" "200" "$code"
check "with both encounters" "2" "$(jq_get "len(d['encounters'])")"
check_true "the allergy is on the header" "$(jq_get "'Penicillin' in (d['patient']['allergySummary'] or '')")"
check "the note chain shows one current version" "1" "$(jq_get "len([n for n in d['encounters'][1]['notes'] if n['wasAmended']])")"
check "with two prior versions preserved" "2" "$(jq_get "[n for n in d['encounters'][1]['notes'] if n['wasAmended']][0]['amendmentCount']")"
check_true "and every superseding reason readable" "$(jq_get "'widal' in str([n for n in d['encounters'][1]['notes'] if n['wasAmended']][0]['priorVersions']).lower() or 'sensitivity' in str([n for n in d['encounters'][1]['notes'] if n['wasAmended']][0]['current']).lower()")"
check_true "the current assessment is the amended one" "$(jq_get "[n for n in d['encounters'][1]['notes'] if n['wasAmended']][0]['current']['assessment'] == 'Typhoid'")"

echo
echo "=== A consent withdrawal takes effect immediately ==="
code=$(status "$API/patients/$PATIENT_ID")
check_true "text messages are permitted" "$(jq_get "[c for c in d['consents'] if c['purpose']=='SMS_CONTACT'][0]['state'] == 'GRANTED'")"

code=$(post "/patients/consents/withdraw" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"SMS_CONTACT\",\"reason\":\"Patient asked for no more messages.\"}")
check "the patient withdraws it" "200" "$code"
note "$(jq_get "d['note']")"

code=$(status "$API/patients/$PATIENT_ID")
check "and it reads as withdrawn on the very next request" "WITHDRAWN" "$(jq_get "[c for c in d['consents'] if c['purpose']=='SMS_CONTACT'][0]['state']")"

code=$(post "/patients/consents/withdraw" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"TREATMENT\",\"reason\":\"Trying to switch off consent to care.\"}")
check "consent to treatment cannot be withdrawn here" "403" "$code"
note "$(jq_get "d.get('detail','')" | head -c 110)"

code=$(post "/patients/consents/withdraw" "{\"patientId\":\"$PATIENT_ID\",\"purpose\":\"DATA_STORAGE\",\"reason\":\"Trying to switch off record keeping.\"}")
check "nor can keeping the record" "403" "$code"

echo
echo "=== Merging keeps everything ==="
code=$(post "/patients/merge" "{\"survivorId\":\"$PATIENT_ID\",\"mergedId\":\"$DUPLICATE_ID\",\"reason\":\"Same person registered twice on the same day.\"}")
check "the clinician cannot merge" "403" "$code"

code=$(post2 "/patients/merge" "{\"survivorId\":\"$PATIENT_ID\",\"mergedId\":\"$DUPLICATE_ID\",\"reason\":\"Same person registered twice on the same day.\"}")
check "the clinical lead can" "200" "$code"
note "$(jq_get "d['note']" | head -c 120)"

code=$(status "$API/patients/search?facilityId=$FACILITY_ID&q=Chuku")
check "the merged record still answers to its old MRN" "200" "$code"
check_true "and is marked merged rather than missing" "$(jq_get "any(p['merged'] for p in d)")"

code=$(post "/encounters" "{\"patientId\":\"$DUPLICATE_ID\",\"encounterType\":\"OPD\"}")
check "an encounter cannot be opened on a tombstone" "400" "$code"

echo
echo "=== Audit ==="
AUDIT=$(psql_run "SELECT action FROM audit.audit_log WHERE action LIKE 'patient%' OR action LIKE 'encounter%' GROUP BY action ORDER BY action")
echo "$AUDIT" | sed 's/^/        /'
for expected in "patient.register" "patient.consent.record" "patient.consent.withdraw" "patient.merge" "patient.allergy.promote" "encounter.open" "encounter.note.amend"; do
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
