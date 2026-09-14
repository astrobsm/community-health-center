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

echo
echo "=== Planning: the chain from observation to spending (spec sections 17-20, 72) ==="

PLAN=eeeeeeee-0000-0000-0000-000000000001
MODEL=eeeeeeee-0000-0000-0000-000000000002
SCENARIO=eeeeeeee-0000-0000-0000-000000000003

# Prerequisites for the checks below. If this setup fails, every planning
# assertion after it is meaningless, so it is asserted rather than assumed.
must_succeed "planning fixtures load" \
"INSERT INTO plan.capex_plan (id,facility_id,organisation_id,name)
 VALUES ('$PLAN','$FAC_A','$ORG_A','Revitalisation phase 1');
 INSERT INTO plan.financial_model (id,facility_id,organisation_id,name,start_date)
 VALUES ('$MODEL','$FAC_A','$ORG_A','Five-year model','2026-10-01');
 INSERT INTO plan.model_assumption (id,model_id,organisation_id,code,label,numeric_value,is_locked)
 VALUES ('eeeeeeee-0000-0000-0000-00000000000a','$MODEL','$ORG_A','patientsPerDay','Patients per day',10,true);
 INSERT INTO plan.model_scenario (id,model_id,organisation_id,scenario_type,name)
 VALUES ('$SCENARIO','$MODEL','$ORG_A','BASE','Base case');
 INSERT INTO plan.model_projection
   (id,scenario_id,organisation_id,period_index,period_start,patient_count,revenue_minor,collections_minor,
    direct_cost_minor,opex_minor,staff_cost_minor,incentive_minor,surplus_minor,cash_balance_minor,cumulative_surplus_minor)
 VALUES ('eeeeeeee-0000-0000-0000-00000000000b','$SCENARIO','$ORG_A',0,'2026-10-01',200,40000000,40000000,
    0,10000000,20000000,0,10000000,10000000,10000000);"

must_fail "a need with no finding and no stated reason is refused" \
"INSERT INTO plan.need (id,organisation_id,facility_id,reference,title)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','N-9001','Unexplained need');"

must_succeed "a need with no finding but a stated reason is accepted" \
"INSERT INTO plan.need (id,organisation_id,facility_id,reference,title,unlinked_reason)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','N-9002','Regulator-imposed requirement',
         'Imposed by the state health board in its August inspection letter.');"

must_fail "a CAPEX line whose estimate disagrees with quantity x rate is refused" \
"INSERT INTO plan.capex_line (id,capex_plan_id,organisation_id,facility_id,category,description,quantity,unit_cost_minor,estimated_cost_minor)
 VALUES (gen_random_uuid(),'$PLAN','$ORG_A','$FAC_A','EQUIPMENT','Two beds',2,500000,900000);"

must_succeed "a CAPEX line whose estimate agrees is accepted" \
"INSERT INTO plan.capex_line (id,capex_plan_id,organisation_id,facility_id,category,description,quantity,unit_cost_minor,estimated_cost_minor)
 VALUES ('eeeeeeee-0000-0000-0000-00000000000c','$PLAN','$ORG_A','$FAC_A','EQUIPMENT','Two beds',2,500000,1000000);"

must_fail "a CAPEX line cannot be approved without an approver" \
"UPDATE plan.capex_line SET status='APPROVED' WHERE id='eeeeeeee-0000-0000-0000-00000000000c';"

must_fail "a locked assumption cannot be changed" \
"UPDATE plan.model_assumption SET numeric_value=25 WHERE id='eeeeeeee-0000-0000-0000-00000000000a';"

must_fail "a locked assumption cannot be deleted instead" \
"DELETE FROM plan.model_assumption WHERE id='eeeeeeee-0000-0000-0000-00000000000a';"

must_succeed "a locked assumption's rationale can still be recorded" \
"UPDATE plan.model_assumption SET rationale='Counted over four weeks of the register.'
 WHERE id='eeeeeeee-0000-0000-0000-00000000000a';"

