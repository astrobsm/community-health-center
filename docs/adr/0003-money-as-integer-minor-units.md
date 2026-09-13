# ADR 0003 — Money as integer minor units

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Financial Systems Architect, Database Architect

## Context

The platform handles patient billing, supplier payments, a double-entry ledger, a five-year
projection model, and a partnership waterfall that determines what a government and a private
partner each receive. Arithmetic errors here are not cosmetic: they change what people are paid.

JavaScript's `number` is IEEE-754 double precision. `0.1 + 0.2 !== 0.3`. Accumulating rounding drift
across thousands of transactions produces a ledger that does not balance, and a balance trigger that
rejects valid entries.

## Decision

**All monetary amounts are integers in minor units (kobo), stored as `BIGINT`, with an explicit
`currency char(3)` alongside.**

- Database: `amount_minor bigint NOT NULL`, `currency char(3) NOT NULL DEFAULT 'NGN'`.
- API: `{ "amountMinor": 482000000, "currency": "NGN" }`. Never a decimal string, never a float.
- Application: arithmetic through `packages/contracts/src/money.ts`; `bigint` where values may
  exceed `Number.MAX_SAFE_INTEGER` (₦90 trillion in kobo — beyond this system's range, but the type
  costs nothing).
- Rounding is **explicit and never implicit**. `allocate()` distributes a total across shares with
  the largest-remainder method, guaranteeing the parts sum exactly to the whole.
- Percentages and rates use `numeric(12,6)` — they are not money and do not need exactness in the
  same way, but they must not be floats either.

## Consequences

**Positive**
- Exact arithmetic. A ledger that balances, always.
- Unambiguous equality comparison.
- No locale or serialisation ambiguity across the wire.
- The waterfall's cap/floor logic is exact at the boundary, where it matters most.

**Negative**
- Every display requires conversion. Mitigated by a single `formatMoney()` helper used everywhere.
- `bigint` does not serialise to JSON natively. Mitigated by an explicit serialiser and Zod
  transforms in the contracts package.
- Developers must remember the unit. Mitigated by naming: every field is `*_minor` / `amountMinor`,
  never a bare `amount`. A lint rule flags monetary-looking names without the suffix.

## Alternatives considered

- **`numeric(19,4)` in PostgreSQL with decimal.js** — exact and conventional. Rejected because it
  requires a decimal library on both tiers, and serialising decimals across JSON reintroduces
  string/float ambiguity at exactly the boundary we most want to be unambiguous.
- **Floats** — never, for money.
- **Currency-agnostic minor-unit scale** — over-engineering for a single-currency deployment. The
  `currency` column is present, so a second currency is a migration and a scale table, not a rewrite.
