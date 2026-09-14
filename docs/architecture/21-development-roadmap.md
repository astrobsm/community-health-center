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

### Release 5 — Documents ✅

Document generation engine, provenance stamping, version control workflow, the seventeen document
types, letter generator, MOU generator with the mandatory draft banner, approval workflow.

**Acceptance:** a full proposal generates from real data with every figure classified; missing data
renders as an explicit gap and blocks submission; an approved version cannot be modified; the MOU
carries the draft banner on every page.

**Verified by:** 47 unit tests over the gap, classification, hashing and merge engines, and
`npm run smoke:documents` — 63 checks end to end, in which a proposal with nothing behind it renders
four explicit gaps and is refused at submission with `422 document-incomplete`, a capital plan
generated from a real costed line carries a classification on every figure and a verifiable content
hash, the database refuses to alter the approved version, regenerating supersedes it while leaving
it retrievable, and an MOU assembled from the configured waterfall carries the draft banner on every
section until the signed file and two signatories are recorded.

**Deferred with reason:** PDF and DOCX production. The rendered artefact is HTML, stored in object
storage and hashed; the print CSS carries the banner and page furniture. Producing PDF through
headless Chromium and DOCX through docxtemplater needs the queued worker of doc 16 §2, because a
synchronous browser render inside a request thread would block it for tens of seconds. Every
generation response states the format it produced rather than implying a PDF exists.

---

### Release 6 — Project execution ✅

Projects, phases, tasks with dependencies and critical path, milestones, project budgets and
expenses, procurement (request → quotation → PO → GRN → invoice → payment), three-way match, asset
register, maintenance, commissioning, and before/during/after evidence.

**Acceptance:** criterion E and F — procurement creates an asset; the asset becomes operational only
when every commissioning check passes; a supplier invoice without a goods receipt cannot be paid.

**Verified by:** 65 unit tests over the three-way match, the critical-path scheduler and the
commissioning gate, and `npm run smoke:execution` — 71 checks end to end, in which ten capital units
received become ten individually tagged assets, an asset is refused commissioning on four of five
checks and accepted on five, and an invoice raised before anything arrived is blocked with
`409 three-way-match-failed`. Database invariants: 70 (up from 54), including the payment trigger
that refuses an unreceipted invoice whoever is calling.

**Deferred with reason:** consumable lines create a goods-receipt line but not yet an inventory
batch. Stock batches, FEFO and the stock ledger are Release 8; creating half a batch record now
would leave `quantity_on_hand` disagreeing with the ledger from the first receipt. Capital lines —
which the acceptance criterion turns on — create assets in full.

---

### Release 7 — EMR ✅

Patient registration with duplicate detection, identifiers, consent, encounters, triage with
generated BMI, clinical notes with amendment chains, diagnoses with ICD-10 and local synonyms,
procedures, referrals, appointments, the clinical timeline, and offline clinical capture.

**Acceptance:** the full clinical chain works offline and syncs; an amendment preserves every prior
version; the timeline renders a complete patient history; a consent withdrawal takes effect
immediately.

**Verified by:** 61 unit tests over MRN checksums, duplicate scoring, the amendment chain and the
consent engine, and `npm run smoke:clinical` — 62 checks end to end, in which a signed note is
refused edit with `409 clinical-record-immutable`, two amendments leave both prior versions readable
with their reasons on the timeline, and a withdrawn consent reads as withdrawn on the very next
request. Database invariants: 87 (up from 70), including triggers that refuse to edit or delete a
signed note, to un-withdraw a consent in place, or to merge a record into a tombstone.

**Deferred with reason:** prescribing, laboratory orders and results are modelled in the schema but
not yet built — they are Releases 8 and 9, where they join the stock ledger and the charge posting
that make them mean something. Offline clinical capture travels through the outbox and sync engine
built and tested in Release 2; no new sync machinery was needed, and the Playwright suite covers it.

---

### Release 8 — Operations ✅

Laboratory (catalogue, orders, samples, results, verification, QC, critical results), pharmacy
(verification, FEFO dispensing, returns), inventory (batches, the stock ledger, counts,
adjustments, alerts), charges, the double-entry ledger, periods, and daily cash reconciliation.

*Corrected during R10:* this entry originally read "billing, payments". What shipped was charges
raised by dispensing and the laboratory, and the ledger they post to. Nothing created an invoice or
a patient payment until Release 10 built the `billing` module, which is where those belong in this
list's history.

**Acceptance:** criteria G, H and I — dispensing atomically updates stock, charges and the ledger;
stock can never go negative; the daily cash identity balances; a critical lab result escalates until
acknowledged.

**Verified by:** 58 unit tests over FEFO, the posting rules and the escalation ladder, and
`npm run smoke:operations` — 74 checks end to end, in which one dispensing writes two stock
movements, a charge and two journal entries in a single transaction; the database refuses to drive a
batch negative; a potassium of 7.2 is withheld until verified, then escalates until a named clinician
acknowledges it with what they did; and the trial balance closes at 514,000 kobo on both sides.
Database invariants: 98 (up from 87).

**Deferred with reason:** laboratory quality control, multi-location stock transfers and supplier
returns. Each is modelled in the schema and none is on an acceptance criterion; building them thinly
alongside the three criteria above would have meant less care where a patient is actually at risk.
Stock counts are served by the adjustment path with its reason and second approver; the blind-count
workflow of doc 14 §5 is not yet built.

---

### Release 9 — People and quality ✅

