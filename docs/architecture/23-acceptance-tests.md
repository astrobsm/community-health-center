# 23 — Acceptance Test Definitions

How each release and each architectural success criterion is validated. These are contracts: a
release is not complete until its test passes against a real database.

---

## 1. Architectural success criteria (spec §92)

### A — Assessment data can become baseline data
`baseline.seal.spec.ts`

**Given** a submitted field assessment with 120 responses, 40 findings and 60 verified evidence items
**When** the baseline is sealed
**Then** a `baseline_snapshot` exists with `sequence = 1`; `baseline_metric` rows exist for every
configured metric; each carries its source reference and classification; a content hash is stored;
and any subsequent `UPDATE` or `DELETE` on a metric raises a database exception.
**And** sealing a second time creates `sequence = 2` without altering `sequence = 1`.

### B — Baseline data can be compared with current data ✅
`apps/api/src/modules/analytics/domain/analytics.spec.ts` and `apps/api/scripts/smoke-analytics.sh`

**Given** a sealed baseline of 8 patients/day and encounters recorded since
**Then** the comparison returns the baseline from the snapshot, the current value computed from
`clinical.encounter`, the target from the KPI assignment, the change between them, and the
denominator the current value rests on.
**And** `baseline_metric` cannot be mutated at all — the smoke suite attempts it and the immutability
trigger refuses — so the stronger property holds: the baseline is not merely a different number, it
is a number nothing can change.

The two halves are read by different queries from different tables and handed to a pure engine that
has no way to fetch either, so conflating them is structurally impossible rather than discouraged.
A comparison missing either half reports `comparable: false` with the reason in words: a current
value with no baseline claims no improvement, and a missing current value is an absence of
measurement rather than a fall to zero.

### C — Findings can become projects
`finding-to-project.spec.ts`

Finding → need → recommendation → capex line → capital project, with `capital_project.recommendation_id`
resolving back to the originating finding and its evidence. Creating a project with no recommendation
requires an explicit `unplanned_reason`.

### D — Projects can consume budgets
`project-budget.spec.ts`

Budgeted → approved → committed → spent, each transition requiring its evidence (approval record,
purchase order, posted payment). Spent may not exceed approved without an override record naming an
approver. `spent` is always computed from postings, never typed.

### E — Procurement can create assets
`grn-to-asset.spec.ts`

A goods receipt line for a capital item creates an `equipment_asset` with a unique asset tag,
`goods_receipt_line_id` populated, cost taken from the receipt, and commissioning status `RECEIVED`.
A consumable line creates an `inventory_batch` instead, never an asset.

### F — Assets can become operational resources
`commissioning.spec.ts`

An asset reaches `COMMISSIONED` only when functional test, safety check, staff training, consumable
availability and utility connection are all recorded. Until then it does not count toward service
readiness, and the related `service_offering` cannot be activated.

### G — Clinical encounters can create revenue
`encounter-to-ledger.spec.ts`

Closing an encounter with a consultation and a procedure raises charges priced from the tariff
version in force on the service date, produces an invoice, and on payment posts a balanced journal
entry whose `source_id` is the payment. Revenue reported for the period equals the sum of those
credit lines exactly.

### H — Pharmacy dispensing updates inventory and finance
`dispense-to-stock-ledger.spec.ts`

One dispensing produces, atomically: a `dispensing` row; a negative `stock_transaction`; a decremented
batch cache equal to the recomputed ledger sum; a `charge`; and journal entries for both revenue and
cost of goods. Forcing a failure at the final step rolls back every one of them.

### I — Laboratory activity updates clinical and financial records
`lab-order-to-result.spec.ts`

Order raises a charge and consumes reagent stock; sample and accession recorded; result entered is
invisible to clinicians until verified; on verification it appears in the timeline; turnaround time
is computed from timestamps; a critical flag raises an escalating notification.

### J — Attendance can feed performance ✅
`apps/api/src/modules/people/domain/people.spec.ts` and `apps/api/scripts/smoke-people.sh`

Clock events → attendance rate and punctuality → weighted performance metrics → an incentive whose
total equals the sum of its components and whose formula text is stored. **Patient volume alone
cannot determine the incentive** (spec §25), and this is asserted in three independent places:

