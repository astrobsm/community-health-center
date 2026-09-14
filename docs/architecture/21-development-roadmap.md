# 21 — Development Roadmap

Twelve controlled releases. A release ships only when it satisfies the Definition of Done in §2 —
the specification is explicit that no release may be skipped ahead of.

---

## 1. Definition of Done (spec §80)

A release is complete only when **all nine** hold:

| # | Requirement |
|---|---|
| 1 | Database migrations written, reviewed, applied, and tested on a restored dump |
| 2 | Validation on every input, shared between client and server |
| 3 | Permissions declared on every route; least-privilege verified by test |
| 4 | Audit coverage for every mutating action |
| 5 | Tests: unit, integration, and the release's acceptance test — all green |
| 6 | Error handling: no swallowed errors; Problem Details on every failure path |
| 7 | Responsive UI verified at 360 px, 768 px, and 1280 px |
| 8 | Offline support where the release's scope requires it |
| 9 | Documentation: API docs regenerated, architecture docs updated, runbook if operational |

---

## 2. Releases

### Release 0 — Architecture ✅

Architecture documents (this folder), ADRs, database schema, migrations, seed of structural
reference data, repository scaffolding, Docker Compose environment, CI pipeline, security baseline.

**Acceptance:** the schema migrates cleanly from empty; RLS, immutability and balance triggers are
proven by integration test; the architecture answers all eleven questions in spec §94.

---

### Release 1 — Foundation ✅

Authentication (Argon2id, EdDSA JWT, rotating refresh, MFA), organisations, facilities, departments,
services, users, roles, permissions, facility access scoping, audit log, system configuration,
notification skeleton, design system, application shell, admin screens.

**Acceptance:** a Super Administrator creates an organisation, a facility and a Facility Manager; the
manager logs in with MFA and sees only their facility; a cross-facility request returns 404 at the
API and zero rows at SQL; every action appears in the audit log with who/what/when/old/new/device.

**Verified by:** `npm run smoke:auth` — 24 checks against a running API and a real database.

---

### Release 2 — Field assessment ✅

Assessment templates and versioning, sections, items, the mobile assessment engine, offline capture,
evidence and photograph capture with compression, document upload and OCR hook, verification
workflow, facility condition index, readiness scoring, baseline sealing.

**Acceptance:** an assessor completes a full assessment offline on a phone with 20 photographs,
reconnects, everything syncs, the baseline is sealed, and a subsequent attempt to modify a sealed
baseline metric is refused at the database.

**Verified by:** `npm run smoke:assessment` (39 checks) and the Playwright suite on a Pixel 7
profile, which uploads real photographs to real object storage and asserts they arrive — an earlier
version of that test passed while zero objects reached the bucket.

---

### Release 3 — Planning ✅

Needs derivation from findings, recommendations, prioritisation scoring (P1–P4), CAPEX planning and
categories, working capital, risk register, compliance register, the five-year financial model with
four scenarios, sensitivity analysis, and the change-impact engine.

**Acceptance:** findings become needs become recommendations become capex lines; a model produces 60
periods with break-even and payback; changing a locked assumption is blocked until unlocked and
shows a full impact preview before it is applied.

**Verified by:** `npm run smoke:planning` — 67 checks end to end, including the full chain
F-0001 → N-0001 → R-0001 → costed line, a base case that breaks even in month 21 and pays back in
month 46, a stress case that reports no break-even at all rather than inventing one, `423 Locked`
on an approved assumption, and an unlock that supersedes rather than overwrites. The database
invariants behind it are proven separately by `npm run db:test-migrate` (41 checks).

---

### Release 4 — Partnership ✅

Partnership records, configurable revenue-share models, the ordered waterfall engine, obligations,
capital recovery tracking, government benefit computation, and partnership monitoring.

**Acceptance:** three distinct waterfall configurations (surplus share, gross revenue share, hybrid)
produce correct results against hand-computed fixtures, including cap and floor edge cases; changing
the model version does not alter a previously computed period.

**Verified by:** 47 unit tests over the engine (`waterfall.spec.ts`) covering all three
configurations against hand-computed figures, plus zero revenue, a loss-making month, an unaffordable
floor, a zero cap, double recovery of the same capital, and a conservation property asserted across
every configuration and ledger combination; and `npm run smoke:partnership` — 57 checks end to end,
in which September settles on version 1, a version 2 is then agreed from October, and September's
government entitlement is byte-for-byte what it was. Database invariants: 54 (up from 41).

