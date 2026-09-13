# 00 — Product Architecture

**System:** Community Health Centre Revitalisation, Partnership, EMR & Facility Management Platform
**Initial implementation:** Community Health Centre, Ikem — Isi-Uzo LGA, Enugu State, Nigeria
**Status:** Release 0 — Architecture
**Document owner:** Principal Software Architect

---

## 1. What this product is

This is a **single longitudinal health-facility information system**, not a collection of modules.

It records, with evidence, the entire transformation of a health facility — from the first field
observation of a derelict building, through investment and rehabilitation, into live clinical
operations — and keeps every number in that story traceable to the transaction that produced it.

The product must be able to answer, at any moment and for any authorised user:

> **WHERE WE STARTED → WHAT WE DID → WHAT WE SPENT → WHAT CHANGED → WHAT OUTCOMES WE ACHIEVED → WHERE WE ARE NOW → WHAT WE SHOULD DO NEXT.**

Every architectural decision in this repository is subordinate to that sentence.

---

## 2. The ultimate data chain

The chain below is the intellectual spine of the product. Each arrow is a real foreign key in the
database, not a narrative device.

```
REAL-WORLD FACILITY
   |  facility
FIELD OBSERVATION
   |  assessment_response
DIGITAL EVIDENCE
   |  evidence -> assessment_evidence
VERIFIED BASELINE
   |  baseline_snapshot (immutable)
IDENTIFIED PROBLEM
   |  assessment_finding
INTERVENTION
   |  need -> recommendation -> capital_project
BUDGET
   |  project_budget -> budget_line
PROCUREMENT
   |  purchase_request -> purchase_order -> goods_receipt
IMPLEMENTATION
   |  project_task / project_expense
COMMISSIONING
   |  equipment_asset.commissioning_status
PATIENT CARE
   |  patient -> encounter
TRANSACTIONAL DATA
   |  charge -> invoice -> payment -> journal_entry
KPI
   |  kpi_result (computed, never typed)
ANALYTICS
   |  analytics read-models
OUTCOME
   |  measured indicator
COMPARISON WITH BASELINE
   |  baseline vs current vs target
MANAGEMENT DECISION
   |  quality_improvement / new finding
NEXT INTERVENTION
```

**Architectural test:** if a developer cannot walk this chain in SQL with joins only — no manual
data entry, no spreadsheet, no hard-coded value — the architecture has failed.

---

## 3. Two modes, one system

The platform operates in two modes that share one database, one authentication system, one
permission model, one audit trail and one design system.

### Mode A — Revitalisation & Partnership Command Centre

Active **before and during** facility transformation.

| # | Module | Primary entities |
|---|---|---|
| 1 | Facility profile | `organisation`, `facility`, `facility_location`, `facility_ownership` |
| 2 | Pre-assessment | `facility_assessment` (type = PRE_ASSESSMENT) |
| 3 | Due diligence | `facility_assessment` (type = DUE_DILIGENCE) |
| 4 | Field assessment | `assessment_section`, `assessment_item`, `assessment_response` |
| 5 | Evidence | `evidence`, `photograph`, `document` |
| 6 | Infrastructure assessment | `room`, `infrastructure_item`, `utility` |
| 7 | Equipment assessment | `equipment_asset`, `asset_maintenance` |
| 8 | Human resources assessment | `staff`, `staff_credential`, `staff_posting` |
| 9 | Clinical assessment | `service`, `service_availability` |
| 10 | Pharmacy assessment | `medication`, `inventory_item` |
| 11 | Laboratory assessment | `lab_test`, `lab_capability` |
| 12 | Financial due diligence | `financial_account`, `baseline_metric` |
| 13 | Community assessment | `community`, `community_profile`, `community_survey` |
| 14 | Regulatory assessment | `compliance_requirement`, `compliance_status` |
| 15 | Risk assessment | `risk` |
| 16 | Baseline | `baseline_snapshot`, `baseline_metric` (immutable) |
| 17 | Needs assessment | `need`, `recommendation` |
| 18 | CAPEX | `capex_plan`, `capex_line` |
| 19 | Working capital | `working_capital_plan` |
| 20 | Financial model | `financial_model`, `model_assumption`, `model_projection` |
| 21 | Partnership model | `partnership`, `revenue_share_model`, `waterfall_step` |
| 22 | Business case | `document` (type = BUSINESS_CASE) |
| 23 | Proposal | `proposal`, `proposal_section` |
| 24 | Letters | `letter`, `letter_template` |
| 25 | MOU | `mou`, `contract`, `contract_version` |
| 26 | Project management | `capital_project`, `project_phase`, `project_task`, `project_milestone` |
| 27 | Procurement | `purchase_request` … `payment` |
| 28 | Rehabilitation | `capital_project` (category = BUILDING) |
| 29 | Commissioning | `commissioning_record` |