- `assertScorable` refuses a metric set whose weighted metrics are all volume, refuses one where
  volume carries more than the configured ceiling of the total weight, and is re-run at computation
  against the metrics that could *actually* be scored — so a month in which every quality query
  returns nothing does not quietly leave volume standing alone;
- `isVolumeMetric` is read from the query catalogue, not from the metric row, so a volume query
  cannot be relabelled as a quality metric by editing a field;
- the smoke suite proves both refusals against a running API and a real database.

An unclosed shift is the case the engine is shaped around: somebody clocked in and never clocked out.
It counts as present — they were there — its hours are excluded from the totals rather than counted
as zero, and the period is flagged for review before it pays anybody. Recording it as zero hours
would take money from somebody who worked; recording it as a full shift would pay for hours nobody
can evidence.

### K — Financial data can feed partnership calculations
`waterfall.spec.ts`

Posted ledger totals feed the configured waterfall, in order, honouring caps and floors, producing
government entitlement, partner capital recovery and residual. Three different model configurations
(surplus share, gross revenue share, hybrid) match hand-computed fixtures. Changing the model version
does not alter a previously computed period.

### L — All major outputs can be audited
`audit-coverage.spec.ts`

Enumerates every mutating route, exercises each, and asserts a corresponding `audit_log` row with
actor, action, entity, old value, new value, device and trace id. A route producing no audit row
fails the build.

### M — All major metrics can be traced to their source ✅
`apps/api/src/modules/analytics/lineage.service.ts`, `packages/contracts/src/analytics.spec.ts`
and `apps/api/scripts/smoke-analytics.sh`

Two halves, both mechanical.

**Every figure carries its provenance.** `figureSchema` refuses a figure without a classification, a
computation time, the named query behind it and the tables that query read; refuses one that is
neither clickable down to its rows nor says why it has none; and refuses a suppressed figure that
still carries its value. Every dashboard payload is parsed through it on the way out, so a bare
number fails the request instead of rendering. The smoke suite checks this over every figure on the
page, not a sample.

**Every figure opens onto its rows, and the rows onto their records.** From the revenue total to the
payments, from a payment to the invoice, the charge, the encounter and the patient — each hop a
foreign key, each hop re-checked against the caller's permissions. A hop beyond the caller is absent
with its reason stated rather than present and disabled. A link the data does not have is reported
as broken rather than passed over, so a hole never looks like the end of the chain.

Classification travels with the walk: the chain reports the weakest classification of every node in
it, so a chain resting on one estimate cannot present itself as actual.

### N — The system can operate offline
`offline-sync.e2e.ts`

Playwright: go offline, complete a full assessment with 20 photographs and a clinical encounter,
reconnect, and assert that everything synced, conflicts were detected rather than overwritten, and
media uploaded.

### O — The system can scale to additional facilities
`tenancy-isolation.spec.ts`

Two facilities with identical data shapes. A user of facility A receives 404 for facility B's
records at the API and zero rows when querying directly as the application role. Aggregates never
cross tenants.

---

## 2. The end-to-end acceptance test (spec §78)

`acceptance/full-chain.e2e.ts` — the single test that defines "the system works".

| Step | Asserted |
|---|---|
| 1. Create facility | Lifecycle stage `PRE_ASSESSMENT` |
| 2. Pre-assessment | Submitted; stage advances |
| 3. Field assessment | 120 responses; completion percentage computed |
| 4. Photographic evidence | 20 items uploaded, hashed, linked to findings |
| 5. Baseline | Sealed; immutable; Day 0 recorded |
| 6. Gap analysis | Findings → needs → recommendations, prioritised P1–P4 |
| 7. Capital plan | CAPEX lines across categories; totals reconcile |
| 8. Financial model | 60 periods; break-even and payback identified |
| 9. Partnership model | Waterfall computes; government benefit and partner return derived |
| 10. Proposal | Generated with full provenance; every figure classified |
| 11. Letter | Generated from template with a configured recipient |
| 12. MOU | DOCX with the mandatory draft banner on every page |
| 13. Project | Created from a recommendation; tasks, milestones, critical path |
| 14. Procurement | Request → PO → GRN → invoice → payment; three-way match passes |
| 15. Asset commissioning | Asset created from the receipt; commissioned with all checks |
| 16. Go live | Stage `LIVE_OPERATIONS`; Mode B modules become available |
| 17. Patient | Registered with a facility MRN and consent |
| 18. Encounter | Opened, triaged (BMI generated), diagnosed, closed |
| 19. Lab | Ordered, sampled, resulted, verified; TAT computed |
| 20. Pharmacy | Prescribed, verified, dispensed FEFO; stock decremented |
| 21. Payment | Received; invoice settled |
| 22. Finance | Ledger balanced; daily cash reconciliation identity holds |
| 23. KPI | Computed from transactions, not typed |
| 24. Baseline vs current | Delta reflects exactly the activity created |
| 25. Management report | Generated; **every figure reconciles to the transactions created in this test** |