Staff, credentials with expiry alerts, postings, schedules, attendance (QR/PIN), leave, configurable
performance metrics, transparent incentive computation, incidents, complaints, clinical audits,
quality improvement cycles, and the KPI engine.

**Acceptance:** criterion J — attendance feeds performance feeds incentive, with the formula visible
and auditable at every step; patient volume alone cannot determine an incentive.

**Verified by:** 56 unit tests over the attendance, incentive and credential engines, and
`npm run smoke:people` — 95 checks end to end, in which a nurse's three rostered shifts become an
attendance figure, that figure becomes a performance score, and that score becomes an incentive whose
components sum to its total to the kobo and each of which states its own arithmetic in words.

The volume rule is proved twice, because it is the one that matters. A metric set in which patient
volume is the only weighted metric is refused at configuration. A person for whom only the volume
metric could be computed — every quality metric returned nothing — is refused at computation, even
though the configuration itself is sound.

Segregation of duties is proved at both layers: the HR officer who computed an incentive does not
hold the approval permission at all, and a facility manager who holds *both* permissions is still
refused approval of an incentive they computed themselves, by the service and by a CHECK constraint
that refuses the same self-approval written in raw SQL.

Database invariants: 113 (up from 98).

**Two things this release found in earlier work.** `SEGREGATION_OF_DUTIES` named two permissions that
did not exist — `inventory.adjust.approve` and `performance.compute_incentive` — so two documented
controls were unenforceable in fact; both now exist, are granted, and a test asserts that every side
of every rule names a real permission held by an assignable role. That test also showed that only the
finance officer could close a period, making "the person posting entries may not close the period"
satisfiable only by hiring a second finance officer; the administrator, who cannot post, now holds it.
Separately, `encounter.attending_staff_id` was being set to the logged-in user's id rather than their
staff record's, so every per-clinician metric would have matched nothing.

**Deferred with reason:** leave requests and approvals, performance reviews with staff
acknowledgement, and 27 of the 35 registry KPIs whose named queries are not yet written. The KPI
registry reports `computable: false` for those and assignment is refused rather than returning an
empty chart — the gap is visible rather than papered over. Clinical audit cycles are served by the
improvement-cycle path, which requires a measured indicator before a review can be recorded.

---

### Release 10 — Analytics ✅

Role-specific dashboards, a materialised daily rollup, drill-down from every figure to its source
records, baseline/current/target comparison, benchmarking, project health score, public value, the
clinical-versus-financial balance, the data quality engine, and global search. Billing — invoices,
payments and waivers — was built here; see below.

**Acceptance:** criteria B and M — every dashboard figure is clickable down to its source rows; the
baseline comparison reconciles; no dashboard renders a number without its classification and
timestamp.

**Verified by:** 34 unit tests over the comparison, data quality, benchmark and project health
engines, 16 over the figure schema itself, and `npm run smoke:analytics` — 69 checks end to end in
which a consultation becomes a charge, an invoice, a payment and two journal lines, and the chain is
then walked in both directions: payment to invoice to charge to encounter to patient, and encounter
to charge to invoice to payment to journal entry. Database invariants: 125 (up from 113).

**"No number without its provenance" is a mechanism, not a convention.** Every dashboard payload is
parsed through `figureSchema` on the way out. A figure lacking a classification, a computation time,
the named query behind it or the tables that query read fails the request rather than rendering. So
does a figure that is neither clickable down to its rows nor says in words why it has none, and so
does a suppressed figure that still carries the value it claims to withhold. The smoke suite asserts
this over *every* figure on the page rather than sampling one, because a rule that holds for the
figure somebody remembered to check is not a rule.

**Permission is re-evaluated at every hop.** A figure carries its own permission, not its section's,
so a government observer opening the facility overview sees the incident count and not the revenue.
Walking the lineage chain, the observer reaches the encounter and stops: the patient node is absent
with its reason stated, rather than present and greyed out — a disabled link still tells you the
record exists.

**The one cached figure.** `analytics.mv_daily_financial` exists because recomputing the daily
rollup over every journal line on a village 3G link is the difference between a page that opens and
one that times out. It is permitted under three conditions, all enforced: nothing writes to it;
every response drawn from it carries the moment it was last rebuilt and says so when that is stale;
and `analytics.reconcile_daily_financial()` recomputes the same figures from the base tables and
returns every disagreement, with the refresh endpoint and the invariant suite both running it.
Row-level security does not apply to a materialised view, so the application role is never granted
it — it reads a security-barrier view carrying the same predicate, which the invariant suite proves
returns nothing without a tenant scope.

**Billing was missing and is now built.** Release 8 recorded charges from dispensing and the
laboratory, and recorded the ledger, but nothing in the system ever created an invoice or a patient
payment — so Chain 1 of doc 22, care to money, could not be walked past the charge. Criterion M
depends on that chain, so `billing` was built here: invoices issued from charges, payments with
explicit allocations, waivers that reverse their own revenue posting, and eleven database invariants
including deferred triggers that refuse an invoice whose recorded payments disagree with the
allocations against it, and a payment allocated to more than it was worth.

**Deferred with reason:** the drill-down stops at the transaction list rather than continuing to a
scanned source document, because evidence attachment on financial records is not yet modelled.
Downstream tracing from an asset or a journal entry reports that it is not implemented rather than
returning an empty list. Benchmarking runs across the facilities of one organisation; comparing
across organisations raises questions of consent between partners that nobody has yet answered.

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
