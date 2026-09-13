#!/usr/bin/env bash
#
# Release 0 acceptance: prove the database invariants actually hold.
#
# Every guarantee this product rests on lives in the database (see
# prisma/migrations/*_invariants/migration.sql). This script asserts that each
# forbidden operation is genuinely refused — a test that only checks the happy
# path would prove nothing about an invariant.
#
# Usage:
#   PGCONTAINER=chc-mig-test ./scripts/verify-invariants.sh
#
# Expects a freshly migrated database with scripts/fixtures.sql loaded.

set -uo pipefail

CONTAINER="${PGCONTAINER:-chc-mig-test}"
PGUSER="${PGUSER:-chc_migrator}"
PGDATABASE="${PGDATABASE:-chc}"

ORG_A=11111111-1111-1111-1111-111111111111
FAC_A=aaaaaaaa-0000-0000-0000-000000000001
PERIOD_OPEN=cccccccc-0000-0000-0000-000000000001
PERIOD_CLOSED=cccccccc-0000-0000-0000-000000000002
ACCT_CASH=dddddddd-0000-0000-0000-000000000001
ACCT_REV=dddddddd-0000-0000-0000-000000000002
BATCH=ffffffff-0000-0000-0000-000000000001
ENCOUNTER=88888888-0000-0000-0000-000000000002
PATIENT=88888888-0000-0000-0000-000000000001
STAFF=77777777-0000-0000-0000-000000000001

PASS=0
FAIL=0

psql_run() {
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" -q -c "$1" 2>&1
}

# The operation MUST be refused. If it succeeds, the invariant is not enforced.
must_fail() {
  local name="$1" sql="$2" out
  out=$(psql_run "$sql")
  if [ $? -ne 0 ]; then
    PASS=$((PASS + 1))
    printf '  PASS  %s\n' "$name"
    printf '        %s\n' "$(printf '%s' "$out" | grep -m1 -E 'ERROR' | cut -c1-130)"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %s  <-- the operation was ALLOWED\n' "$name"
  fi
}

must_succeed() {
  local name="$1" sql="$2" out
  out=$(psql_run "$sql")
  if [ $? -eq 0 ]; then
    PASS=$((PASS + 1))
    printf '  PASS  %s\n' "$name"
    printf '%s' "$out" | grep -E 'NOTICE' | head -1 | sed 's/^/        /'
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %s\n' "$name"
    printf '%s' "$out" | head -3 | sed 's/^/        /'
  fi
}

echo
echo "=== Double-entry (doc 12 section 5) ==="

must_fail "an unbalanced journal entry cannot commit" \
"BEGIN;
 INSERT INTO fin.journal_entry (id,organisation_id,facility_id,financial_period_id,reference,entry_date,description,source_type)
 VALUES ('12121212-0000-0000-0000-00000000000a','$ORG_A','$FAC_A','$PERIOD_OPEN','JE-UNBAL','2026-09-10','deliberately unbalanced','test');
 INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
 VALUES (gen_random_uuid(),'12121212-0000-0000-0000-00000000000a','$ACCT_CASH','$ORG_A','$FAC_A',100000,0);
 COMMIT;"

must_fail "a line cannot be both a debit and a credit" \
"INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
 VALUES (gen_random_uuid(),gen_random_uuid(),'$ACCT_CASH','$ORG_A','$FAC_A',500,500);"

must_succeed "a balanced journal entry commits" \
"BEGIN;
 INSERT INTO fin.journal_entry (id,organisation_id,facility_id,financial_period_id,reference,entry_date,description,source_type)
 VALUES ('12121212-0000-0000-0000-000000000001','$ORG_A','$FAC_A','$PERIOD_OPEN','JE-OK','2026-09-10','balanced','test');
 INSERT INTO fin.journal_line (id,journal_entry_id,financial_account_id,organisation_id,facility_id,debit_minor,credit_minor)
 VALUES (gen_random_uuid(),'12121212-0000-0000-0000-000000000001','$ACCT_CASH','$ORG_A','$FAC_A',200000,0),
        (gen_random_uuid(),'12121212-0000-0000-0000-000000000001','$ACCT_REV','$ORG_A','$FAC_A',0,200000);
 COMMIT;"

echo
echo "=== Append-only ledgers (doc 03 class 3) ==="

