-- =============================================================================
-- PLANNING INVARIANTS
--
-- The chain from observation to spending, enforced where it cannot be bypassed.
--
--   1. A need must have a finding behind it, or say why it does not
--   2. A CAPEX line's estimated cost cannot disagree with its own quantity x rate
--   3. An approved cost that differs from the estimate must carry a reason
--   4. An approved model's assumptions are locked
--   5. Projections are computed output, never hand-edited
--   6. A risk score cannot disagree with its likelihood and impact
--   7. A working capital total cannot disagree with its components
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A need is either evidenced or explained
--
-- Spec §17: needs derive from findings. A need invented independently is not
-- forbidden — a regulator may impose one — but it must say where it came from,
-- or the chain from observation to spending is broken at its first link.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.need
  ADD CONSTRAINT need_has_basis CHECK (
    finding_id IS NOT NULL
    OR (unlinked_reason IS NOT NULL AND length(btrim(unlinked_reason)) >= 10)
  );

COMMENT ON CONSTRAINT need_has_basis ON plan.need IS
  'A need must trace to a finding, or state in at least ten characters why it does not.';


-- -----------------------------------------------------------------------------
-- 2. Estimated cost is derived, not asserted
--
-- Spec §10: never store a value that must agree with its inputs unless the
-- database keeps them in agreement. Rounded to the kobo, because quantity may
-- be fractional (3.5 metres of cable) while money never is.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.capex_line
  ADD CONSTRAINT capex_line_estimate_is_derived CHECK (
    estimated_cost_minor = round(quantity * unit_cost_minor)
  );

COMMENT ON CONSTRAINT capex_line_estimate_is_derived ON plan.capex_line IS
  'Estimated cost is quantity x unit cost. Stored for indexing; constrained so it can never drift from its inputs.';

ALTER TABLE plan.capex_line
  ADD CONSTRAINT capex_line_quantity_positive CHECK (quantity > 0);


-- -----------------------------------------------------------------------------
-- 3. An approval that changes the number explains itself
--
-- An approved figure silently different from the estimate is how a budget
-- overrun becomes invisible. The reason lives in the audit trail; this
-- constraint guarantees the approval itself was a deliberate act.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.capex_line
  ADD CONSTRAINT capex_line_approval_is_complete CHECK (
    (status <> 'APPROVED')
    OR (approved_cost_minor IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

COMMENT ON CONSTRAINT capex_line_approval_is_complete ON plan.capex_line IS
  'An approved line records what was approved, by whom, and when. No approval without an approver.';


-- -----------------------------------------------------------------------------
-- 4. An approved model's assumptions are locked
--
-- Spec §72. The application produces an impact preview and requires an
-- explicit unlock; this trigger is what makes that unavoidable rather than
-- merely conventional. A direct UPDATE from a script is refused too.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plan.reject_locked_assumption_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_locked AND NEW.numeric_value IS DISTINCT FROM OLD.numeric_value THEN
    RAISE EXCEPTION
      'Assumption "%" is locked because its model is approved. Unlock the model with a recorded reason before changing it.',
      OLD.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER model_assumption_respects_lock
  BEFORE UPDATE ON plan.model_assumption
  FOR EACH ROW EXECUTE FUNCTION plan.reject_locked_assumption_change();

COMMENT ON FUNCTION plan.reject_locked_assumption_change() IS
  'Spec §72: a locked assumption cannot change value. Unlocking is a separate, permissioned, audited act.';

-- Deleting a locked assumption would be a change by another route.
CREATE OR REPLACE FUNCTION plan.reject_locked_assumption_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_locked THEN
    RAISE EXCEPTION
      'Assumption "%" is locked because its model is approved and cannot be deleted.', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END $$;

CREATE TRIGGER model_assumption_delete_respects_lock
  BEFORE DELETE ON plan.model_assumption
  FOR EACH ROW EXECUTE FUNCTION plan.reject_locked_assumption_delete();


-- -----------------------------------------------------------------------------
-- 5. Projections are output
--
-- A projected month is the deterministic result of the assumptions. Editing
-- one directly would make the printed model disagree with the assumptions it
-- claims to follow — and nobody would be able to tell which was wrong.
-- Recomputing deletes and re-inserts; amending in place is refused.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plan.reject_projection_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'A projected period is computed output and cannot be edited. Change an assumption and recompute the scenario.'
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER model_projection_is_computed
  BEFORE UPDATE ON plan.model_projection
  FOR EACH ROW EXECUTE FUNCTION plan.reject_projection_update();

COMMENT ON FUNCTION plan.reject_projection_update() IS
  'Spec §10: a derived value is never hand-edited. Recompute from assumptions instead.';


-- -----------------------------------------------------------------------------
-- 6. A risk score agrees with its own inputs
-- -----------------------------------------------------------------------------

ALTER TABLE qual.risk
  ADD CONSTRAINT risk_score_is_derived CHECK (risk_score = likelihood * impact);

ALTER TABLE qual.risk
  ADD CONSTRAINT risk_scales_are_one_to_five CHECK (
    likelihood BETWEEN 1 AND 5 AND impact BETWEEN 1 AND 5
  );

COMMENT ON CONSTRAINT risk_score_is_derived ON qual.risk IS
  'Score is likelihood x impact. Stored so the register can be sorted; constrained so it cannot disagree.';


-- -----------------------------------------------------------------------------
-- 7. A working capital total agrees with its own components
-- -----------------------------------------------------------------------------

ALTER TABLE plan.working_capital_plan
  ADD CONSTRAINT working_capital_total_is_derived CHECK (
    total_minor = opening_stock_minor + staff_costs_minor + utilities_minor + contingency_minor
  );

COMMENT ON CONSTRAINT working_capital_total_is_derived ON plan.working_capital_plan IS
  'The total is the sum of its parts. Stored for reporting; constrained so the two can never disagree.';


-- -----------------------------------------------------------------------------
-- 8. Uncollectable revenue is a cost, not a rounding difference
--
-- A model that collects 92% of what it bills loses the other 8%. Recognising
-- it in the period it is billed keeps surplus from containing money the model
-- itself says will never arrive — which matters because a partnership shares
-- surplus.
-- -----------------------------------------------------------------------------

ALTER TABLE plan.model_projection
  ADD COLUMN bad_debt_minor bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN plan.model_projection.bad_debt_minor IS
  'Billed revenue the collection rate says will never arrive, charged in the period it is billed.';
