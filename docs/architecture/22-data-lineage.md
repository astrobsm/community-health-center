# 22 — Data Lineage Architecture

Lineage is the feature. Everything else in this platform exists to make these chains real and
walkable.

---

## 1. Chain 1 — Care to money

```
PATIENT               clinical.patient
   ↓ encounter.patient_id
ENCOUNTER             clinical.encounter
   ↓ charge.encounter_id
SERVICE               core.service_offering  (priced by tariff_version in force on the service date)
   ↓
CHARGE                fin.charge
   ↓ invoice_item.charge_id
INVOICE               fin.invoice
   ↓ payment_allocation.invoice_id
PAYMENT               fin.payment
   ↓ journal_entry.source_id = payment.id
JOURNAL ENTRY         fin.journal_entry → fin.journal_line
   ↓
REPORT                analytics.mv_daily_financial
   ↓
KPI                   qual.kpi_result
```

Every hop is a foreign key. Given a KPI value, the API can return the exact `journal_line` rows that
produced it, then the payments, then the invoices, then the encounters, then the patients — each hop
filtered by the caller's permissions, so a government observer walking the chain reaches aggregate
counts and stops before patient identity.

---

## 2. Chain 2 — Observation to outcome

```
ASSESSMENT FINDING    assess.assessment_finding   (with its evidence)
   ↓ need.finding_id
NEED                  plan.need
   ↓ recommendation.need_id
RECOMMENDATION        plan.recommendation
   ↓ capex_line.recommendation_id
CAPITAL PROJECT       exec.capital_project.recommendation_id
   ↓ purchase_request.project_id
PROCUREMENT           exec.purchase_order → exec.goods_receipt
   ↓ journal_entry.source_id
PAYMENT               fin.payment
   ↓ equipment_asset.goods_receipt_line_id
ASSET                 exec.equipment_asset
   ↓ commissioning_record.asset_id
COMMISSIONING         exec.commissioning_record
   ↓
SERVICE DELIVERY      core.service_offering becomes available
   ↓
OUTCOME               clinical.encounter using that service
```

This is the chain that answers a government reviewer's real question: *what did you actually do with
the money, and what changed because of it?*

---

## 3. Chain 3 — Baseline to current

```
BASELINE METRIC       assess.baseline_metric   [IMMUTABLE, sealed at Day 0]
   ↓ kpi_assignment.baseline_metric_id
KPI ASSIGNMENT        qual.kpi_assignment  (baseline, target, owner)
   ↓ computed per period from transactions — never from the baseline table
CURRENT VALUE         qual.kpi_result
   ↓
COMPARISON            analytics.mv_baseline_vs_current
```

The baseline and the current value come from **structurally different sources**: the baseline from a
sealed snapshot, the current from live transactions. They can never be accidentally conflated,
because no code path reads `baseline_metric` when computing a current value.

---

## 4. The lineage service

A first-class API, not a debugging convenience:

```
GET /api/v1/lineage/:entityType/:id/upstream     what produced this value
GET /api/v1/lineage/:entityType/:id/downstream   what this value affects
GET /api/v1/lineage/metric/:metricCode?period=   full derivation of a reported figure
```

Example response for a dashboard revenue figure:

```json
{
  "metric": "revenue_total",
  "value": { "amountMinor": 4820000, "currency": "NGN" },
  "classification": "ACTUAL",
  "period": { "from": "2026-08-01", "to": "2026-08-31" },
  "computedAt": "2026-09-13T06:15:00Z",
  "derivation": {
    "source": "analytics.mv_daily_financial",
    "query": "revenue_by_period.sql@v3",
    "definition": "SUM(journal_line.credit_minor) WHERE account IN (4110..4180) AND entry.status='POSTED'",
    "rowCount": 1284
  },
  "drillDown": [
    { "label": "Consultation", "account": "4110", "amountMinor": 2100000, "href": "/lineage/account/4110?period=..." },
    { "label": "Pharmacy",     "account": "4130", "amountMinor": 1620000, "href": "..." },
    { "label": "Laboratory",   "account": "4120", "amountMinor": 1100000, "href": "..." }
  ],
  "upstream": ["journal_line", "journal_entry", "payment", "invoice", "charge", "encounter"]
}
```

The `definition` field is the SQL identity of the figure. A finance officer who disputes a number can
read exactly how it was computed, and the query is version-controlled like any other code.

---

## 5. Drill-down in the UI (spec §71)

Every figure on every dashboard is a link. The hierarchy is uniform:

```
Aggregate → Dimension breakdown → Transaction list → Individual record → Source document
```

```
₦4,820,000 revenue (August)
  └─ by service line
      └─ Laboratory ₦1,100,000
          └─ 412 transactions
              └─ Payment PMT-2026-08-0731 ₦12,000
                  └─ Invoice INV-2026-08-0412
                      └─ Charge: Malaria RDT
                          └─ Lab order LAB-2026-08-1104
                              └─ Encounter ENC-2026-08-2210
                                  └─ Patient (identity shown only with permission)
```

Permission is re-evaluated at **every hop**. A government observer can traverse to the transaction
count and stop; the patient link is simply absent, not merely disabled.

---

## 6. Classification propagation

Lineage carries classification with it. The aggregate function is `weakest()`:

```
ACTUAL ≺ VERIFIED ≺ REPORTED ≺ ESTIMATED ≺ ASSUMPTION ≺ PROJECTED ≺ AI_GENERATED
```

Aggregating 100 `ACTUAL` values and 1 `ESTIMATED` value yields `ESTIMATED`, and the response names
which inputs weakened it:

```json
{
  "value": 4820000,
  "classification": "ESTIMATED",
  "weakenedBy": [
    { "source": "charge#a41c", "classification": "ESTIMATED",
      "reason": "Tariff missing for service on 2026-08-14; facility default applied" }
  ]
}
```

This is the mechanism that makes §82 more than an instruction: a single estimated input visibly
demotes the whole figure, and the user is told exactly which input did it and why.

---

## 7. Where lineage is enforced

| Mechanism | Effect |
|---|---|
| Foreign keys | A charge cannot exist without an encounter; an asset cannot exist without a receipt line |
| `source_type` / `source_id` | Every journal entry and stock transaction names its cause |
| Named queries | Every reported figure has a versioned SQL identity, not ad-hoc code |
| Classification columns | Provenance travels with the value through every layer |
| `lineage.spec.ts` | Walks the chains automatically and fails if any link is missing |

`lineage.spec.ts` is acceptance criterion M: it generates a full chain of activity, then starts from
each reported metric and walks upstream to the originating record. A broken link fails the build.

---

## 8. What lineage deliberately does not do

- It does not reconstruct *intent*. Why a clinician chose a diagnosis is in the note, not the graph.
- It does not track lineage through exported spreadsheets. Once data leaves the system it is beyond
  our guarantees — which is why generated documents carry a content hash, so at least tampering with
  an exported artefact is detectable.
- It does not make AI outputs traceable to facts beyond the context they were grounded in. The
  `ai_insight` record names the queries and the context hash; it cannot vouch for the reasoning.