### Mode B — Live Facility Operating System

Activated **after commissioning**.

| # | Module | Primary entities |
|---|---|---|
| 1 | Patient registration | `patient`, `patient_identifier`, `patient_contact`, `patient_consent` |
| 2 | EMR | `encounter`, `clinical_note`, `diagnosis` |
| 3 | Triage | `triage` |
| 4 | Clinical consultation | `clinical_note`, `diagnosis`, `procedure` |
| 5 | Nursing | `nursing_note`, `care_plan` |
| 6 | Maternity | `maternity_record`, `anc_visit`, `delivery_record` |
| 7 | Child health | `immunisation`, `growth_measurement` |
| 8 | Chronic disease | `chronic_condition`, `chronic_followup` |
| 9 | Procedures | `procedure` |
| 10 | Referrals | `referral` |
| 11 | Laboratory | `lab_order` … `lab_result` |
| 12 | Pharmacy | `prescription`, `dispensing` |
| 13 | Inventory | `inventory_item`, `inventory_batch`, `stock_transaction` |
| 14 | Procurement | shared with Mode A |
| 15 | Billing | `charge`, `invoice`, `invoice_item` |
| 16 | Payments | `payment`, `refund` |
| 17 | Finance | `journal_entry`, `journal_line`, `financial_account` |
| 18 | HR | `staff`, `staff_posting`, `staff_schedule` |
| 19 | Attendance | `attendance`, `leave` |
| 20 | Performance | `performance_metric`, `performance_review`, `staff_incentive` |
| 21 | Quality | `incident`, `complaint`, `quality_improvement` |
| 22 | KPIs | `kpi`, `kpi_result` |
| 23 | Management dashboard | analytics read-models |
| 24 | Reporting | `report_run`, `document` |
| 25 | Analytics | materialised views + `ai_insight` |

**Mode is a property of the facility, not of the codebase.** `facility.lifecycle_stage` drives
navigation and module visibility. A facility in `LIVE_OPERATIONS` still exposes its full Mode A
history — read-only, because the baseline is immutable.

---

## 4. Facility lifecycle state machine

`facility.lifecycle_stage` is an enumerated, audited, forward-only state machine. Transitions are
gated by preconditions enforced in the domain layer, not by UI.

```
PRE_ASSESSMENT
  -> DUE_DILIGENCE            requires: >=1 submitted pre-assessment
  -> FIELD_ASSESSMENT         requires: due-diligence sign-off
  -> BASELINE_ESTABLISHED     requires: assessment completeness >= threshold, baseline sealed
  -> PLANNING                 requires: baseline_snapshot exists
  -> PROPOSAL                 requires: capex_plan + financial_model (approved versions)
  -> GOVERNMENT_REVIEW        requires: proposal approved internally
  -> AGREEMENT                requires: contract with status EXECUTED
  -> IMPLEMENTATION           requires: >=1 capital_project not in DRAFT
  -> COMMISSIONING            requires: P1 projects complete
  -> LIVE_OPERATIONS          requires: commissioning_record signed
  -> CONTINUOUS_IMPROVEMENT   (steady state)
```

Backward movement is not deletion — it is a new `facility_stage_transition` row with a reason.
History is never rewritten.

---

## 5. The source-of-truth rule (non-negotiable)

No derived value is ever stored as a typed number where it can be computed from transactions.

| Reported value | Derived from | Never from |
|---|---|---|
| Patients/day | `encounter` | a typed dashboard field |
| Revenue | posted `journal_line` | a summary table maintained by hand |
| Pharmacy activity | `dispensing` | a pharmacist's tally |
| Stock on hand | `stock_transaction` ledger | an editable `quantity` column |
| Attendance rate | `attendance` events | a manually entered percentage |
| Laboratory activity | `lab_order` / `lab_result` | a register count |
| Project expenditure | approved `project_expense` + `payment` | a project manager's estimate |
| Capital recovered | `capital_recovery_event` | a partnership spreadsheet |

Where performance requires pre-aggregation we use **materialised views refreshed on a schedule**,
never hand-maintained counters. A materialised view is a cache of the truth; a typed number is a
second, competing truth. We permit the first and forbid the second.

`inventory_batch.quantity_on_hand` is the single deliberate exception: a **derived cache**
maintained exclusively by a database trigger on `stock_transaction`, reconciled nightly against the
ledger. See `14-inventory-architecture.md`.

---

## 6. Data classification (the non-fabrication rule)

Every quantitative value surfaced anywhere in the system — API, UI, report, PDF, AI output —
carries a **classification**. This is a first-class column, not a comment.