must_fail "journal_line cannot be updated" "UPDATE fin.journal_line SET debit_minor = 1 WHERE debit_minor = 200000;"
must_fail "journal_line cannot be deleted" "DELETE FROM fin.journal_line WHERE debit_minor = 200000;"
must_fail "journal_entry cannot be deleted" "DELETE FROM fin.journal_entry WHERE reference = 'JE-OK';"
must_fail "a posted journal entry cannot be edited" "UPDATE fin.journal_entry SET description = 'tampered' WHERE reference = 'JE-OK';"
must_succeed "an entry can be marked REVERSED with a reason" \
"UPDATE fin.journal_entry SET status='REVERSED', reversal_reason='test reversal' WHERE reference='JE-OK';"
must_fail "attendance cannot be updated" \
"INSERT INTO people.attendance (id,staff_id,organisation_id,facility_id,event_type,occurred_at)
 VALUES ('66666666-0000-0000-0000-000000000001','$STAFF','$ORG_A','$FAC_A','CLOCK_IN',now());
 UPDATE people.attendance SET event_type='CLOCK_OUT' WHERE id='66666666-0000-0000-0000-000000000001';"
must_fail "audit_log cannot be updated" \
"INSERT INTO audit.audit_log (id,organisation_id,facility_id,action,entity_type,trace_id,row_hash)
 VALUES ('10101010-0000-0000-0000-000000000001','$ORG_A','$FAC_A','test.action','test','trace-1','\\x00');
 UPDATE audit.audit_log SET action='tampered' WHERE id='10101010-0000-0000-0000-000000000001';"

echo
echo "=== Closed financial period (doc 12 section 1) ==="

must_fail "posting into a CLOSED period is refused" \
"INSERT INTO fin.journal_entry (id,organisation_id,facility_id,financial_period_id,reference,entry_date,description,source_type)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','$PERIOD_CLOSED','JE-CLOSED','2026-08-10','x','test');"

echo
echo "=== Stock ledger (doc 14) ==="

must_succeed "a receipt raises the batch balance" \
"INSERT INTO supply.stock_transaction (id,inventory_batch_id,organisation_id,facility_id,transaction_type,quantity,source_type)
 VALUES (gen_random_uuid(),'$BATCH','$ORG_A','$FAC_A','RECEIPT',100,'goods_receipt');"

must_succeed "the batch cache equals the ledger sum" \
"DO \$do\$
 DECLARE cache numeric; ledger numeric;
 BEGIN
   SELECT quantity_on_hand INTO cache FROM supply.inventory_batch WHERE id='$BATCH';
   SELECT COALESCE(SUM(quantity),0) INTO ledger FROM supply.stock_transaction WHERE inventory_batch_id='$BATCH';
   IF cache <> ledger THEN RAISE EXCEPTION 'cache % does not equal ledger %', cache, ledger; END IF;
   RAISE NOTICE 'cache=% ledger=% (agree)', cache, ledger;
 END \$do\$;"

must_fail "issuing more than is on hand is refused" \
"INSERT INTO supply.stock_transaction (id,inventory_batch_id,organisation_id,facility_id,transaction_type,quantity,source_type)
 VALUES (gen_random_uuid(),'$BATCH','$ORG_A','$FAC_A','ISSUE',-150,'dispensing');"

must_fail "an ADJUSTMENT without a reason and approver is refused" \
"INSERT INTO supply.stock_transaction (id,inventory_batch_id,organisation_id,facility_id,transaction_type,quantity,source_type)
 VALUES (gen_random_uuid(),'$BATCH','$ORG_A','$FAC_A','ADJUSTMENT',-5,'stock_adjustment');"

must_fail "a zero-quantity movement is refused" \
"INSERT INTO supply.stock_transaction (id,inventory_batch_id,organisation_id,facility_id,transaction_type,quantity,source_type)
 VALUES (gen_random_uuid(),'$BATCH','$ORG_A','$FAC_A','ISSUE',0,'dispensing');"

# Checked here, after a movement exists: an UPDATE matching zero rows fires no
# trigger and would pass vacuously.
must_fail "an existing stock movement cannot be altered" \
"UPDATE supply.stock_transaction SET quantity = 1 WHERE transaction_type = 'RECEIPT';"

must_fail "an existing stock movement cannot be deleted" \
"DELETE FROM supply.stock_transaction WHERE transaction_type = 'RECEIPT';"

echo
echo "=== Immutable baseline (spec section 12) ==="

must_fail "a sealed baseline metric cannot be edited" \
"UPDATE assess.baseline_metric SET numeric_value = 99 WHERE metric_code = 'patients_per_day';"
must_fail "a sealed baseline snapshot cannot be deleted" \
"DELETE FROM assess.baseline_snapshot WHERE sequence = 1;"

