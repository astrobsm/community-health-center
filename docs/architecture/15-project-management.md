# 15 — Project Management Architecture

Every intervention in this system begins as an observed problem and ends as verified evidence that
the problem was fixed. The project module is what connects those two ends.

---

## 1. Finding to outcome

```
ASSESSMENT FINDING          "Roof over the labour room leaks; ward unusable in rain"
   ↓  need.finding_id
NEED                        "Weatherproof labour ward"
   ↓  recommendation.need_id
RECOMMENDATION              "Replace roof sheets and trusses over block B"  [P1]
   ↓  capex_line.recommendation_id
CAPEX LINE                  Category BUILDING, estimated ₦4.2M              [ESTIMATED]
   ↓  approval
BUDGET LINE                 Approved ₦4.0M                                  [ACTUAL]
   ↓  capital_project.recommendation_id
CAPITAL PROJECT             Phases, tasks, milestones, owner, dates
   ↓  purchase_request.project_id
PROCUREMENT                 Quotations → PO → GRN → supplier invoice
   ↓  payment
PAYMENT                     ₦3.87M actually paid                            [ACTUAL]
   ↓
COMPLETION + AFTER EVIDENCE Photographs, inspection, sign-off               [VERIFIED]
   ↓
POST-INTERVENTION VERIFY    Labour ward in service; deliveries resumed
```

Each arrow is a foreign key. That is what lets a report state "we spent ₦3.87M on the labour-ward
roof because of finding F-0042, and here is the before photograph, the purchase order, the payment,
and the after photograph" — automatically, from data.

---

## 2. Prioritisation (spec §18)

Findings become prioritised interventions using a transparent, configurable score:

```
priority_score = (clinical_importance × w1)
               + (safety_risk        × w2)
               + (urgency            × w3)
               + (patient_impact     × w4)
               + (sustainability     × w5)
               − (cost_burden        × w6)
```

Weights live in `system_configuration`, not in code. The computed score maps to a band, and the band
maps to a class:

| Class | Meaning | Window |
|---|---|---|
| **P1 — Critical** | Must be complete before opening | Before commissioning |
| **P2 — High** | Materially limits service quality or safety | First 100 days |
| **P3 — Development** | Improves capability or efficiency | Within 12 months |
| **P4 — Expansion** | Growth and future service lines | Long term |

The score is advisory. A human may override the class — with a reason, recorded — because a
scoring formula cannot know that the LGA chairman has committed to a specific opening date.

Both the computed score and its inputs are stored, so a later reviewer can see exactly why something
was ranked as it was.

---

## 3. Project structure

```
capital_project
  ├── project_phase          ordered stages with planned/actual dates
  │     └── project_task     owner, estimate, dependencies, % complete, evidence
  ├── project_milestone      dated, verifiable, optionally payment-linked
  ├── project_budget         budgeted / approved / committed / spent
  ├── project_expense        every naira, linked to a payment
  ├── project_evidence       before / during / after
  └── risk                   register scoped to this project
```

**Status is derived, not declared.** A project's completion percentage is computed from weighted task
completion; its financial position from actual postings. A project manager cannot type "80%
complete" — the number comes from the tasks.

**Dependencies** are a DAG (`project_task_dependency` with `FS | SS | FF | SF` and lag). A cycle is
rejected on insert. Critical path is computed on demand; slack is shown per task so a manager can
see which slippage matters.

---

## 4. CAPEX tracking (spec §19)

Six states, each backed by different evidence, never conflated:

| State | Source of truth |
|---|---|
| **Budgeted** | `capex_line.estimated_cost_minor` — classification `ESTIMATED` |
| **Approved** | `budget_line.approved_minor` with an approval record — `ACTUAL` |
| **Committed** | Open purchase orders — `ACTUAL` |
| **Spent** | Payments posted to the ledger — `ACTUAL` |
| **Installed** | Goods receipt plus installation confirmation — `VERIFIED` |
| **Verified** | Commissioning record with evidence and sign-off — `VERIFIED` |

