INSERT INTO core.organisation (id, name, code) VALUES
  ('11111111-1111-1111-1111-111111111111','Org A','ORG-A'),
  ('22222222-2222-2222-2222-222222222222','Org B','ORG-B');
INSERT INTO core.facility_type (id, code, name) VALUES ('33333333-3333-3333-3333-333333333333','CHC','Community Health Centre');
INSERT INTO core.facility (id, organisation_id, facility_type_id, name, code) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Facility A','FAC-A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','Facility B','FAC-B');
INSERT INTO fin.financial_period (id, organisation_id, facility_id, name, start_date, end_date, status) VALUES
  ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','2026-09','2026-09-01','2026-09-30','OPEN'),
  ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','2026-08','2026-08-01','2026-08-31','CLOSED');
INSERT INTO fin.financial_account (id, organisation_id, code, name, account_type, normal_balance) VALUES
  ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','1110','Cash','ASSET','DEBIT'),
  ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','4110','Consultation revenue','REVENUE','CREDIT');
INSERT INTO supply.inventory_item (id, facility_id, organisation_id, code, name, unit_of_measure) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','AMX500','Amoxicillin 500mg','capsule');
INSERT INTO supply.inventory_batch (id, inventory_item_id, organisation_id, facility_id, batch_number, expiry_date, quantity_received, quantity_on_hand, unit_cost_minor) VALUES
  ('ffffffff-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','B-001','2027-01-31',100,0,5000);
INSERT INTO assess.baseline_snapshot (id, facility_id, organisation_id, sequence, label, as_of_date, content_hash) VALUES
  ('99999999-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',1,'Day 0','2026-02-05','sha256:test');
INSERT INTO assess.baseline_metric (id, snapshot_id, organisation_id, facility_id, metric_code, metric_name, numeric_value, classification) VALUES
  ('99999999-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','patients_per_day','Patients per day',8,'VERIFIED');
INSERT INTO clinical.patient (id, facility_id, organisation_id, mrn, given_name, family_name) VALUES
  ('88888888-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','IKM-0000001','Ada','Okeke');
INSERT INTO clinical.encounter (id, patient_id, facility_id, organisation_id, reference) VALUES
  ('88888888-0000-0000-0000-000000000002','88888888-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ENC-0001');
INSERT INTO people.staff (id, organisation_id, facility_id, staff_number, given_name, family_name, cadre) VALUES
  ('77777777-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','S-001','Nkechi','Eze','CHEW');
INSERT INTO people.staff_posting (id, staff_id, organisation_id, facility_id, role_title, start_date, is_primary) VALUES
  ('77777777-0000-0000-0000-000000000002','77777777-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','CHEW','2026-01-01',true);
-- Application role, subject to RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='chc_app') THEN CREATE ROLE chc_app LOGIN PASSWORD 'apppw'; END IF;
END $$;
GRANT USAGE ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT EXECUTE ON FUNCTION core.authenticate_lookup(citext), core.user_scope_lookup(uuid) TO chc_app;
ALTER ROLE chc_app NOBYPASSRLS;
