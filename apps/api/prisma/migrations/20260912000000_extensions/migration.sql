-- =============================================================================
-- Extensions
--
-- Runs BEFORE the initial schema because the schema depends on citext for
-- case-insensitive email, and the invariants migration depends on btree_gist
-- and pg_trgm.
-- =============================================================================

-- Case-insensitive email. Storing 'A.Okeke@x.org' and 'a.okeke@x.org' as two
-- different users is a real-world account-duplication bug, not a theoretical one.
CREATE EXTENSION IF NOT EXISTS citext;

-- gen_random_uuid(), digest() for the audit hash chain and content hashes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram indexes for global fuzzy search over patients, staff, assets and
-- medicines (spec §60). A clerk searching "Okeke" must find "Okeké".
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Exclusion constraints — used to prevent overlapping staff postings.
CREATE EXTENSION IF NOT EXISTS btree_gist;