---

### Release 5 — Documents

Document generation engine, provenance stamping, version control workflow, the seventeen document
types, letter generator, MOU generator with the mandatory draft banner, approval workflow.

**Acceptance:** a full proposal generates from real data with every figure classified; missing data
renders as an explicit gap and blocks submission; an approved version cannot be modified; the MOU
carries the draft banner on every page.

---

### Release 6 — Project execution

Projects, phases, tasks with dependencies and critical path, milestones, project budgets and
expenses, procurement (request → quotation → PO → GRN → invoice → payment), three-way match, asset
register, maintenance, commissioning, and before/during/after evidence.

**Acceptance:** criterion E and F — procurement creates an asset; the asset becomes operational only
when every commissioning check passes; a supplier invoice without a goods receipt cannot be paid.

---

### Release 7 — EMR

Patient registration with duplicate detection, identifiers, consent, encounters, triage with
generated BMI, clinical notes with amendment chains, diagnoses with ICD-10 and local synonyms,
procedures, referrals, appointments, the clinical timeline, and offline clinical capture.

**Acceptance:** the full clinical chain works offline and syncs; an amendment preserves every prior
version; the timeline renders a complete patient history; a consent withdrawal takes effect
immediately.

---

### Release 8 — Operations

Laboratory (catalogue, orders, samples, results, verification, QC, critical results), pharmacy
(verification, FEFO dispensing, returns), inventory (batches, the stock ledger, counts,
adjustments, alerts), billing, payments, the double-entry ledger, periods, and daily cash
reconciliation.

**Acceptance:** criteria G, H and I — dispensing atomically updates stock, charges and the ledger;
stock can never go negative; the daily cash identity balances; a critical lab result escalates until
acknowledged.

---

### Release 9 — People and quality

Staff, credentials with expiry alerts, postings, schedules, attendance (QR/PIN), leave, configurable
performance metrics, transparent incentive computation, incidents, complaints, clinical audits,
quality improvement cycles, and the KPI engine.

**Acceptance:** criterion J — attendance feeds performance feeds incentive, with the formula visible
and auditable at every step; patient volume alone cannot determine an incentive.

---

### Release 10 — Analytics

Role-specific dashboards, materialised views, drill-down from every figure to its source records,
baseline/current/target comparison, benchmarking, project health score, public value, the
clinical-versus-financial balance dashboard, the data quality engine, and global search.

**Acceptance:** criteria B and M — every dashboard figure is clickable down to source rows; the
baseline comparison reconciles; no dashboard renders a number without its classification and
timestamp.

---

### Release 11 — AI

The AI service with its read-only role, named query catalogue, grounded generation with numeric
validation, anomaly detection, predictive analytics with uncertainty intervals, and the AI assistant
surface.

**Acceptance:** every write attempt as the AI role fails at the database; a response containing an
ungrounded figure is rejected; disabling AI leaves every other feature working.

---

## 3. Sequencing logic

```
R0 ──► R1 ──► R2 ──► R3 ──► R4 ──► R5
                 │      │      │      │
                 └──────┴──────┴──────┴──► R6 ──► R7 ──► R8 ──► R9 ──► R10 ──► R11
```

- R1 is a hard prerequisite for everything: no feature ships without authentication, tenancy and
  audit already enforced.
- R2 before R3 because needs derive from findings — planning without a baseline would invent data.
- R5 can begin once R3 exists; documents improve as later releases add data, but the engine and
  provenance rules are needed early to keep the non-fabrication rule mechanical rather than manual.
- R7 before R8 because clinical activity is what generates the charges, lab orders and prescriptions
  that Release 8 processes.
- R10 last among the functional releases because there is nothing honest to analyse until the
  transactions exist.
- R11 last because the AI has nothing to be grounded in until then.

---

## 4. Per-release engineering checklist

```
[ ] Prisma schema + migration, reviewed
[ ] Raw SQL migration for views/triggers/RLS where needed
[ ] Zod contracts in packages/contracts
[ ] Repository, service, controller
[ ] Permission codes seeded and assigned to roles
[ ] Audit coverage confirmed by test
[ ] Unit tests on domain logic (≥95%)
[ ] Integration tests against real PostgreSQL
[ ] Release acceptance test
[ ] UI at 360/768/1280 px
[ ] Offline behaviour where in scope
[ ] OpenAPI regenerated and committed
[ ] Architecture docs updated in the same PR as the change
[ ] Seed data marked is_system_managed; no fixtures reachable in production
```
