# ADR 0002 — Prisma for writes, hand-written SQL for analytics

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Principal Software Architect, Database Architect

## Context

The schema is ~160 tables across nine bounded contexts and will live for a decade. It needs a
reliable migration engine and a genuinely type-safe client. It *also* needs heavy analytical SQL —
window functions, lateral joins, recursive drill-down, materialised views — for the KPI,
benchmarking and lineage requirements.

No single tool is excellent at both.

## Decision

**Prisma 6 owns writes, simple reads, and schema migration.** A Prisma client extension injects the
tenancy predicate on every query.

**Hand-written, parameterised SQL owns analytics.** It lives in `src/**/sql/`, is version-identified
(`revenue_by_period.sql@v3`), returns Zod-validated shapes, and is tested against a containerised
PostgreSQL.

Views, triggers, RLS policies and append-only rules are hand-written SQL shipped as ordinary Prisma
migrations, so they are version-controlled and applied identically everywhere.

## Consequences

**Positive**
- Migration reliability at this scale, with reviewable generated SQL.
- Type safety on the write path, where a mistake corrupts data.
- Full SQL expressiveness on the read path, where the query builder would otherwise force awkward
  or slow constructions.
- Every reported figure has a named, versioned SQL identity — which is exactly what the lineage
  API exposes to users who dispute a number.

**Negative**
- Two mental models for data access. Mitigated by a hard rule: Prisma only inside a repository
  class; analytical SQL only inside `sql/`.
- Raw SQL loses compile-time type checking of results. Mitigated by Zod-validating every result set
  and testing each query against real data shapes.
- Prisma's generated client is large. Acceptable server-side; it never reaches the browser.

## Alternatives considered

- **Drizzle ORM** — a genuinely close call. SQL-first, lighter, better at analytical queries, and it
  would have unified the two models. Rejected because Prisma's migration tooling and ecosystem
  maturity matter more over a ten-year clinical system than syntax elegance, and because the
  analytics/write split is a boundary we want explicit anyway. Worth revisiting if Prisma's
  migration story regresses.
- **TypeORM** — migration reliability problems at this scale.
- **Knex or raw pg only** — no type safety on the write path; unacceptable for clinical and
  financial data.
- **Separate analytics warehouse from day one** — premature. The read-model boundary already exists,
  so CDC into a columnar store is a later change that touches nothing in the domain.
