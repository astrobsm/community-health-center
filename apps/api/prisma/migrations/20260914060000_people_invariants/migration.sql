-- =============================================================================
-- PEOPLE AND QUALITY INVARIANTS
--
-- The attendance table is already append-only and staff postings already
-- cannot overlap (20260913010000_invariants). These are the rules Release 9
-- adds, and each one exists because the alternative is a specific, ordinary
-- failure:
--
--   1. An incentive is approved by somebody other than the person who
--      computed it
--   2. An incentive total equals the sum of the components that explain it
--   3. An approved incentive names its approver and the moment
--   4. A performance metric carries a weight and a query that can compute it
--   5. A credential cannot expire before it was issued
--   6. A shift ends after it starts
--   7. A manual attendance entry says why, and a correction says why
--   8. A closed incident has a root cause
--   9. A completed action was verified
--  10. An anonymous complaint carries no name
--  11. A suppressed KPI result publishes no value and states its reason
--  12. A reviewed improvement cycle records what the review found
--
-- Each is enforced here rather than only in the service, because a rule that
-- lives only in application code is a rule that a script, a migration or the
-- next developer can walk straight past.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Segregation of duties, in the table (doc 18 §9)
--
-- The person who computed an incentive may not approve its payment. The
-- service checks this too; the constraint is what makes it true of every path
-- into the table, including the ones nobody has written yet.
-- -----------------------------------------------------------------------------

ALTER TABLE people.staff_incentive
  ADD CONSTRAINT incentive_approver_is_not_the_computer CHECK (
    approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by
  );

COMMENT ON CONSTRAINT incentive_approver_is_not_the_computer ON people.staff_incentive IS
  'Spec §25 and doc 18 §9: computing an incentive and approving its payment are separate acts by separate people.';