echo
echo "=== Derived clinical values (doc 13 section 5) ==="

must_succeed "BMI is computed by the database, not the caller" \
"DO \$do\$
 DECLARE value numeric;
 BEGIN
   INSERT INTO clinical.triage (id,encounter_id,organisation_id,facility_id,weight_kg,height_cm)
   VALUES ('44444444-0000-0000-0000-000000000001','$ENCOUNTER','$ORG_A','$FAC_A',70,170);
   SELECT bmi INTO value FROM clinical.triage WHERE id='44444444-0000-0000-0000-000000000001';
   IF value IS NULL OR ROUND(value,1) <> 24.2 THEN RAISE EXCEPTION 'expected 24.2, got %', value; END IF;
   RAISE NOTICE 'bmi=% (70kg, 170cm)', value;
 END \$do\$;"

must_fail "a physiologically impossible temperature is refused" \
"INSERT INTO clinical.triage (id,encounter_id,organisation_id,facility_id,temperature_c)
 VALUES (gen_random_uuid(),'$ENCOUNTER','$ORG_A','$FAC_A',12);"

must_succeed "EDD is derived from LMP" \
"DO \$do\$
 DECLARE value date;
 BEGIN
   INSERT INTO clinical.maternity_record (id,patient_id,organisation_id,facility_id,lmp)
   VALUES ('55555555-0000-0000-0000-000000000001','$PATIENT','$ORG_A','$FAC_A','2026-01-01');
   SELECT edd INTO value FROM clinical.maternity_record WHERE id='55555555-0000-0000-0000-000000000001';
   IF value <> DATE '2026-10-08' THEN RAISE EXCEPTION 'expected 2026-10-08, got %', value; END IF;
   RAISE NOTICE 'edd=% (lmp 2026-01-01)', value;
 END \$do\$;"

echo
echo "=== Staffing (doc 03 section 5) ==="

must_fail "an overlapping primary posting is refused" \
"INSERT INTO people.staff_posting (id,staff_id,organisation_id,facility_id,role_title,start_date,is_primary)
 VALUES (gen_random_uuid(),'$STAFF','$ORG_A','$FAC_A','Nurse','2026-06-01',true);"

echo
echo "=== Row-level security (ADR 0005) ==="
echo "  (run as chc_app, which does NOT bypass RLS)"

rls() {
  docker exec -e PGPASSWORD=apppw "$CONTAINER" psql -v ON_ERROR_STOP=1 -U chc_app -h 127.0.0.1 -d "$PGDATABASE" -tAq -c "$1" 2>&1
}

out=$(rls "BEGIN; SET LOCAL app.current_org = '$ORG_A'; SET LOCAL app.current_facilities = '$FAC_A'; SELECT count(*) FROM clinical.patient; COMMIT;")
if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "1" ]; then
  PASS=$((PASS + 1)); printf '  PASS  in-scope read returns the row\n'
else
  FAIL=$((FAIL + 1)); printf '  FAIL  in-scope read returned: %s\n' "$out"
fi

out=$(rls "BEGIN; SET LOCAL app.current_org = '22222222-2222-2222-2222-222222222222'; SET LOCAL app.current_facilities = 'bbbbbbbb-0000-0000-0000-000000000002'; SELECT count(*) FROM clinical.patient; COMMIT;")
if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "0" ]; then
  PASS=$((PASS + 1)); printf '  PASS  another tenant sees zero rows of the same table\n'
else
  FAIL=$((FAIL + 1)); printf '  FAIL  cross-tenant read returned: %s  <-- LEAK\n' "$out"
fi

out=$(rls "SELECT count(*) FROM clinical.patient;")
if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "0" ]; then
  PASS=$((PASS + 1)); printf '  PASS  with no scope set, nothing is visible (fails closed)\n'
else
  FAIL=$((FAIL + 1)); printf '  FAIL  unscoped read returned: %s  <-- FAILS OPEN\n' "$out"
fi

out=$(rls "SELECT count(*) FROM core.authenticate_lookup('nobody@example.org');")
if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "0" ]; then
  PASS=$((PASS + 1)); printf '  PASS  the authentication bootstrap function is callable before scope exists\n'
else
  FAIL=$((FAIL + 1)); printf '  FAIL  authenticate_lookup returned: %s\n' "$out"
fi

echo
echo "----------------------------------------"
printf 'PASSED %d   FAILED %d\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ]