Step 25 is the real assertion. The report's patient count must equal the encounters created; its
revenue must equal the posted ledger; its stock position must equal the ledger sum. If a number in
the final PDF cannot be reproduced from the data the test itself created, the test fails.

---

## 3. Workflow suites (spec §77)

| Suite | File | Chain |
|---|---|---|
| Assessment | `workflows/assessment.spec.ts` | create → evidence → verify → baseline |
| Project | `workflows/project.spec.ts` | finding → project → budget → procurement → completion |
| Clinical | `workflows/clinical.spec.ts` | patient → encounter → diagnosis → lab → prescription |
| Laboratory | `workflows/laboratory.spec.ts` | order → sample → result → verification |
| Pharmacy | `workflows/pharmacy.spec.ts` | prescription → dispensing → stock deduction |
| Finance | `workflows/finance.spec.ts` | charge → invoice → payment → ledger → reconciliation |
| Inventory | `workflows/inventory.spec.ts` | purchase → receipt → stock → issue → reconciliation |
| HR | `workflows/hr.spec.ts` | roster → attendance → performance → incentive |
| Longitudinal | `workflows/longitudinal.spec.ts` | baseline → intervention → current → comparison |

---

## 4. Non-fabrication tests

These enforce spec §§5, 10, 82, 91 mechanically rather than by review.

| Test | Asserts |
|---|---|
| `no-fabricated-data.spec.ts` | The production seed contains no patients, encounters, payments or stock |
| `no-hardcoded-metrics.spec.ts` | Static analysis: no numeric literal is returned as a business metric |
| `classification-required.spec.ts` | Every quantitative API field carries a classification |
| `derived-not-stored.spec.ts` | No table has a column that duplicates a computable aggregate, except the documented batch cache |
| `document-no-fabrication.spec.ts` | Missing data renders as an explicit gap, never 0 or blank |
| `dashboard-source.spec.ts` | Every dashboard field maps to a named query, not a constant |
| `button-implemented.spec.ts` | Every interactive control either calls a real endpoint or is explicitly marked not implemented |

`no-hardcoded-metrics.spec.ts` and `button-implemented.spec.ts` are unusual tests, and they exist
because the specification asks for them directly: they are what stops the product drifting back into
a clickable mock-up.

---

## 5. Release gates

| Release | Must pass |
|---|---|
| R0 | Migrations, RLS, immutability, balance trigger, stock trigger |
| R1 | Criterion O, `audit-coverage`, `authz-route-coverage`, `authn-brute-force`, `token-reuse` |
| R2 | Criterion A, `offline-capture.e2e`, `sync-conflict` |
| R3 | `projection.spec`, `change-impact.spec`, `priority-score.spec` |
| R4 | Criterion K |
| R5 | `document-provenance`, `document-no-fabrication`, `mou-banner`, `document-immutability` |
| R6 | Criteria C, D, E, F; `three-way-match` |
| R7 | `amendment-chain`, `clinical-timeline`, `offline-clinical.e2e` |
| R8 | Criteria G, H, I; `no-negative-stock`, `journal-balance`, `cash-reconciliation` |
| R9 | Criterion J ✅ — 56 unit tests, `smoke:people` (95 checks), 113 database invariants |
| R10 | Criteria B, M ✅ — 50 unit tests, `smoke:analytics` (69 checks), 125 database invariants |
| R11 | ✅ — 50 unit tests, `smoke:ai` (66 checks), 142 database invariants |
| Final | `acceptance/full-chain.e2e.ts` |
