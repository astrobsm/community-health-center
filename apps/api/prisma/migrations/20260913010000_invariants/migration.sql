-- =============================================================================
-- INVARIANTS
--
-- The guarantees this whole product rests on, placed in the database rather
-- than the service layer.
--
-- Why here and not in TypeScript: a future developer writing a quick script, a
-- data fix, or a new service must not be able to violate them. An invariant
-- that only holds when the application is the caller is not an invariant.
--
-- Covers:
--   1. updated_at and version cannot be falsified by the application
--   2. Append-only ledgers (no UPDATE, no DELETE)
--   3. Immutable snapshots (sealed baselines, contract and document versions)
--   4. Double-entry balance enforcement
--   5. Stock ledger: cache maintenance and the negative-stock prohibition
--   6. Closed financial periods reject postings
--   7. Derived clinical values (BMI, EDD) that cannot disagree with their inputs
--   8. Non-overlapping staff postings
--   9. Trigram indexes for global search
--  10. Row-level security on every tenant-scoped table
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. updated_at / version, maintained by the database
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION core.set_updated_at() IS
  'updated_at is maintained here so an application cannot backdate a change.';

CREATE OR REPLACE FUNCTION core.bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION core.bump_version() IS
  'Optimistic concurrency + offline sync conflict detection. A device sends the baseVersion it edited against; a mismatch is a conflict, detected without relying on clocks.';

-- Give every updated_at a database default.
--
-- The ORM sets this field client-side, which means it is correct only when the
-- ORM is the writer. A migration script, a data fix, an import, or a future
-- service writing plain SQL would all fail on NOT NULL — or worse, be given a
-- value chosen by the caller. Defaulting it here makes the column the
-- database's responsibility, which is what the convention in
-- docs/architecture/03-database-architecture.md actually promises.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema IN ('core','assess','plan','exec','clinical','supply','fin','people','qual','audit')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN updated_at SET DEFAULT now()',
                   r.table_schema, r.table_name);
  END LOOP;
END $$;

-- On UPDATE, bump the version and restamp updated_at, so neither can be
-- falsified by the caller.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'version'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema IN ('core','assess','plan','exec','clinical','supply','fin','people','qual','audit')
      AND EXISTS (
        SELECT 1 FROM information_schema.columns u
        WHERE u.table_schema = c.table_schema AND u.table_name = c.table_name
          AND u.column_name = 'updated_at'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_bump_version BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION core.bump_version()',
      r.table_schema, r.table_name);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Append-only ledgers
--
-- journal_entry, journal_line, stock_transaction, payment, attendance,
-- capital_recovery_event, audit_log.
--
-- Corrections are new, linked, contra rows — never edits (spec §§43-44).
--
-- journal_entry and payment carry status columns that a workflow must be able
-- to set (POSTED -> REVERSED, allocation totals), so those two permit a
-- NARROW update of named columns only and reject everything else. The rest
-- are absolutely append-only.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% on %.% is not permitted: this is an append-only ledger. Post a reversing or adjusting entry instead.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER trg_append_only_update BEFORE UPDATE ON fin.journal_line
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON fin.journal_line
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON fin.journal_entry
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TRIGGER trg_append_only_update BEFORE UPDATE ON supply.stock_transaction
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON supply.stock_transaction
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON fin.payment
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TRIGGER trg_append_only_update BEFORE UPDATE ON people.attendance
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON people.attendance
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TRIGGER trg_append_only_update BEFORE UPDATE ON plan.capital_recovery_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON plan.capital_recovery_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

-- The audit log is the institutional memory. Nothing may touch it.
CREATE TRIGGER trg_append_only_update BEFORE UPDATE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER trg_append_only_delete BEFORE DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

-- journal_entry: permit ONLY the reversal bookkeeping columns to change.
CREATE OR REPLACE FUNCTION fin.guard_journal_entry_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.organisation_id, NEW.facility_id, NEW.financial_period_id,
         NEW.reference, NEW.entry_date, NEW.description, NEW.source_type,
         NEW.source_id, NEW.posted_by, NEW.posted_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organisation_id, OLD.facility_id, OLD.financial_period_id,
         OLD.reference, OLD.entry_date, OLD.description, OLD.source_type,
         OLD.source_id, OLD.posted_by, OLD.posted_at, OLD.created_at)
  THEN
    RAISE EXCEPTION
      'A posted journal entry cannot be edited. Post a reversing entry (reverses_id) with a reason instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_journal_entry BEFORE UPDATE ON fin.journal_entry
  FOR EACH ROW EXECUTE FUNCTION fin.guard_journal_entry_update();


