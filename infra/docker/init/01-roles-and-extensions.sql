-- =============================================================================
-- Bootstrap: roles, schemas and extensions
--
-- Runs once, on first container start, as the superuser.
--
-- Three roles with deliberately different powers (ADR 0005, doc 17 §1):
--   chc_migrator  owns the schema, BYPASSRLS, used only by migrations
--   chc_app       runtime role, subject to RLS, no DDL
--   ai_reader     SELECT on the analytics schema and nothing else
-- =============================================================================

-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy global search
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints (staff postings)
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Schemas ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS core;       -- tenancy, identity, configuration
CREATE SCHEMA IF NOT EXISTS assess;     -- assessments, evidence, baseline
CREATE SCHEMA IF NOT EXISTS plan;       -- needs, capex, model, partnership, contracts
CREATE SCHEMA IF NOT EXISTS exec;       -- projects, procurement, assets
CREATE SCHEMA IF NOT EXISTS clinical;   -- patients, encounters, lab, pharmacy
CREATE SCHEMA IF NOT EXISTS supply;     -- inventory and the stock ledger
CREATE SCHEMA IF NOT EXISTS fin;        -- accounts, billing, payments, journal
CREATE SCHEMA IF NOT EXISTS people;     -- staff, attendance, performance
CREATE SCHEMA IF NOT EXISTS qual;       -- kpi, quality, risk, compliance
CREATE SCHEMA IF NOT EXISTS audit;      -- audit log, sync events, outbox
CREATE SCHEMA IF NOT EXISTS analytics;  -- views and materialised views ONLY

COMMENT ON SCHEMA analytics IS
  'Read-models only. The AI role has SELECT here and nowhere else. No table in this schema may be written by application code.';

-- Runtime application role ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chc_app') THEN
    CREATE ROLE chc_app LOGIN PASSWORD 'devpassword';
  END IF;
END $$;

GRANT CONNECT ON DATABASE chc TO chc_app;
GRANT USAGE ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit, analytics TO chc_app;

-- chc_app may read and write data, but never change the schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
  core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO chc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA
  core, assess, plan, exec, clinical, supply, fin, people, qual, audit TO chc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE chc_migrator IN SCHEMA
  core, assess, plan, exec, clinical, supply, fin, people, qual, audit
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chc_migrator IN SCHEMA analytics
  GRANT SELECT ON TABLES TO chc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chc_migrator IN SCHEMA
  core, assess, plan, exec, clinical, supply, fin, people, qual, audit
  GRANT USAGE, SELECT ON SEQUENCES TO chc_app;

-- AI role: analytics SELECT and absolutely nothing else -----------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_reader') THEN
    CREATE ROLE ai_reader LOGIN PASSWORD 'devpassword';
  END IF;
END $$;

GRANT CONNECT ON DATABASE chc TO ai_reader;
GRANT USAGE ON SCHEMA analytics TO ai_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO ai_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE chc_migrator IN SCHEMA analytics
  GRANT SELECT ON TABLES TO ai_reader;

-- Explicitly ensure the AI role has no path to the transactional schemas.
-- This is the isolation guarantee in doc 17 §1: it is a grant, not a convention.
REVOKE ALL ON SCHEMA core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader;

-- The migration role bypasses RLS; the application role must not.
ALTER ROLE chc_migrator BYPASSRLS;
ALTER ROLE chc_app NOBYPASSRLS;
ALTER ROLE ai_reader NOBYPASSRLS;

-- Sensible per-role defaults --------------------------------------------------
ALTER ROLE chc_app SET statement_timeout = '15s';
ALTER ROLE chc_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE ai_reader SET statement_timeout = '30s';
ALTER ROLE ai_reader SET default_transaction_read_only = on;
