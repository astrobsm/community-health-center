-- =============================================================================
-- AI ISOLATION
--
-- The AI layer sits above the authoritative database. This migration is what
-- makes that a property of the system rather than a description of it.
--
--   1. `ai_reader` — a role with SELECT on the analytics schema and nothing
--      else. Not "should not write": cannot. The permission does not exist.
--   2. De-identified read-models. What the AI role can reach carries no names,
--      no phone numbers, no national identifiers and no clinical free text.
--   3. Invariants on ai_insight, so a stored insight cannot lose its label, its
--      provenance, or its honesty about confidence.
--
-- Even a total compromise of the AI module — prompt injection, a bug, a
-- malicious model response — writes nothing. The blast radius is a discarded
-- paragraph (doc 17 §§1, 5).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. De-identified read-models
--
-- The AI never reads a base table. It reads these, and they are built so that
-- there is nothing in them to leak: counts and totals by day, by cadre, by
-- item — no person named anywhere.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW analytics.ai_daily_clinical
WITH (security_barrier = true) AS
SELECT
  e.organisation_id,
  e.facility_id,
  (e.started_at AT TIME ZONE 'UTC')::date AS business_date,
  e.encounter_type,
  count(*)                                        AS encounters,
  count(*) FILTER (WHERE e.status = 'CLOSED')     AS closed,
  count(*) FILTER (WHERE e.status = 'OPEN')       AS still_open,
  count(*) FILTER (WHERE d.id IS NULL
                     AND e.no_diagnosis_reason IS NULL
                     AND e.status = 'CLOSED')     AS closed_undocumented
FROM clinical.encounter e
LEFT JOIN LATERAL (
  SELECT 1 AS id FROM clinical.diagnosis dx WHERE dx.encounter_id = e.id LIMIT 1
) d ON true
WHERE e.status <> 'CANCELLED'
  AND e.organisation_id = core.current_org()
  AND e.facility_id = ANY (core.current_facilities())
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW analytics.ai_daily_clinical IS
  'Counts only. No patient, no clinician, no clinical text. This is what the AI role may see of clinical activity.';

CREATE OR REPLACE VIEW analytics.ai_daily_supply
WITH (security_barrier = true) AS
SELECT
  i.organisation_id,
  i.facility_id,
  i.code           AS item_code,
  i.name           AS item_name,
  i.kind,
  COALESCE(sum(b.quantity_on_hand), 0)                            AS quantity_on_hand,
  min(b.expiry_date) FILTER (WHERE b.quantity_on_hand > 0)        AS earliest_expiry
FROM supply.inventory_item i
LEFT JOIN supply.inventory_batch b
       ON b.inventory_item_id = i.id AND b.status = 'ACTIVE'
WHERE i.organisation_id = core.current_org()
  AND i.facility_id = ANY (core.current_facilities())
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW analytics.ai_daily_supply IS
  'Stock by item. No supplier pricing, no person, no free text.';

CREATE OR REPLACE VIEW analytics.ai_quality_summary
WITH (security_barrier = true) AS
SELECT
  organisation_id,
  facility_id,
  severity::text                                   AS severity,
  status::text                                     AS status,
  count(*)                                         AS incidents,
  count(*) FILTER (WHERE patient_affected)         AS affecting_a_patient
FROM qual.incident
WHERE organisation_id = core.current_org()
  AND facility_id = ANY (core.current_facilities())
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW analytics.ai_quality_summary IS
  'Incident counts by severity and status. The description is excluded: it frequently names people.';


-- -----------------------------------------------------------------------------
-- 2. The role
--
-- Guarded, because roles are created by the deployment runbook rather than by a
-- migration. Where `ai_reader` exists, this is the full extent of what it can
-- do: SELECT, on three views, in one schema.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_reader') THEN
    -- Revoke first and broadly. A grant inherited from PUBLIC or from a
    -- previous migration would defeat the whole arrangement quietly.
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader';
    EXECUTE 'REVOKE ALL ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader';

    EXECUTE 'GRANT USAGE ON SCHEMA analytics TO ai_reader';
    EXECUTE 'GRANT SELECT ON analytics.ai_daily_clinical TO ai_reader';
    EXECUTE 'GRANT SELECT ON analytics.ai_daily_supply TO ai_reader';
    EXECUTE 'GRANT SELECT ON analytics.ai_quality_summary TO ai_reader';

    -- Not the materialised view, and not the barrier view over it: those carry
    -- money at day granularity, and the AI has no question that needs them.
    EXECUTE 'REVOKE ALL ON analytics.mv_daily_financial FROM ai_reader';
    EXECUTE 'REVOKE ALL ON analytics.daily_financial FROM ai_reader';

    EXECUTE 'ALTER ROLE ai_reader NOBYPASSRLS';
    EXECUTE 'ALTER ROLE ai_reader SET default_transaction_read_only = on';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 3. An insight cannot lose its label or its provenance
--
-- Every one of these exists because the alternative is an AI statement that
-- looks like a system record.
-- -----------------------------------------------------------------------------

ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_is_always_ai_generated CHECK (classification = 'AI_GENERATED');

COMMENT ON CONSTRAINT insight_is_always_ai_generated ON qual.ai_insight IS
  'Spec §82. An AI output is never anything else, and no code path can reclassify one into a fact.';

-- The queries that grounded it. Without them the insight is a paragraph nobody
-- can re-examine, which is the same as a paragraph nobody should believe.
-- cardinality(), not array_length(). array_length('{}', 1) is NULL, NULL >= 1
-- is NULL, and a CHECK constraint treats NULL as satisfied — so the obvious
-- spelling of this rule permits exactly the row it is written to refuse.
ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_names_its_sources CHECK (
    cardinality(context_query_ids) >= 1
  );

ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_records_its_provenance CHECK (
    length(btrim(prompt_hash)) > 0
    AND length(btrim(context_hash)) > 0
    AND length(btrim(model_id)) > 0
  );

ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_has_content CHECK (length(btrim(content)) > 0);

-- Null unless statistically derived. A model's own sense of how sure it is has
-- never been a measurement, and a number between 0 and 1 beside a paragraph
-- reads as one (doc 17 §6).
ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_confidence_in_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  );

-- A review is somebody's judgement, and it carries their name and the moment.
ALTER TABLE qual.ai_insight
  ADD CONSTRAINT insight_review_is_signed CHECK (
    review_outcome = 'PENDING'
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  );


-- -----------------------------------------------------------------------------
-- 4. An insight is never edited
--
-- Append-only, like the ledger and the attendance log. What a model said is a
-- fact about what it said; correcting the text afterwards would leave the
-- prompt hash and the context hash describing something that no longer exists.
-- A review updates the review columns and nothing else.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qual.ai_insight_is_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.content, NEW.model_id, NEW.prompt_hash, NEW.context_hash, NEW.classification)
     IS DISTINCT FROM
     ROW(OLD.content, OLD.model_id, OLD.prompt_hash, OLD.context_hash, OLD.classification)
  THEN
    RAISE EXCEPTION
      'An AI insight cannot be edited. What the model said is a fact about what it said; the prompt and context hashes describe that text. Record a review instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_insight_immutable
  BEFORE UPDATE ON qual.ai_insight
  FOR EACH ROW EXECUTE FUNCTION qual.ai_insight_is_immutable();