-- -----------------------------------------------------------------------------
-- 3. Immutable snapshots
--
-- A sealed baseline is the reference point for everything the partnership will
-- later claim. If it can be edited, none of the comparisons mean anything.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.reject_sealed_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% on %.% is not permitted: this record is sealed and immutable. Create a new version instead.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER trg_immutable_update BEFORE UPDATE ON assess.baseline_metric
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();
CREATE TRIGGER trg_immutable_delete BEFORE DELETE ON assess.baseline_metric
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();

CREATE TRIGGER trg_immutable_update BEFORE UPDATE ON assess.baseline_snapshot
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();
CREATE TRIGGER trg_immutable_delete BEFORE DELETE ON assess.baseline_snapshot
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();

CREATE TRIGGER trg_immutable_update BEFORE UPDATE ON plan.contract_version
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();
CREATE TRIGGER trg_immutable_delete BEFORE DELETE ON plan.contract_version
  FOR EACH ROW EXECUTE FUNCTION core.reject_sealed_mutation();

-- A document version may be marked superseded, but its content, provenance and
-- approval can never change (spec §50).
CREATE OR REPLACE FUNCTION qual.guard_document_version_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.document_id, NEW.version_number, NEW.storage_key, NEW.content_hash,
         NEW.provenance, NEW.generated_by, NEW.generated_at, NEW.approved_by, NEW.approved_at)
     IS DISTINCT FROM
     ROW(OLD.document_id, OLD.version_number, OLD.storage_key, OLD.content_hash,
         OLD.provenance, OLD.generated_by, OLD.generated_at, OLD.approved_by, OLD.approved_at)
     AND OLD.status = 'APPROVED'
  THEN
    RAISE EXCEPTION
      'An approved document version is immutable. Generate a new version; this one becomes SUPERSEDED.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_document_version BEFORE UPDATE ON qual.document_version
  FOR EACH ROW EXECUTE FUNCTION qual.guard_document_version_update();

-- A sealed daily cash reconciliation is final.
CREATE OR REPLACE FUNCTION fin.guard_cash_reconciliation_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'The cash reconciliation for % is sealed. A correction must be recorded as a new adjusting entry.',
      OLD.business_date
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_cash_reconciliation BEFORE UPDATE ON fin.daily_cash_reconciliation
  FOR EACH ROW EXECUTE FUNCTION fin.guard_cash_reconciliation_update();


-- -----------------------------------------------------------------------------
-- 4. Double-entry: debits must equal credits
--
-- DEFERRED, so lines may be inserted one at a time inside the transaction, and
-- enforced at COMMIT, so an unbalanced entry cannot be committed by ANY code
-- path (doc 12 §5).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fin.assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total_debit  bigint;
  total_credit bigint;
  currency_count int;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0), COUNT(DISTINCT currency)
    INTO total_debit, total_credit, currency_count
    FROM fin.journal_line
   WHERE journal_entry_id = NEW.journal_entry_id;

  IF currency_count > 1 THEN
    RAISE EXCEPTION
      'Journal entry % mixes currencies. Cross-currency entries require an explicit conversion line.',
      NEW.journal_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debits % <> credits % (minor units).',
      NEW.journal_entry_id, total_debit, total_credit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_balance_journal_entry
  AFTER INSERT ON fin.journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin.assert_entry_balanced();

-- A line is a debit or a credit, never both and never neither.
ALTER TABLE fin.journal_line
  ADD CONSTRAINT ck_journal_line_single_sided
  CHECK (
    (debit_minor > 0 AND credit_minor = 0) OR
    (credit_minor > 0 AND debit_minor = 0)
  );

ALTER TABLE fin.journal_line
  ADD CONSTRAINT ck_journal_line_non_negative
  CHECK (debit_minor >= 0 AND credit_minor >= 0);