| Class | Meaning | Promotion |
|---|---|---|
| `ACTUAL` | Produced by a system transaction | terminal |
| `VERIFIED` | Observed and confirmed by a named verifier with evidence | terminal |
| `REPORTED` | Stated by a third party, unverified | may become `VERIFIED` |
| `ESTIMATED` | Derived by documented calculation from incomplete data | may become `VERIFIED` |
| `ASSUMPTION` | An input chosen by a modeller | never promoted |
| `PROJECTED` | Output of a financial or statistical model | never promoted |
| `AI_GENERATED` | Produced by the AI layer | never promoted |

**Rules enforced in code:**

1. A classification moves only along the documented promotion path, and only with an audit row
   naming the verifier and the evidence.
2. Aggregates take the **weakest** classification of their inputs. Summing `ACTUAL` and `ESTIMATED`
   yields `ESTIMATED`.
3. A document that mixes classifications must label each figure. The document generator refuses to
   render an unlabelled figure.
4. `AI_GENERATED` values may never be an input to a financial posting, a clinical record, or an
   approval.

---

## 7. Baseline / Current / Target

Every headline metric resolves to a six-tuple, computed on demand:

```
BASELINE   immutable value at baseline_snapshot (Day 0)
CURRENT    computed from live transactions for the selected period
TARGET     from kpi.target or a partnership obligation
VARIANCE   CURRENT - TARGET
CHANGE     CURRENT - BASELINE
TREND      direction over the last N periods, with sample size
```

`BASELINE` is read from `baseline_metric` — sealed rows in an append-only table.
`CURRENT` is never read from `baseline_metric`; it is always recomputed.

---

## 8. Multi-tenancy hierarchy

```
Organisation -> State -> LGA -> Facility -> Department -> Service
```

`organisation_id` is mandatory on every tenant-scoped table. `facility_id` is mandatory on every
facility-scoped table. Both are enforced at three layers: application guard, Prisma client
extension, and PostgreSQL row-level security. See `18-security.md`.

---

## 9. Architectural success criteria

Accepted only when each is demonstrable by an automated test.

| | Criterion | Verified by |
|---|---|---|
| A | Assessment data can become baseline data | `baseline.seal.spec.ts` |
| B | Baseline data can be compared with current data | `metrics.comparison.spec.ts` |
| C | Findings can become projects | `finding-to-project.spec.ts` |
| D | Projects can consume budgets | `project-budget.spec.ts` |
| E | Procurement can create assets | `grn-to-asset.spec.ts` |
| F | Assets can become operational resources | `commissioning.spec.ts` |
| G | Clinical encounters can create revenue | `encounter-to-ledger.spec.ts` |
| H | Pharmacy dispensing updates inventory and finance | `dispense-to-stock-ledger.spec.ts` |
| I | Laboratory activity updates clinical and financial records | `lab-order-to-result.spec.ts` |
| J | Attendance feeds performance | `attendance-to-incentive.spec.ts` |
| K | Financial data feeds partnership calculations | `waterfall.spec.ts` |
| L | All major outputs can be audited | `audit-coverage.spec.ts` |
| M | All major metrics trace to source | `lineage.spec.ts` |
| N | The system operates offline | `offline-sync.e2e.ts` |
| O | The system scales to additional facilities | `tenancy-isolation.spec.ts` |

Full definitions in `23-acceptance-tests.md`.

---

## 10. Explicit assumptions

Not specified in the brief; decided here; each revisable without re-architecting.

| # | Assumption | Rationale |
|---|---|---|
| A1 | Currency NGN, stored in **minor units (kobo) as `BIGINT`** | No floating point in money, ever |
| A2 | Timestamps stored UTC `timestamptz`; displayed Africa/Lagos | Single canonical clock |
| A3 | Financial model horizon 5 years x 12 monthly periods = 60 | Per spec §34 |
| A4 | Accounting is **double-entry**, accrual, with a derived cash view | Required for audit and partnership |
| A5 | Clinical coding uses ICD-10 plus a local synonym layer | Widely available, no licence cost |
| A6 | Deployment to a single container platform, Nigeria or EU region | Cost and data residency |
| A7 | Offline scope = field assessment, triage, consultation, dispensing, attendance | Highest field value, bounded conflict surface |
| A8 | Patient identifiers facility-scoped with a global UUID | Supports future cross-facility linkage |
| A9 | SMS/email are pluggable providers, disabled until credentials supplied | No vendor lock-in at Release 1 |
| A10 | No real Ikem operational data is seeded; structural reference data only | Non-fabrication rule §82 |

---

## 11. What this architecture explicitly refuses

- Dashboards backed by literals, fixtures, or fabricated demo numbers in production builds.
- Buttons without a server-side implementation.
- Silent overwrite of clinical or financial records.
- Deletion of posted financial transactions.
- Hard-coded partnership percentages, tariffs, or legal conclusions.
- AI output presented as fact.
