-- =============================================================================
-- CLINICAL INVARIANTS
--
-- What a clinician reading this record next year is entitled to rely on.
--
--   1. A signed note is never modified; an amendment is a new row
--   2. An amendment says why
--   3. A superseded version stays readable
--   4. A patient cannot be merged into themselves, or into a tombstone
--   5. A withdrawn consent cannot be un-withdrawn in place
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 to 3. The amendment rule (spec §43)
--
-- The whole value of a clinical record is that it says what the person in
-- front of the patient actually believed at the time. A record that quietly
-- changed is worse than no record: it makes every other entry suspect.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION clinical.reject_signed_note_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Becoming AMENDED is how a note is superseded, and is the only status
  -- change a signed note may undergo.
  IF OLD.status = 'SIGNED' AND NEW.status = 'AMENDED'
     AND ROW(NEW.presenting_complaint, NEW.history_of_presenting_complaint, NEW.past_medical_history,
             NEW.medication_history, NEW.allergies, NEW.family_social_history, NEW.examination_general,
             NEW.examination_systems, NEW.assessment, NEW.differential_diagnosis, NEW.plan,
             NEW.author_staff_id, NEW.signed_at)
         IS NOT DISTINCT FROM
         ROW(OLD.presenting_complaint, OLD.history_of_presenting_complaint, OLD.past_medical_history,
             OLD.medication_history, OLD.allergies, OLD.family_social_history, OLD.examination_general,
             OLD.examination_systems, OLD.assessment, OLD.differential_diagnosis, OLD.plan,
             OLD.author_staff_id, OLD.signed_at)
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('SIGNED', 'AMENDED') THEN
    RAISE EXCEPTION
      'A signed clinical note cannot be changed. Record an amendment: the original stays readable, with its author and the reason it was superseded.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER clinical_note_is_immutable_once_signed
  BEFORE UPDATE ON clinical.clinical_note
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_signed_note_change();

COMMENT ON FUNCTION clinical.reject_signed_note_change() IS
  'Spec §43: a signed note is never modified. Only its status may move to AMENDED, and only when nothing else changes.';

-- A superseded version is part of the record forever.
CREATE OR REPLACE FUNCTION clinical.reject_note_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'A clinical note is never deleted. A note recorded in error is amended, with the correction and the reason kept beside it.'
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER clinical_note_is_never_deleted
  BEFORE DELETE ON clinical.clinical_note
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_note_delete();

-- An amendment must say why, and must point at something.
ALTER TABLE clinical.clinical_note
  ADD CONSTRAINT note_amendment_states_a_reason CHECK (
    amends_id IS NULL OR (amendment_reason IS NOT NULL AND length(btrim(amendment_reason)) >= 10)
  );

ALTER TABLE clinical.clinical_note
  ADD CONSTRAINT note_signed_has_a_timestamp CHECK (
    status = 'DRAFT' OR signed_at IS NOT NULL
  );

-- The same rule for diagnoses: a provisional diagnosis later confirmed or
-- ruled out is an amendment chain, not an overwrite (doc 13 §7).
ALTER TABLE clinical.diagnosis
  ADD CONSTRAINT diagnosis_amendment_states_a_reason CHECK (
    amends_id IS NULL OR (amendment_reason IS NOT NULL AND length(btrim(amendment_reason)) >= 10)
  );

CREATE TRIGGER diagnosis_is_never_deleted
  BEFORE DELETE ON clinical.diagnosis
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_note_delete();


-- -----------------------------------------------------------------------------
-- 4. Merging
--
-- Nothing is deleted: the merged record becomes a tombstone pointing at the
-- survivor, so somebody presenting the old card is still found.
-- -----------------------------------------------------------------------------

ALTER TABLE clinical.patient
  ADD CONSTRAINT patient_not_merged_into_itself CHECK (merged_into_id IS NULL OR merged_into_id <> id);

CREATE OR REPLACE FUNCTION clinical.reject_merge_into_tombstone() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_survivor_merged uuid;
  v_survivor_mrn    text;
BEGIN
  IF NEW.merged_into_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT merged_into_id, mrn INTO v_survivor_merged, v_survivor_mrn
    FROM clinical.patient WHERE id = NEW.merged_into_id;

  IF v_survivor_merged IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot merge into %, which has itself been merged. Merge into the surviving record, so the chain does not fork.',
      v_survivor_mrn
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER patient_merge_target_is_not_a_tombstone
  BEFORE INSERT OR UPDATE ON clinical.patient
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_merge_into_tombstone();


-- -----------------------------------------------------------------------------
-- 5. Consent
--
-- A withdrawal is a fact about a moment. Clearing it in place would erase the
-- evidence that the patient ever said no; granting again is a new record.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION clinical.reject_consent_unwithdrawal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS NULL THEN
    RAISE EXCEPTION
      'A withdrawn consent is not un-withdrawn in place. Record a new consent, so the history shows what the patient decided and when.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER consent_withdrawal_is_permanent
  BEFORE UPDATE ON clinical.patient_consent
  FOR EACH ROW EXECUTE FUNCTION clinical.reject_consent_unwithdrawal();

ALTER TABLE clinical.patient_consent
  ADD CONSTRAINT consent_withdrawal_follows_grant CHECK (
    withdrawn_at IS NULL OR withdrawn_at >= granted_at
  );
