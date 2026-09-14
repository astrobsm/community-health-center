-- =============================================================================
-- OPERATIONS INVARIANTS
--
-- The stock ledger, the negative-stock prohibition and the double-entry
-- balance trigger already exist (20260913010000_invariants). These are the
-- rules this release adds.
--
--   1. A charge's amount agrees with its own quantity and rate
--   2. A verified result names who verified it
--   3. A rejected sample carries no result
--   4. A payment is a positive amount
--   5. A stock movement of zero records nothing and is refused
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A charge says what it charges
--
-- Spec §10: a stored figure that must agree with its inputs is constrained so
-- it cannot drift. A charge whose total disagrees with its own line is a bill
-- a patient would be right to dispute.
-- -----------------------------------------------------------------------------

ALTER TABLE fin.charge
  ADD CONSTRAINT charge_amount_is_derived CHECK (
    amount_minor = round(quantity * unit_price_minor)
  );

COMMENT ON CONSTRAINT charge_amount_is_derived ON fin.charge IS
  'Amount is quantity x unit price. Stored for reporting; constrained so a bill cannot disagree with itself.';

ALTER TABLE fin.charge
  ADD CONSTRAINT charge_quantity_is_positive CHECK (quantity > 0);

-- A waiver is a decision somebody made and must own.
ALTER TABLE fin.charge
  ADD CONSTRAINT charge_waiver_is_explained CHECK (
    status <> 'WAIVED'
    OR (waived_by IS NOT NULL AND waiver_reason IS NOT NULL AND length(btrim(waiver_reason)) >= 5)
  );


-- -----------------------------------------------------------------------------
-- 2 and 3. Laboratory results
--
-- An unverified result is a machine reading. A verified one is a clinical
-- fact somebody put their name to, so the name must be there.
-- -----------------------------------------------------------------------------

ALTER TABLE clinical.lab_result
  ADD CONSTRAINT lab_result_verified_names_a_verifier CHECK (
    status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  );

COMMENT ON CONSTRAINT lab_result_verified_names_a_verifier ON clinical.lab_result IS
  'A verified result is a clinical fact somebody put their name to. Without a name it is a machine reading.';

CREATE OR REPLACE FUNCTION clinical.reject_result_on_rejected_sample() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rejected   timestamptz;
  v_accession  text;
BEGIN
  SELECT rejected_at, accession_number INTO v_rejected, v_accession
    FROM clinical.lab_sample WHERE id = NEW.sample_id;

  IF v_rejected IS NOT NULL THEN
    RAISE EXCEPTION
      'Sample % was rejected, so a result on it would be a result on nothing. The patient needs another sample.',
      v_accession
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER lab_result_needs_a_usable_sample
  BEFORE INSERT ON clinical.lab_result
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_result_on_rejected_sample();

-- A result, once verified, is amended rather than edited — the same rule the
-- clinical note follows (spec §43).
ALTER TABLE clinical.lab_result
  ADD CONSTRAINT lab_result_amendment_states_a_reason CHECK (
    amends_id IS NULL OR (amendment_reason IS NOT NULL AND length(btrim(amendment_reason)) >= 10)
  );


-- -----------------------------------------------------------------------------
-- 4. Payments
-- -----------------------------------------------------------------------------

ALTER TABLE fin.payment
  ADD CONSTRAINT payment_amount_is_positive CHECK (amount_minor > 0);

COMMENT ON CONSTRAINT payment_amount_is_positive ON fin.payment IS
  'A negative payment is a refund, which is its own record with its own approval.';


-- -----------------------------------------------------------------------------
-- 5. A stock movement of zero
--
-- It changes nothing and records nothing useful, but it does make the ledger
-- longer and every reconciliation slower to read.
-- -----------------------------------------------------------------------------

ALTER TABLE supply.stock_transaction
  ADD CONSTRAINT stock_movement_is_not_zero CHECK (quantity <> 0);