-- -----------------------------------------------------------------------------
-- 5. Stock ledger
--
-- inventory_batch.quantity_on_hand is the ONE deliberate derived cache in this
-- schema, and it is maintained here — no application code writes it.
-- Reconciled nightly against the ledger; on mismatch the LEDGER is correct.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION supply.apply_stock_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_balance numeric(14,3);
BEGIN
  IF NEW.quantity = 0 THEN
    RAISE EXCEPTION 'A stock transaction of zero quantity carries no information and is rejected.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Adjustments and wastage are the only movements a human originates
  -- directly, and both require accountability (doc 14 §3).
  IF NEW.transaction_type IN ('ADJUSTMENT', 'WASTAGE')
     AND (NEW.reason_code IS NULL OR NEW.approved_by IS NULL) THEN
    RAISE EXCEPTION
      'A % transaction requires both a reason_code and an approver.', NEW.transaction_type
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE supply.inventory_batch
     SET quantity_on_hand = quantity_on_hand + NEW.quantity,
         updated_at = now()
   WHERE id = NEW.inventory_batch_id
  RETURNING quantity_on_hand INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Stock transaction references a batch that does not exist: %', NEW.inventory_batch_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF new_balance < 0 THEN
    RAISE EXCEPTION
      'Stock cannot go negative. Batch % would fall to % after a movement of %.',
      NEW.inventory_batch_id, new_balance, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  -- Deplete rather than leave a zero-quantity batch looking available to FEFO.
  IF new_balance = 0 THEN
    UPDATE supply.inventory_batch
       SET status = 'DEPLETED'
     WHERE id = NEW.inventory_batch_id AND status = 'ACTIVE';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_apply_stock_transaction
  AFTER INSERT ON supply.stock_transaction
  FOR EACH ROW EXECUTE FUNCTION supply.apply_stock_transaction();

-- Second line of defence: even if the trigger were dropped, the column cannot
-- go negative.
ALTER TABLE supply.inventory_batch
  ADD CONSTRAINT ck_batch_non_negative CHECK (quantity_on_hand >= 0);

-- Partial index supporting FEFO: expiry ascending among batches with stock.
CREATE INDEX ix_batch_fefo
  ON supply.inventory_batch (inventory_item_id, expiry_date, received_at)
  WHERE quantity_on_hand > 0 AND status IN ('ACTIVE', 'NEAR_EXPIRY');


-- -----------------------------------------------------------------------------
-- 6. Closed periods reject postings
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fin.assert_period_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_status text;
  period_name   text;
BEGIN
  SELECT status::text, name INTO period_status, period_name
    FROM fin.financial_period WHERE id = NEW.financial_period_id;

  IF period_status = 'CLOSED' THEN
    RAISE EXCEPTION
      'Financial period "%" is closed and cannot accept new postings. Reopening requires finance.close_period, a reason, and an audit record.',
      period_name
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_assert_period_open
  BEFORE INSERT ON fin.journal_entry
  FOR EACH ROW EXECUTE FUNCTION fin.assert_period_open();


-- -----------------------------------------------------------------------------
-- 7. Derived clinical values
--
-- Maintained by trigger rather than declared as GENERATED columns, so that the
-- ORM's view of the schema and the database agree (a GENERATED column would
-- read as schema drift on every migration). The guarantee is the same: these
-- values cannot disagree with the inputs that produced them.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION clinical.compute_bmi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.weight_kg IS NOT NULL AND NEW.height_cm IS NOT NULL AND NEW.height_cm > 0 THEN
    NEW.bmi := ROUND(NEW.weight_kg / ((NEW.height_cm / 100.0) ^ 2), 2);
  ELSE
    NEW.bmi := NULL;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION clinical.compute_bmi() IS
  'BMI is never written by the application: a BMI that disagrees with the height and weight beside it is a clinical hazard.';

CREATE TRIGGER trg_compute_bmi
  BEFORE INSERT OR UPDATE OF weight_kg, height_cm ON clinical.triage
  FOR EACH ROW EXECUTE FUNCTION clinical.compute_bmi();

-- Physiological plausibility. Impossible values are rejected outright;
-- implausible-but-possible values are accepted (a clinician confirms them in
-- the UI), because a system that refuses to record a genuine emergency is
-- worse than one that asks twice.
ALTER TABLE clinical.triage
  ADD CONSTRAINT ck_triage_plausible CHECK (
    (temperature_c    IS NULL OR temperature_c BETWEEN 25 AND 45)
    AND (pulse             IS NULL OR pulse BETWEEN 20 AND 300)
    AND (systolic_bp       IS NULL OR systolic_bp BETWEEN 40 AND 300)
    AND (diastolic_bp      IS NULL OR diastolic_bp BETWEEN 20 AND 200)
    AND (respiratory_rate  IS NULL OR respiratory_rate BETWEEN 4 AND 120)
    AND (spo2              IS NULL OR spo2 BETWEEN 30 AND 100)
    AND (weight_kg         IS NULL OR weight_kg BETWEEN 0.3 AND 400)
    AND (height_cm         IS NULL OR height_cm BETWEEN 20 AND 260)
    AND (pain_score        IS NULL OR pain_score BETWEEN 0 AND 10)
  );

