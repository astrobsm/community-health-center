-- =============================================================================
-- assessment_response.not_applicable
--
-- "This does not apply here" is a different fact from "unanswered" and from
-- "answered zero". It was previously inferred from a null answer accompanied
-- by a note, which is fragile: a genuinely blank answer that happened to carry
-- a note would read as a deliberate exclusion.
--
-- The distinction matters because it drives the facility condition index: a
-- not-applicable item is EXCLUDED from scoring, not scored zero.
-- =============================================================================

ALTER TABLE assess.assessment_response
  ADD COLUMN not_applicable boolean NOT NULL DEFAULT false;

-- Backfill using the old heuristic so existing rows keep their meaning.
UPDATE assess.assessment_response
   SET not_applicable = true
 WHERE answer IS NULL
   AND note IS NOT NULL
   AND note <> '';

COMMENT ON COLUMN assess.assessment_response.not_applicable IS
  'Excluded from scoring rather than scored zero. See docs/architecture/00-product-architecture.md and the scoring domain module.';