-- An approval with no approver and no timestamp is an unsigned decision.
ALTER TABLE people.staff_incentive
  ADD CONSTRAINT incentive_approval_is_signed CHECK (
    status NOT IN ('APPROVED', 'PAID')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

ALTER TABLE people.staff_incentive
  ADD CONSTRAINT incentive_total_is_not_negative CHECK (total_amount_minor >= 0);

ALTER TABLE people.staff_incentive
  ADD CONSTRAINT incentive_period_is_ordered CHECK (period_end >= period_start);


-- -----------------------------------------------------------------------------
-- 2. The total is the sum of its parts
--
-- Deferred to the end of the transaction, because a computation legitimately
-- writes the incentive and its components as separate statements. What it will
-- not permit is the two disagreeing once the transaction closes — which is
-- what a payslip nobody can explain looks like from the database's side.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION people.assert_incentive_balances(p_incentive_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total  bigint;
  v_sum    bigint;
  v_status text;
BEGIN
  SELECT total_amount_minor, status::text
    INTO v_total, v_status
    FROM people.staff_incentive
   WHERE id = p_incentive_id;

  -- The row is gone: a cascade delete is tidying up, and there is nothing left
  -- to disagree with.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A draft has not been computed yet. Requiring it to balance would stop a
  -- row from being created before its components exist.
  IF v_status = 'DRAFT' THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0)
    INTO v_sum
    FROM people.incentive_component
   WHERE staff_incentive_id = p_incentive_id;

  IF v_sum <> v_total THEN
    RAISE EXCEPTION
      'Incentive % totals % kobo but its components sum to % kobo. Every kobo paid must be explained by a component.',
      p_incentive_id, v_total, v_sum
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION people.check_incentive_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM people.assert_incentive_balances(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION people.check_component_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM people.assert_incentive_balances(COALESCE(NEW.staff_incentive_id, OLD.staff_incentive_id));
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_incentive_components_sum
  AFTER INSERT OR UPDATE ON people.staff_incentive
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION people.check_incentive_sum();

CREATE CONSTRAINT TRIGGER trg_incentive_component_sum
  AFTER INSERT OR UPDATE OR DELETE ON people.incentive_component
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION people.check_component_sum();


-- -----------------------------------------------------------------------------
-- 3. A component states its own arithmetic
--
-- The formula text is what the person being paid reads. A component without
-- one is a number they are asked to take on trust.
-- -----------------------------------------------------------------------------

ALTER TABLE people.incentive_component
  ADD CONSTRAINT component_explains_itself CHECK (
    length(btrim(formula_text)) >= 10
  );

ALTER TABLE people.incentive_component
  ADD CONSTRAINT component_amount_is_not_negative CHECK (amount_minor >= 0);


-- -----------------------------------------------------------------------------
-- 4. A metric that cannot be computed cannot be active (spec §25)
--
-- A metric with no query behind it is somebody's impression. Paying on it
-- makes the whole calculation an opinion with a currency symbol.
-- -----------------------------------------------------------------------------

ALTER TABLE people.performance_metric
  ADD CONSTRAINT active_metric_has_a_query CHECK (
    status <> 'ACTIVE'
    OR (source_query_id IS NOT NULL AND length(btrim(source_query_id)) > 0)
  );

ALTER TABLE people.performance_metric
  ADD CONSTRAINT metric_weight_is_not_negative CHECK (weight >= 0);

-- A normalised score is a fraction of the target achieved, capped at one.
ALTER TABLE people.performance_metric_result
  ADD CONSTRAINT metric_result_score_in_range CHECK (
    normalised_score IS NULL OR (normalised_score >= 0 AND normalised_score <= 1)
  );

ALTER TABLE people.performance_metric_result
  ADD CONSTRAINT metric_result_period_is_ordered CHECK (period_end >= period_start);


-- -----------------------------------------------------------------------------
-- 5. Credentials and shifts obey the calendar
-- -----------------------------------------------------------------------------

ALTER TABLE people.staff_credential
  ADD CONSTRAINT credential_expires_after_issue CHECK (
    issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on
  );

-- Verified means somebody checked it and is named. VALID without a
-- verification is a claim, not a check.
ALTER TABLE people.staff_credential
  ADD CONSTRAINT credential_valid_means_verified CHECK (
    status <> 'VALID' OR verified_at IS NOT NULL
  );

ALTER TABLE people.shift
  ADD CONSTRAINT shift_ends_after_it_starts CHECK (ends_at > starts_at);

ALTER TABLE people.staff_schedule
  ADD CONSTRAINT schedule_period_is_ordered CHECK (period_end >= period_start);


-- -----------------------------------------------------------------------------
-- 6. Attendance asserted by a person says who and why
--
-- A MANUAL entry is the one path by which somebody claims attendance without
-- an event. It must name a reason, or it is an unaccountable assertion about
-- another person's pay.
-- -----------------------------------------------------------------------------

ALTER TABLE people.attendance
  ADD CONSTRAINT manual_attendance_is_explained CHECK (
    method <> 'MANUAL'
    OR (manual_reason IS NOT NULL AND length(btrim(manual_reason)) >= 5)
  );

ALTER TABLE people.attendance
  ADD CONSTRAINT attendance_correction_is_explained CHECK (
    corrects_id IS NULL
    OR (correction_reason IS NOT NULL AND length(btrim(correction_reason)) >= 5)
  );

-- A correction of itself would be a loop nobody could read.
ALTER TABLE people.attendance
  ADD CONSTRAINT attendance_does_not_correct_itself CHECK (
    corrects_id IS NULL OR corrects_id <> id
  );


-- -----------------------------------------------------------------------------
-- 7. An incident is closed when it was dealt with (spec §39)
-- -----------------------------------------------------------------------------

ALTER TABLE qual.incident
  ADD CONSTRAINT closed_incident_has_a_root_cause CHECK (
    status <> 'CLOSED'
    OR (root_cause IS NOT NULL AND length(btrim(root_cause)) >= 10 AND closed_at IS NOT NULL)
  );

COMMENT ON CONSTRAINT closed_incident_has_a_root_cause ON qual.incident IS
  'Spec §39. An incident closed with no root cause records that something happened and nobody found out why.';

ALTER TABLE qual.corrective_action
  ADD CONSTRAINT completed_action_is_verified CHECK (
    status <> 'COMPLETED'
    OR (completed_at IS NOT NULL
        AND verification_note IS NOT NULL
        AND length(btrim(verification_note)) >= 10)
  );


-- -----------------------------------------------------------------------------
-- 8. An anonymous complaint stays anonymous
--
-- The promise made when the complaint was taken. Keeping it is not a matter of
-- remembering to leave a field blank.
-- -----------------------------------------------------------------------------

ALTER TABLE qual.complaint
  ADD CONSTRAINT anonymous_complaint_carries_no_identity CHECK (
    is_anonymous IS NOT TRUE
    OR (complainant_name IS NULL AND complainant_contact IS NULL)
  );

ALTER TABLE qual.complaint
  ADD CONSTRAINT resolved_complaint_says_how CHECK (
    status <> 'RESOLVED'
    OR (resolution IS NOT NULL AND length(btrim(resolution)) >= 10 AND resolved_at IS NOT NULL)
  );

-- As the complainant gave it, on the scale they were offered.
ALTER TABLE qual.complaint
  ADD CONSTRAINT complaint_rating_in_range CHECK (
    satisfaction_rating IS NULL OR (satisfaction_rating BETWEEN 1 AND 5)
  );


-- -----------------------------------------------------------------------------
-- 9. A withheld figure is withheld (doc 08 §5)
--
-- Small-cell suppression that leaves the value in the row is not suppression;
-- it is a value one query away from being published.
-- -----------------------------------------------------------------------------

ALTER TABLE qual.kpi_result
  ADD CONSTRAINT suppressed_result_publishes_nothing CHECK (
    is_suppressed IS NOT TRUE
    OR (value IS NULL AND suppression_reason IS NOT NULL)
  );

ALTER TABLE qual.kpi_result
  ADD CONSTRAINT kpi_result_period_is_ordered CHECK (period_end >= period_start);

ALTER TABLE qual.kpi_result
  ADD CONSTRAINT kpi_result_sample_size_is_not_negative CHECK (
    sample_size IS NULL OR sample_size >= 0
  );


-- -----------------------------------------------------------------------------
-- 10. An improvement cycle says what the review found (spec §39)
-- -----------------------------------------------------------------------------

ALTER TABLE qual.quality_improvement
  ADD CONSTRAINT reviewed_cycle_records_the_outcome CHECK (
    status NOT IN ('REVIEWED', 'CLOSED')
    OR (review_outcome IS NOT NULL AND length(btrim(review_outcome)) >= 10)
  );

-- The indicator is named before the work starts, so success cannot be declared
-- afterwards by picking whichever number happened to move.
ALTER TABLE qual.quality_improvement
  ADD CONSTRAINT cycle_names_its_measure CHECK (
    status IN ('IDENTIFIED', 'ANALYSING') OR measurement_kpi_id IS NOT NULL
  );