must_fail "a projected period cannot be hand-edited" \
"UPDATE plan.model_projection SET revenue_minor=99999999 WHERE id='eeeeeeee-0000-0000-0000-00000000000b';"

must_fail "a risk score that disagrees with its own inputs is refused" \
"INSERT INTO qual.risk (id,organisation_id,facility_id,reference,title,likelihood,impact,risk_score)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','RISK-9001','Mis-scored risk',3,4,20);"

must_fail "a likelihood outside the 1-5 scale is refused" \
"INSERT INTO qual.risk (id,organisation_id,facility_id,reference,title,likelihood,impact,risk_score)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','RISK-9002','Off-scale risk',7,4,28);"

must_fail "a working capital total that disagrees with its components is refused" \
"INSERT INTO plan.working_capital_plan (id,capex_plan_id,organisation_id,facility_id,opening_stock_minor,staff_costs_minor,utilities_minor,contingency_minor,total_minor)
 VALUES (gen_random_uuid(),'$PLAN','$ORG_A','$FAC_A',1000000,2000000,500000,250000,9000000);"
echo
echo
echo "=== Partnership: what each party is owed (spec sections 35, 74) ==="

PSHIP=dddddddd-1111-0000-0000-000000000001
RSM=dddddddd-1111-0000-0000-000000000002
PARTY=dddddddd-1111-0000-0000-000000000003
RECOVERY=dddddddd-1111-0000-0000-000000000004

must_succeed "partnership fixtures load" \
"INSERT INTO plan.partnership (id,facility_id,organisation_id,name)
 VALUES ('$PSHIP','$FAC_A','$ORG_A','Ikem revitalisation partnership');
 INSERT INTO plan.partnership_party (id,partnership_id,organisation_id,party_role,legal_name)
 VALUES ('$PARTY','$PSHIP','$ORG_A','PARTNER','A Partner Ltd');
 INSERT INTO plan.revenue_share_model (id,partnership_id,organisation_id,name,share_type,version_number,effective_from,effective_to)
 VALUES ('$RSM','$PSHIP','$ORG_A','Agreed terms','SURPLUS_SHARE',1,'2026-01-01','2026-12-31');
 INSERT INTO plan.capital_recovery_event (id,partnership_id,organisation_id,facility_id,event_type,amount_minor,occurred_on,source_payment_id)
 VALUES ('$RECOVERY','$PSHIP','$ORG_A','$FAC_A','RECOVERY',100000,'2026-06-01',NULL);"

must_fail "a share step with no rate is refused" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',1,'Government entitlement','OPERATING_SURPLUS');"

must_fail "a fixed step with no amount is refused" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',2,'Community fund','FIXED');"

must_fail "a rate above 100% is refused" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis,rate)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',3,'Impossible share','OPERATING_SURPLUS',1.5);"

must_fail "a floor above a cap is refused" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis,rate,cap_minor,floor_minor)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',4,'Contradictory','OPERATING_SURPLUS',0.1,1000000,2000000);"

must_succeed "a well-formed step is accepted" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis,rate,cap_minor,floor_minor,beneficiary_party_id)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',5,'Government entitlement','OPERATING_SURPLUS',0.4,2000000,1000000,'$PARTY');"

must_succeed "a RESIDUAL sweep needs no rate" \
"INSERT INTO plan.waterfall_step (id,revenue_share_model_id,organisation_id,sequence,label,basis)
 VALUES (gen_random_uuid(),'$RSM','$ORG_A',6,'Reinvestment','RESIDUAL');"

must_fail "two versions of the terms cannot apply on the same day" \
"INSERT INTO plan.revenue_share_model (id,partnership_id,organisation_id,name,share_type,version_number,effective_from)
 VALUES (gen_random_uuid(),'$PSHIP','$ORG_A','Renegotiated','HYBRID',2,'2026-06-01');"

must_succeed "a version starting the day after the last one ends is accepted" \
"INSERT INTO plan.revenue_share_model (id,partnership_id,organisation_id,name,share_type,version_number,effective_from)
 VALUES (gen_random_uuid(),'$PSHIP','$ORG_A','Renegotiated','HYBRID',2,'2027-01-01');"

