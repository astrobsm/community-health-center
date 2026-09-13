# ADR 0005 — Four-layer tenancy enforcement

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Cybersecurity Engineer, Database Architect

## Context

The specification is unambiguous (§9): a user from one facility must not access another facility's
data. Today there is one facility; the architecture must scale to many, across LGAs and states, and
the first cross-tenant leak in a clinical system is the last one anybody forgives.

Application-layer filtering alone fails predictably: someone writes a new repository method and
forgets the `where` clause, or runs a maintenance script, or adds a raw query for a report.

## Decision

Enforce tenancy at **four independent layers**, each of which is sufficient on its own.

1. **Request guard.** `TenancyGuard` resolves the caller's organisation and facility set from the
   session — **never from a request parameter** — and pins it into `AsyncLocalStorage`.
2. **ORM extension.** A Prisma client extension injects `organisation_id` and `facility_id`
   predicates into every query on a tenant-scoped model. A developer gets this whether or not they
   remember it.
3. **PostgreSQL row-level security.** Every tenant table has `ENABLE`/`FORCE ROW LEVEL SECURITY`
   with a policy reading `current_setting('app.current_org')` and `app.current_facilities`, which the
   application sets per transaction with `SET LOCAL`. Raw SQL, scripts and any ORM bypass are
   covered.
4. **Response mapping.** Explicit DTOs plus field-level redaction based on `*.read_identified`, so a
   newly added sensitive column cannot leak by default.

`SET LOCAL` rather than `SET` is essential: the setting dies with the transaction, so a pooled
connection cannot carry one user's scope into another user's request.

## Consequences

**Positive**
- Any single-layer mistake is caught by another layer.
- RLS protects against the paths most likely to be forgotten — migrations, ad-hoc queries,
  maintenance scripts, future services.
- The tenant scope can never be influenced by client input.
- Out-of-scope records return 404 rather than 403, so the existence of another facility's data is
  not disclosed.

**Negative**
- RLS carries a query-planning cost. Measured as acceptable; the mandatory
  `(organisation_id, facility_id)` index on every tenant table keeps plans sane.
- Migrations must run under a role that bypasses RLS, which must be operationally separate from the
  application role. Documented in the deployment runbook.
- Forgetting to set the session variables causes queries to return nothing. This is the correct
  failure direction — fail closed, loudly — and integration tests assert it.

## Verification

`tenancy-isolation.spec.ts` and `rls-enforcement.spec.ts` assert that a cross-facility read returns
404 at the API **and** zero rows when executed as raw SQL under the application role. A regression in
any layer fails the build.