The gap between *spent* and *verified* is the most important number in capital oversight, and the
dashboard shows it prominently: money that has left the account without a commissioned asset behind
it is precisely what a partnership review will ask about.

Categories per spec §19: building, equipment, laboratory, pharmacy, furniture, ICT, power, water,
security, waste, initial stock, working capital, training, contingency.

---

## 5. Before / during / after evidence (spec §14)

`project_evidence` requires a `stage` of `BEFORE | DURING | AFTER`. A project cannot be marked
complete without at least one `AFTER` evidence item when its category requires one (configurable —
a training project evidences differently from a roof).

Where an `AFTER` photograph corresponds to a `BEFORE` photograph, they are linked as a pair and
rendered side by side in reports. This is the single most persuasive artefact the system produces
for a government review, and it is generated from data rather than assembled by hand.

---

## 6. Commissioning

```
commissioning_record {
  asset_id | project_id,
  functional_test_passed, safety_check_passed, staff_trained,
  consumables_available, utilities_connected,
  commissioned_by, witnessed_by, commissioned_at,
  evidence[], notes
}
```

An asset is not operational because it was delivered. It is operational when it has been tested, the
staff can use it, the consumables exist, and the power and water it needs are connected. Until then
`commissioning_status` remains `RECEIVED` or `INSTALLED`, and the asset does not count toward
service readiness. A centrifuge in a box is not laboratory capacity, and the system refuses to
pretend otherwise.

---

## 7. First 100 days (spec §81)

A seeded project template instantiates the standard programme, which the project manager then
adjusts:

| Window | Workstreams |
|---|---|
| **Days 0–30** | Assessment completion, legal verification, design, procurement initiation, urgent repairs |
| **Days 31–60** | Rehabilitation, ICT installation, equipment delivery, pharmacy and laboratory set-up, staff preparation |
| **Days 61–100** | Testing, training, commissioning, soft launch, full launch, first performance review |

Day 0 is the contract execution date, taken from `contract_version`. Every task dates relative to it,
so a delayed signature re-dates the whole programme automatically instead of silently going red.

---

## 8. Project health score (spec §70)

Nine weighted components, each computed from data, each drillable to its source:

assessment completeness · infrastructure readiness · clinical readiness · staffing adequacy ·
financial position · regulatory readiness · community engagement · implementation progress ·
risk exposure.

Output is **GREEN / AMBER / RED** — **always with reasons**:

```
AMBER  (68/100)

  Infrastructure readiness   82%   ✓
  Clinical readiness         71%   ✓
  Staffing adequacy          45%   ▲  3 of 7 required cadres unfilled
  Regulatory readiness       60%   ▲  Premises licence expires in 24 days
  Risk exposure              2 high risks unmitigated

  Drill into any line for the underlying records.
```

A colour without reasons is decoration. The reasons are the product.

---

## 9. Risk register

`risk` carries description, category, likelihood, impact, computed score, mitigation, owner, review
date, and status. Risks attach to a facility, a project, or a partnership. Overdue reviews and
unmitigated high risks surface on the project health score and on the management dashboard — a
register nobody reads is worthless, so the system pushes it into view.

---

## 10. Tests

| Test | Asserts |
|---|---|
| `finding-to-project.spec.ts` | Criterion C: a finding becomes a project with lineage intact |
| `project-budget.spec.ts` | Criterion D: budget states move only through valid transitions |
| `capex-states.spec.ts` | Spent never exceeds approved without an override record |
| `critical-path.spec.ts` | Dependency graph, cycle rejection, slack computation |
| `commissioning.spec.ts` | Criterion F: an asset becomes operational only when all checks pass |
| `project-health.spec.ts` | Score components reproduce from source data |
| `first-100-days.spec.ts` | Template re-dates correctly when Day 0 moves |