must_fail "capital claimed as invested must name the payment that funded it" \
"INSERT INTO plan.capital_recovery_event (id,partnership_id,organisation_id,facility_id,event_type,amount_minor,occurred_on)
 VALUES (gen_random_uuid(),'$PSHIP','$ORG_A','$FAC_A','INVESTMENT',5000000,'2026-06-01');"

must_fail "a recovery event cannot be edited after the fact" \
"UPDATE plan.capital_recovery_event SET amount_minor = 999999 WHERE id='$RECOVERY';"

must_fail "nor deleted" \
"DELETE FROM plan.capital_recovery_event WHERE id='$RECOVERY';"

must_fail "a zero-value recovery event carries no information and is refused" \
"INSERT INTO plan.capital_recovery_event (id,partnership_id,organisation_id,facility_id,event_type,amount_minor,occurred_on)
 VALUES (gen_random_uuid(),'$PSHIP','$ORG_A','$FAC_A','RECOVERY',0,'2026-06-01');"

echo
echo
echo "=== Execution: procurement, assets and commissioning (spec sections 21-22, 46) ==="

SUPPLIER=cccccccc-1111-0000-0000-000000000001
PO=cccccccc-1111-0000-0000-000000000002
POLINE=cccccccc-1111-0000-0000-000000000003
GRN=cccccccc-1111-0000-0000-000000000004
INVOICE=cccccccc-1111-0000-0000-000000000005
ASSET=cccccccc-1111-0000-0000-000000000006
PROJECT=cccccccc-1111-0000-0000-000000000007
PHASE=cccccccc-1111-0000-0000-000000000008
TASK=cccccccc-1111-0000-0000-000000000009

must_succeed "execution fixtures load" \
"INSERT INTO exec.supplier (id,organisation_id,code,name)
 VALUES ('$SUPPLIER','$ORG_A','SUP-T01','Test Supplier Ltd');
 INSERT INTO exec.purchase_order (id,organisation_id,facility_id,supplier_id,reference,ordered_on,total_minor)
 VALUES ('$PO','$ORG_A','$FAC_A','$SUPPLIER','PO-T0001','2026-09-01',500000);
 INSERT INTO exec.purchase_order_line (id,purchase_order_id,organisation_id,description,quantity_ordered,unit_price_minor,line_total_minor,is_capital_item)
 VALUES ('$POLINE','$PO','$ORG_A','Hospital bed',10,50000,500000,true);
 INSERT INTO exec.goods_receipt (id,purchase_order_id,organisation_id,facility_id,reference,received_on)
 VALUES ('$GRN','$PO','$ORG_A','$FAC_A','GRN-T0001','2026-09-10');
 INSERT INTO exec.supplier_invoice (id,supplier_id,purchase_order_id,organisation_id,facility_id,invoice_number,invoice_date,amount_minor,total_minor)
 VALUES ('$INVOICE','$SUPPLIER','$PO','$ORG_A','$FAC_A','INV-T0001','2026-09-11',500000,500000);
 INSERT INTO exec.equipment_asset (id,facility_id,organisation_id,asset_tag,name,category)
 VALUES ('$ASSET','$FAC_A','$ORG_A','AST-T0001','Hospital bed','EQUIPMENT');
 INSERT INTO exec.capital_project (id,facility_id,organisation_id,reference,name,category,unplanned_reason)
 VALUES ('$PROJECT','$FAC_A','$ORG_A','PRJ-T001','Roof works','BUILDING','Fixture for invariant tests.');
 INSERT INTO exec.project_phase (id,project_id,organisation_id,sequence,name)
 VALUES ('$PHASE','$PROJECT','$ORG_A',1,'Phase 1');
 INSERT INTO exec.project_task (id,phase_id,organisation_id,facility_id,reference,name)
 VALUES ('$TASK','$PHASE','$ORG_A','$FAC_A','T-T001','Strip the old roof');"

