# ADR 0001 — TypeScript monorepo with shared contracts

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Principal Software Architect

## Context

The platform spans a field PWA that captures data offline for days, a transactional API, background
workers, and an analytics layer. The dominant defect risk across that surface is **shape drift** —
a record captured on a device in a form the server later rejects, or an API field the UI does not
expect. In a system where a rejected sync means a lost day of field assessment, that risk is not
theoretical.

## Decision

One language (TypeScript) across server, client, workers and tooling, in an npm-workspaces monorepo,
with a `packages/contracts` workspace holding Zod schemas as the single definition of every request
and response shape. Both tiers import the same schema object.

## Consequences

**Positive**
- Validation is provably identical on the device and on the server; an offline record validated at
  capture time cannot fail schema validation at sync.
- Refactors are atomic across tiers; a breaking contract change fails the build immediately.
- One toolchain, one lint configuration, one test runner.
- OpenAPI is generated from the same Zod schemas, so documentation cannot drift from validation.

**Negative**
- Node's single-threaded model is a poor fit for CPU-heavy work. Mitigated by pushing PDF rendering
  and forecasting into workers.
- A monorepo needs discipline to keep module boundaries honest. Mitigated by the enforced dependency
  rules in `docs/architecture/05-module-dependency-map.md` and `npm run check:boundaries`.
- `packages/contracts` must stay free of runtime dependencies on Nest, React or Prisma. Enforced by
  a lint rule.

## Alternatives considered

- **Python/Django backend** — strong ecosystem, but a second language in the browser reintroduces
  exactly the drift this decision eliminates, and static guarantees over a 160-table domain are
  weaker.
- **Java/Spring** — excellent typing and maturity; heavier operationally for a single-facility
  deployment, and a smaller local hiring pool for this profile.
- **Polyrepo** — cleaner ownership boundaries, but cross-tier contract changes would span pull
  requests and lose atomicity, which is the whole point.