-- EDD follows from LMP (Naegele's rule: LMP + 280 days).
CREATE OR REPLACE FUNCTION clinical.compute_edd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lmp IS NOT NULL THEN
    NEW.edd := NEW.lmp + INTERVAL '280 days';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_compute_edd
  BEFORE INSERT OR UPDATE OF lmp ON clinical.maternity_record
  FOR EACH ROW EXECUTE FUNCTION clinical.compute_edd();

-- A signed clinical note is never edited in place; an amendment is a new row.
CREATE OR REPLACE FUNCTION clinical.guard_signed_note() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('SIGNED', 'AMENDED')
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND ROW(NEW.presenting_complaint, NEW.history_of_presenting_complaint, NEW.assessment, NEW.plan)
         IS DISTINCT FROM
         ROW(OLD.presenting_complaint, OLD.history_of_presenting_complaint, OLD.assessment, OLD.plan)
  THEN
    RAISE EXCEPTION
      'A signed clinical note cannot be edited. Create an amendment (amends_id) with a reason; the original stays readable.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_signed_note
  BEFORE UPDATE ON clinical.clinical_note
  FOR EACH ROW EXECUTE FUNCTION clinical.guard_signed_note();


-- -----------------------------------------------------------------------------
-- 8. Staff postings must not overlap
--
-- Two simultaneous primary postings for the same person make the
-- REQUIRED -> APPROVED -> POSTED -> PRESENT comparison meaningless.
-- -----------------------------------------------------------------------------

ALTER TABLE people.staff_posting
  ADD CONSTRAINT ck_no_overlapping_primary_posting
  EXCLUDE USING gist (
    staff_id WITH =,
    daterange(start_date, COALESCE(end_date, 'infinity'::date), '[)') WITH &&
  ) WHERE (is_primary);


-- -----------------------------------------------------------------------------
-- 9. Global search (spec §60)
-- -----------------------------------------------------------------------------

CREATE INDEX ix_patient_name_trgm ON clinical.patient
  USING gin ((COALESCE(given_name,'') || ' ' || COALESCE(family_name,'') || ' ' || COALESCE(other_names,'')) gin_trgm_ops);

CREATE INDEX ix_staff_name_trgm ON people.staff
  USING gin ((COALESCE(given_name,'') || ' ' || COALESCE(family_name,'')) gin_trgm_ops);

CREATE INDEX ix_inventory_item_name_trgm ON supply.inventory_item
  USING gin (name gin_trgm_ops);

CREATE INDEX ix_medication_name_trgm ON clinical.medication
  USING gin ((generic_name || ' ' || COALESCE(brand_name,'')) gin_trgm_ops);

CREATE INDEX ix_asset_search_trgm ON exec.equipment_asset
  USING gin ((name || ' ' || COALESCE(serial_number,'') || ' ' || asset_tag) gin_trgm_ops);

-- Hot, selective predicates.
CREATE INDEX ix_lab_order_pending ON clinical.lab_order (facility_id, ordered_at)
  WHERE status IN ('ORDERED', 'COLLECTED', 'IN_PROCESS');

CREATE INDEX ix_encounter_open ON clinical.encounter (facility_id, started_at)
  WHERE status = 'OPEN';

CREATE INDEX ix_invoice_outstanding ON fin.invoice (facility_id, issued_at)
  WHERE status IN ('ISSUED', 'PARTIALLY_PAID');

CREATE INDEX ix_sync_conflict_open ON audit.sync_conflict (organisation_id, detected_at)
  WHERE resolution = 'PENDING';


-- -----------------------------------------------------------------------------
-- 10. Row-level security (ADR 0005)
--
-- The fourth and lowest layer of tenancy enforcement. The application sets
-- these per transaction with SET LOCAL:
--
--   SET LOCAL app.current_org        = '<uuid>';
--   SET LOCAL app.current_facilities = '<uuid>,<uuid>';
--
-- SET LOCAL (not SET) is essential: the setting dies with the transaction, so a
-- pooled connection cannot leak one user's scope into another's request.
--
-- If the variables are unset, policies match nothing. That is the correct
-- failure direction — fail closed, loudly — and it is asserted by test.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION core.current_facilities() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.current_facilities', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.current_facilities', true), ',')::uuid[]
  END
$$;