must_fail "a received unit that is neither accepted nor rejected is refused" \
"INSERT INTO exec.goods_receipt_line (id,goods_receipt_id,organisation_id,facility_id,description,quantity_received,quantity_accepted,quantity_rejected,unit_cost_minor)
 VALUES (gen_random_uuid(),'$GRN','$ORG_A','$FAC_A','Hospital bed',10,8,0,50000);"

must_fail "rejecting something without saying why is refused" \
"INSERT INTO exec.goods_receipt_line (id,goods_receipt_id,organisation_id,facility_id,description,quantity_received,quantity_accepted,quantity_rejected,unit_cost_minor)
 VALUES (gen_random_uuid(),'$GRN','$ORG_A','$FAC_A','Hospital bed',10,8,2,50000);"

must_succeed "a receipt that accounts for every unit is accepted" \
"INSERT INTO exec.goods_receipt_line (id,goods_receipt_id,purchase_order_line_id,organisation_id,facility_id,description,quantity_received,quantity_accepted,quantity_rejected,rejection_reason,unit_cost_minor,is_capital_item)
 VALUES (gen_random_uuid(),'$GRN','$POLINE','$ORG_A','$FAC_A','Hospital bed',10,8,2,'Two frames arrived buckled.',50000,true);"

must_fail "a purchase order line total that disagrees with its own rate is refused" \
"INSERT INTO exec.purchase_order_line (id,purchase_order_id,organisation_id,description,quantity_ordered,unit_price_minor,line_total_minor)
 VALUES (gen_random_uuid(),'$PO','$ORG_A','Drip stand',4,12500,99999);"

must_fail "an asset cannot be commissioned with no commissioning record" \
"UPDATE exec.equipment_asset SET commissioning_status='COMMISSIONED' WHERE id='$ASSET';"

must_succeed "a commissioning record with four of five checks is accepted" \
"INSERT INTO exec.commissioning_record (id,organisation_id,facility_id,asset_id,reference,functional_test_passed,safety_check_passed,staff_trained,consumables_available,utilities_connected)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','$ASSET','COM-T0001',true,true,true,true,false);"

must_fail "but the asset still cannot be commissioned on four of five" \
"UPDATE exec.equipment_asset SET commissioning_status='COMMISSIONED' WHERE id='$ASSET';"

must_succeed "with all five, it can" \
"INSERT INTO exec.commissioning_record (id,organisation_id,facility_id,asset_id,reference,functional_test_passed,safety_check_passed,staff_trained,consumables_available,utilities_connected)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','$ASSET','COM-T0002',true,true,true,true,true);
 UPDATE exec.equipment_asset SET commissioning_status='COMMISSIONED' WHERE id='$ASSET';"

must_fail "a task cannot be complete at less than 100%" \
"UPDATE exec.project_task SET status='COMPLETED', percent_complete=80 WHERE id='$TASK';"

must_fail "progress above 100% is refused" \
"UPDATE exec.project_task SET percent_complete=120 WHERE id='$TASK';"

must_fail "a task cannot depend on itself" \
"INSERT INTO exec.project_task_dependency (id,task_id,predecessor_id,organisation_id)
 VALUES (gen_random_uuid(),'$TASK','$TASK','$ORG_A');"

# The headline control: an invoice with no goods receipt cannot be paid.
PO2=cccccccc-1111-0000-0000-00000000000a
INVOICE2=cccccccc-1111-0000-0000-00000000000b

must_succeed "a second order and invoice, with nothing yet received" \
"INSERT INTO exec.purchase_order (id,organisation_id,facility_id,supplier_id,reference,ordered_on,total_minor)
 VALUES ('$PO2','$ORG_A','$FAC_A','$SUPPLIER','PO-T0002','2026-09-02',200000);
 INSERT INTO exec.supplier_invoice (id,supplier_id,purchase_order_id,organisation_id,facility_id,invoice_number,invoice_date,amount_minor,total_minor)
 VALUES ('$INVOICE2','$SUPPLIER','$PO2','$ORG_A','$FAC_A','INV-T0002','2026-09-12',200000,200000);"

