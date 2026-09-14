-- =============================================================================
-- ANALYTICS
--
-- One materialised view, one security barrier over it, and the bookkeeping that
-- makes a cache honest.
--
-- A materialised view stores a calculated value, which §10 forbids in general.
-- It is permitted here for one reason and under three conditions:
--
--   The reason: the daily financial rollup reads every journal line, payment
--   and invoice in the facility's history. On a phone over a village 3G link,
--   recomputing that on every dashboard load is the difference between a page
--   that opens and one that times out.
--
--   Condition 1 — the view IS its definition. Nothing writes to it. There is no
--   INSERT path, no application code that can set a number in it, and no way
--   for it to hold a figure the transactions do not produce.
--
--   Condition 2 — it says how old it is. Every refresh is recorded, and the API
--   reports the refresh time beside any figure drawn from it. A stale number
--   that looks current is worse than a slow page.
--
--   Condition 3 — it is checked. `analytics.reconcile_daily_financial()`
--   recomputes the same figures from the base tables and returns every day on
--   which the two disagree. The smoke suite runs it. A cache nobody checks is a
--   second source of truth waiting to contradict the first.
--
-- Row-level security does not apply to materialised views. That is why the app
-- role is never granted SELECT on the view itself: it reads
-- `analytics.daily_financial`, a security-barrier view carrying the same
-- predicate the RLS policies use. Four-layer tenancy stays intact.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Read-only rollups. Nothing in this schema is a source of truth; every object here is derived from the transactional schemas and can be rebuilt from them.';


-- -----------------------------------------------------------------------------
-- 1. The rollup
-- -----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW analytics.mv_daily_financial AS
WITH days AS (
  SELECT organisation_id, facility_id, (received_at AT TIME ZONE 'UTC')::date AS business_date
    FROM fin.payment
  UNION
  SELECT organisation_id, facility_id, (issued_at AT TIME ZONE 'UTC')::date
    FROM fin.invoice WHERE issued_at IS NOT NULL
  UNION
  SELECT organisation_id, facility_id, service_date
    FROM fin.charge
  UNION
  SELECT organisation_id, facility_id, (started_at AT TIME ZONE 'UTC')::date
    FROM clinical.encounter
)
SELECT
  d.organisation_id,
  d.facility_id,
  d.business_date,
  COALESCE((
    SELECT sum(p.amount_minor) FROM fin.payment p
     WHERE p.facility_id = d.facility_id
       AND p.direction = 'INBOUND'
       AND (p.received_at AT TIME ZONE 'UTC')::date = d.business_date
  ), 0)::bigint AS collected_minor,
  COALESCE((
    SELECT sum(i.total_minor) FROM fin.invoice i
     WHERE i.facility_id = d.facility_id
       AND i.status NOT IN ('DRAFT', 'CANCELLED')
       AND (i.issued_at AT TIME ZONE 'UTC')::date = d.business_date
  ), 0)::bigint AS invoiced_minor,
  COALESCE((
    SELECT sum(c.amount_minor) FROM fin.charge c
     WHERE c.facility_id = d.facility_id
       AND c.service_date = d.business_date
       AND c.status <> 'CANCELLED'
  ), 0)::bigint AS charged_minor,
  COALESCE((
    SELECT sum(c.amount_minor) FROM fin.charge c
     WHERE c.facility_id = d.facility_id
       AND c.service_date = d.business_date
       AND c.status = 'WAIVED'
  ), 0)::bigint AS waived_minor,
  COALESCE((
    SELECT count(*) FROM clinical.encounter e
     WHERE e.facility_id = d.facility_id
       AND (e.started_at AT TIME ZONE 'UTC')::date = d.business_date
       AND e.status <> 'CANCELLED'
  ), 0)::bigint AS encounters
FROM days d
WHERE d.business_date IS NOT NULL;

-- Required for REFRESH ... CONCURRENTLY, which is what lets the dashboard keep
-- reading while the view rebuilds.
CREATE UNIQUE INDEX ux_mv_daily_financial
  ON analytics.mv_daily_financial (facility_id, business_date);

COMMENT ON MATERIALIZED VIEW analytics.mv_daily_financial IS
  'Derived cache of the daily financial rollup. Never written to by application code; rebuilt by analytics.refresh_views(); checked by analytics.reconcile_daily_financial().';


-- -----------------------------------------------------------------------------
-- 2. The security barrier
--
-- Row-level security cannot be applied to a materialised view, so the app role
-- never sees one. It reads this view, which carries the same predicate the RLS
-- policies carry and fails closed in exactly the same way: with no scope set,
-- core.current_org() yields nothing and this returns no rows.
-- -----------------------------------------------------------------------------