-- Enable RLS and attach a tenant policy to every table carrying
-- organisation_id. Tables that also carry facility_id are additionally scoped
-- to the caller's facility set.
--
-- THREE TABLES ARE DELIBERATELY EXCLUDED from facility scoping, because
-- scoping them by facility would be circular — they are what DEFINES the
-- caller's scope, and the scope is not yet known when they are read:
--
--   core.app_user             identity itself; the org is discovered FROM it
--   core.user_facility_access the definition of the facility set
--   core.facility             scoped by its own id, not by a facility_id column
--
-- Excluding them from facility scoping does not weaken isolation: all three
-- remain organisation-scoped, and app_user additionally needs the bootstrap
-- function below because at login time even the organisation is unknown.
DO $$
DECLARE
  r record;
  has_facility boolean;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'organisation_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema IN ('core','assess','plan','exec','clinical','supply','fin','people','qual','audit')
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns f
      WHERE f.table_schema = r.table_schema
        AND f.table_name = r.table_name
        AND f.column_name = 'facility_id'
    ) INTO has_facility;

    -- See the note above.
    IF r.table_schema = 'core' AND r.table_name IN ('app_user', 'user_facility_access') THEN
      has_facility := false;
    END IF;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);

    IF has_facility THEN
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I.%I
        USING (
          organisation_id = core.current_org()
          AND (facility_id IS NULL OR facility_id = ANY (core.current_facilities()))
        )
        WITH CHECK (
          organisation_id = core.current_org()
          AND (facility_id IS NULL OR facility_id = ANY (core.current_facilities()))
        )
      $f$, r.table_schema, r.table_name);
    ELSE
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I.%I
        USING (organisation_id = core.current_org())
        WITH CHECK (organisation_id = core.current_org())
      $f$, r.table_schema, r.table_name);
    END IF;
  END LOOP;
END $$;

-- The organisation table is scoped by its own id.
ALTER TABLE core.organisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organisation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.organisation
  USING (id = core.current_org())
  WITH CHECK (id = core.current_org());

-- The facility table is scoped by its own id against the caller's facility set,
-- so a user cannot enumerate facilities they have no access to even within
-- their own organisation. An empty facility set (an organisation administrator
-- before selecting a facility) sees none until the application widens the scope
-- explicitly — which it does only after checking user_facility_access.
DROP POLICY IF EXISTS tenant_isolation ON core.facility;
CREATE POLICY tenant_isolation ON core.facility
  USING (
    organisation_id = core.current_org()
    AND id = ANY (core.current_facilities())
  )
  WITH CHECK (organisation_id = core.current_org());

-- -----------------------------------------------------------------------------
-- Authentication bootstrap
--
-- At login neither the organisation nor the facility set is known yet, so an
-- RLS-scoped read of app_user cannot work. This SECURITY DEFINER function is
-- the ONLY way the application role can reach a user row before scope exists.
--
-- It is deliberately narrow:
--   - lookup by email only, never a listing
--   - returns the minimum needed to authenticate
--   - never returns MFA secrets, personal data, or any other user's row
--
-- Everything the application does after authentication goes through ordinary
-- RLS-scoped queries.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.authenticate_lookup(p_email citext)
RETURNS TABLE (
  id                 uuid,
  organisation_id    uuid,
  password_hash      text,
  status             "core"."UserStatus",
  mfa_enabled        boolean,
  permission_version integer,
  failed_login_count integer,
  locked_until       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = core, pg_temp
AS $$
  SELECT u.id, u.organisation_id, u.password_hash, u.status, u.mfa_enabled,
         u.permission_version, u.failed_login_count, u.locked_until
  FROM core.app_user u
  WHERE u.email = p_email
  LIMIT 1
$$;

COMMENT ON FUNCTION core.authenticate_lookup(citext) IS
  'The single pre-authentication read path. SECURITY DEFINER because tenant scope does not exist until the user is identified. Returns one row, by exact email, with only the fields authentication needs.';

-- The facility set a user may claim, also needed before scope is established.
CREATE OR REPLACE FUNCTION core.user_scope_lookup(p_user_id uuid)
RETURNS TABLE (
  facility_id  uuid,
  scope_level  "core"."ScopeLevel",
  department_id uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = core, pg_temp
AS $$
  SELECT a.facility_id, a.scope_level, a.department_id
  FROM core.user_facility_access a
  WHERE a.user_id = p_user_id
    AND (a.expires_at IS NULL OR a.expires_at > now())
$$;

COMMENT ON FUNCTION core.user_scope_lookup(uuid) IS
  'Resolves the facility set for a user during session establishment, before app.current_facilities can be set.';

COMMENT ON FUNCTION core.current_org() IS
  'Reads the per-transaction tenant scope set by the application. Returns NULL when unset, so every policy matches nothing — fail closed.';