must_fail "an invoice with no goods receipt cannot be paid" \
"INSERT INTO fin.payment (id,organisation_id,facility_id,reference,direction,amount_minor,method,supplier_invoice_id)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','PAY-T0001','OUTBOUND',200000,'BANK_TRANSFER','$INVOICE2');"

must_succeed "an invoice with goods actually received can be" \
"INSERT INTO fin.payment (id,organisation_id,facility_id,reference,direction,amount_minor,method,supplier_invoice_id)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','PAY-T0002','OUTBOUND',400000,'BANK_TRANSFER','$INVOICE');"

must_succeed "a payment unrelated to any supplier invoice is unaffected" \
"INSERT INTO fin.payment (id,organisation_id,facility_id,reference,direction,amount_minor,method)
 VALUES (gen_random_uuid(),'$ORG_A','$FAC_A','PAY-T0003','INBOUND',5000,'CASH');"

echo
echo
echo "=== Clinical: what a later clinician can rely on (spec section 43) ==="

CPATIENT=eeeeeeee-2222-0000-0000-000000000001
CPATIENT2=eeeeeeee-2222-0000-0000-000000000002
CENCOUNTER=eeeeeeee-2222-0000-0000-000000000003
CNOTE=eeeeeeee-2222-0000-0000-000000000004
CDRAFT=eeeeeeee-2222-0000-0000-000000000005
CCONSENT=eeeeeeee-2222-0000-0000-000000000006
CDIAG=eeeeeeee-2222-0000-0000-000000000007

must_succeed "clinical fixtures load" \
"INSERT INTO clinical.patient (id,facility_id,organisation_id,mrn,given_name,family_name)
 VALUES ('$CPATIENT','$FAC_A','$ORG_A','IKM-9000001','Ada','Chukwu');
 INSERT INTO clinical.patient (id,facility_id,organisation_id,mrn,given_name,family_name)
 VALUES ('$CPATIENT2','$FAC_A','$ORG_A','IKM-9000002','Adaeze','Chukwu');
 INSERT INTO clinical.encounter (id,patient_id,facility_id,organisation_id,reference)
 VALUES ('$CENCOUNTER','$CPATIENT','$FAC_A','$ORG_A','ENC-9000001');
 INSERT INTO clinical.clinical_note (id,encounter_id,organisation_id,facility_id,status,assessment,signed_at)
 VALUES ('$CNOTE','$CENCOUNTER','$ORG_A','$FAC_A','SIGNED','Malaria',now());
 INSERT INTO clinical.clinical_note (id,encounter_id,organisation_id,facility_id,status,assessment)
 VALUES ('$CDRAFT','$CENCOUNTER','$ORG_A','$FAC_A','DRAFT','Still typing');
 INSERT INTO clinical.patient_consent (id,patient_id,organisation_id,facility_id,purpose,granted)
 VALUES ('$CCONSENT','$CPATIENT','$ORG_A','$FAC_A','SMS_CONTACT',true);
 INSERT INTO clinical.diagnosis (id,encounter_id,organisation_id,facility_id,description,diagnosis_type)
 VALUES ('$CDIAG','$CENCOUNTER','$ORG_A','$FAC_A','Malaria','PROVISIONAL');"

must_fail "a signed note cannot be edited" \
"UPDATE clinical.clinical_note SET assessment='Typhoid' WHERE id='$CNOTE';"

must_fail "nor can its author be changed" \
"UPDATE clinical.clinical_note SET author_staff_id=gen_random_uuid() WHERE id='$CNOTE';"

must_succeed "a draft can be edited freely" \
"UPDATE clinical.clinical_note SET assessment='Still typing, now with more detail' WHERE id='$CDRAFT';"

must_succeed "a signed note can be marked superseded, and nothing else" \
"UPDATE clinical.clinical_note SET status='AMENDED' WHERE id='$CNOTE';"

