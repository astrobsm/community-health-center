-- =============================================================================
-- PARTNERSHIP INVARIANTS
--
-- What a partner and a government are each owed, guarded where no code path
-- can go around it.
--
--   1. A capital recovery step is capped by the balance, not by a fixed number
--   2. A waterfall step states an amount its basis can actually produce
--   3. A floor above a cap is refused: no amount satisfies both
--   4. Revenue share versions never overlap in time
--   5. The capital recovery ledger is append-only
--   6. Recovered capital traces to a payment that really happened
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A step that recovers capital
--
-- The outstanding balance falls every time some of it is recovered, so no
-- fixed cap can express "up to whatever is still owed". The engine reads this
-- flag and caps the step at the balance as it stands when the period is run.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.waterfall_step
  ADD COLUMN is_capital_recovery boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN plan.waterfall_step.is_capital_recovery IS
  'Caps this step at the partner unrecovered capital at the time the period is computed.';


-- -----------------------------------------------------------------------------
-- 2. A step must be computable
--
-- A percentage step with no percentage, or a fixed step with no amount, would
-- silently contribute nothing to a distribution — and the party it was meant
-- to pay would simply not be paid, with nothing in the record to show why.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.waterfall_step
  ADD CONSTRAINT waterfall_step_is_computable CHECK (
    (basis = 'FIXED' AND fixed_amount_minor IS NOT NULL AND rate IS NULL)
    OR (basis = 'RESIDUAL')
    OR (basis IN ('GROSS_REVENUE', 'OPERATING_SURPLUS') AND rate IS NOT NULL)
  );

COMMENT ON CONSTRAINT waterfall_step_is_computable ON plan.waterfall_step IS
  'A share step needs a rate; a fixed step needs an amount. A RESIDUAL step with no rate sweeps what is left.';

ALTER TABLE plan.waterfall_step
  ADD CONSTRAINT waterfall_step_rate_is_a_proportion CHECK (rate IS NULL OR (rate >= 0 AND rate <= 1));


-- -----------------------------------------------------------------------------
-- 3. A floor above a cap
--
-- There is no amount that satisfies both, and choosing either silently hands
-- one party money the other was promised.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.waterfall_step
  ADD CONSTRAINT waterfall_step_floor_within_cap CHECK (
    floor_minor IS NULL OR cap_minor IS NULL OR floor_minor <= cap_minor
  );


-- -----------------------------------------------------------------------------
-- 4. One set of terms in force at a time
--
-- Two overlapping versions would make a settlement depend on which row was
-- read first. The whole point of versioning these terms is that the period
-- being computed has exactly one answer (doc 12 §9).
-- -----------------------------------------------------------------------------

ALTER TABLE plan.revenue_share_model
  ADD CONSTRAINT revenue_share_dates_ordered CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  );

ALTER TABLE plan.revenue_share_model
  ADD CONSTRAINT revenue_share_no_overlap
  EXCLUDE USING gist (
    partnership_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

COMMENT ON CONSTRAINT revenue_share_no_overlap ON plan.revenue_share_model IS
  'Two versions of the terms cannot both apply on the same day, so a settlement always has one answer.';


-- -----------------------------------------------------------------------------
-- 5. The capital recovery ledger is append-only
--
-- Editing a recovery event would change what a partner is owed without
-- leaving a trace. A correction is a new, opposite event — the same rule the
-- financial ledger already follows (spec §44).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plan.reject_recovery_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% on plan.capital_recovery_event is not permitted: this is an append-only ledger. Record a correcting event instead.',
    TG_OP
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER capital_recovery_no_update
  BEFORE UPDATE ON plan.capital_recovery_event
  FOR EACH ROW EXECUTE FUNCTION plan.reject_recovery_mutation();

CREATE TRIGGER capital_recovery_no_delete
  BEFORE DELETE ON plan.capital_recovery_event
  FOR EACH ROW EXECUTE FUNCTION plan.reject_recovery_mutation();


-- -----------------------------------------------------------------------------
-- 6. Money claimed as invested was really spent
--
-- Spec §74. The foreign key to `payment` already exists; this makes it
-- mandatory for an INVESTMENT, so a partner cannot claim recovery of capital
-- that never left anybody's account.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.capital_recovery_event
  ADD CONSTRAINT recovery_investment_traces_to_payment CHECK (
    event_type <> 'INVESTMENT' OR source_payment_id IS NOT NULL
  );

COMMENT ON CONSTRAINT recovery_investment_traces_to_payment ON plan.capital_recovery_event IS
  'Spec §74: capital claimed as invested must name the payment that funded it.';

ALTER TABLE plan.capital_recovery_event
  ADD CONSTRAINT recovery_amount_is_positive CHECK (amount_minor > 0);