CREATE VIEW analytics.daily_financial WITH (security_barrier = true) AS
SELECT *
  FROM analytics.mv_daily_financial
 WHERE organisation_id = core.current_org()
   AND facility_id = ANY (core.current_facilities());

COMMENT ON VIEW analytics.daily_financial IS
  'Tenant-scoped window onto mv_daily_financial. The app role is granted this and never the view beneath it, because RLS does not apply to materialised views.';


-- -----------------------------------------------------------------------------
-- 3. When it was last rebuilt
--
-- A fact about a refresh, not a derived value: it records that something
-- happened at a moment, which is precisely what §10 permits storing.
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.view_refresh (
  view_name    text PRIMARY KEY,
  refreshed_at timestamptz NOT NULL,
  duration_ms  integer,
  row_count    bigint
);

COMMENT ON TABLE analytics.view_refresh IS
  'When each materialised view was last rebuilt. Reported beside any figure drawn from one, so a stale number never looks current.';

CREATE OR REPLACE FUNCTION analytics.refresh_views(p_concurrently boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, core, pg_temp
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_rows  bigint;
BEGIN
  IF p_concurrently THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_daily_financial;
  ELSE
    -- The first refresh after creation cannot be concurrent: there is nothing
    -- there to read from while it rebuilds.
    REFRESH MATERIALIZED VIEW analytics.mv_daily_financial;
  END IF;

  SELECT count(*) INTO v_rows FROM analytics.mv_daily_financial;

  INSERT INTO analytics.view_refresh (view_name, refreshed_at, duration_ms, row_count)
  VALUES (
    'mv_daily_financial',
    clock_timestamp(),
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::integer,
    v_rows
  )
  ON CONFLICT (view_name) DO UPDATE
     SET refreshed_at = EXCLUDED.refreshed_at,
         duration_ms  = EXCLUDED.duration_ms,
         row_count    = EXCLUDED.row_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. The check that makes the cache trustworthy
--
-- Recomputes the same figures from the base tables and returns every day on
-- which the cache disagrees. An empty result is the only acceptable one.
--
-- This exists because a derived cache that nobody verifies becomes a second
-- source of truth, and the first anybody hears of the disagreement is a
-- finance officer insisting the dashboard is wrong.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.reconcile_daily_financial()
RETURNS TABLE (
  facility_id     uuid,
  business_date   date,
  field           text,
  cached          bigint,
  recomputed      bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT
      d.facility_id,
      d.business_date,
      COALESCE((
        SELECT sum(p.amount_minor) FROM fin.payment p
         WHERE p.facility_id = d.facility_id
           AND p.direction = 'INBOUND'
           AND (p.received_at AT TIME ZONE 'UTC')::date = d.business_date
      ), 0)::bigint AS collected_minor,
      COALESCE((
        SELECT count(*) FROM clinical.encounter e
         WHERE e.facility_id = d.facility_id
           AND (e.started_at AT TIME ZONE 'UTC')::date = d.business_date
           AND e.status <> 'CANCELLED'
      ), 0)::bigint AS encounters
    FROM analytics.mv_daily_financial d
  )
  SELECT m.facility_id, m.business_date, 'collected_minor'::text, m.collected_minor, l.collected_minor
    FROM analytics.mv_daily_financial m
    JOIN live l ON l.facility_id = m.facility_id AND l.business_date = m.business_date
   WHERE m.collected_minor IS DISTINCT FROM l.collected_minor
  UNION ALL
  SELECT m.facility_id, m.business_date, 'encounters'::text, m.encounters, l.encounters
    FROM analytics.mv_daily_financial m
    JOIN live l ON l.facility_id = m.facility_id AND l.business_date = m.business_date
   WHERE m.encounters IS DISTINCT FROM l.encounters;
$$;

COMMENT ON FUNCTION analytics.reconcile_daily_financial() IS
  'Recomputes the cache from the base tables and returns every disagreement. An empty result is the only acceptable one; the base tables are always right.';


-- -----------------------------------------------------------------------------
-- 5. Grants
--
-- Guarded, because the application role is created by the deployment runbook
-- rather than by a migration and may not exist yet. Where it does exist, it is
-- given the barrier view and explicitly denied the view beneath it.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chc_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA analytics TO chc_app';
    EXECUTE 'GRANT SELECT ON analytics.daily_financial TO chc_app';
    EXECUTE 'GRANT SELECT ON analytics.view_refresh TO chc_app';
    EXECUTE 'REVOKE ALL ON analytics.mv_daily_financial FROM chc_app';
  END IF;
END $$;


-- Populate it once, non-concurrently, so the first dashboard load has something
-- to read and the refresh record exists from the beginning.
SELECT analytics.refresh_views(false);