must_fail "a clinical note is never deleted" \
"DELETE FROM clinical.clinical_note WHERE id='$CNOTE';"

must_fail "an amendment with no reason is refused" \
"INSERT INTO clinical.clinical_note (id,encounter_id,organisation_id,facility_id,status,assessment,signed_at,amends_id)
 VALUES (gen_random_uuid(),'$CENCOUNTER','$ORG_A','$FAC_A','SIGNED','Typhoid',now(),'$CNOTE');"

must_succeed "an amendment with a reason is accepted" \
"INSERT INTO clinical.clinical_note (id,encounter_id,organisation_id,facility_id,status,assessment,signed_at,amends_id,amendment_reason)
 VALUES (gen_random_uuid(),'$CENCOUNTER','$ORG_A','$FAC_A','SIGNED','Typhoid',now(),'$CNOTE','Blood film was negative; the widal test came back positive.');"

must_fail "a signed note with no signature time is refused" \
"INSERT INTO clinical.clinical_note (id,encounter_id,organisation_id,facility_id,status,assessment)
 VALUES (gen_random_uuid(),'$CENCOUNTER','$ORG_A','$FAC_A','SIGNED','No signature time');"

must_fail "a diagnosis amendment with no reason is refused" \
"INSERT INTO clinical.diagnosis (id,encounter_id,organisation_id,facility_id,description,diagnosis_type,amends_id)
 VALUES (gen_random_uuid(),'$CENCOUNTER','$ORG_A','$FAC_A','Typhoid','CONFIRMED','$CDIAG');"

must_fail "a diagnosis is never deleted" \
"DELETE FROM clinical.diagnosis WHERE id='$CDIAG';"

must_fail "a patient cannot be merged into themselves" \
"UPDATE clinical.patient SET merged_into_id='$CPATIENT' WHERE id='$CPATIENT';"

must_succeed "one patient can be merged into another" \
"UPDATE clinical.patient SET merged_into_id='$CPATIENT' WHERE id='$CPATIENT2';"

must_fail "but not into a record that has itself been merged" \
"INSERT INTO clinical.patient (id,facility_id,organisation_id,mrn,given_name,family_name,merged_into_id)
 VALUES (gen_random_uuid(),'$FAC_A','$ORG_A','IKM-9000003','Adaobi','Chukwu','$CPATIENT2');"

must_succeed "a consent can be withdrawn" \
"UPDATE clinical.patient_consent SET withdrawn_at=now() WHERE id='$CCONSENT';"

must_fail "a withdrawal cannot be quietly undone" \
"UPDATE clinical.patient_consent SET withdrawn_at=NULL WHERE id='$CCONSENT';"

must_fail "a withdrawal cannot predate the consent it withdraws" \
"INSERT INTO clinical.patient_consent (id,patient_id,organisation_id,facility_id,purpose,granted,granted_at,withdrawn_at)
 VALUES (gen_random_uuid(),'$CPATIENT','$ORG_A','$FAC_A','PHOTOGRAPH',true,'2026-09-10','2026-09-01');"

echo
echo "=== Row-level security (ADR 0005) ==="
echo "  (run as chc_app, which does NOT bypass RLS)"

rls() {
  docker exec -e PGPASSWORD=apppw "$CONTAINER" psql -v ON_ERROR_STOP=1 -U chc_app -h 127.0.0.1 -d "$PGDATABASE" -tAq -c "$1" 2>&1
}

# Asserted as "at least one" rather than an exact count: the property under test
# is visibility, and a fixture added later must not fail it.
out=$(rls "BEGIN; SET LOCAL app.current_org = '$ORG_A'; SET LOCAL app.current_facilities = '$FAC_A'; SELECT count(*) FROM clinical.patient; COMMIT;")
if [ "$(printf '%s' "$out" | tr -d '[:space:]')" -ge 1 ] 2>/dev/null; then
  PASS=$((PASS + 1)); printf '  PASS  in-scope read returns rows\n'
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
