# 03 — Database Architecture

PostgreSQL 16 is the source of truth. Everything else in the system is a cache, a projection, or a
presentation of what is in this database.

---

## 1. Universal conventions

Applied to every table without exception, so that tooling, audit, sync and tenancy can be generic.

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | Globally unique; generated client-side when offline |
| `organisation_id` | `uuid` NOT NULL FK | On every tenant-scoped table |
| `facility_id` | `uuid` NULL/NOT NULL FK | NOT NULL on facility-scoped tables |
| `created_at` | `timestamptz` NOT NULL default `now()` | UTC always |
| `updated_at` | `timestamptz` NOT NULL | Maintained by trigger, not by application code |
| `created_by` | `uuid` FK → `app_user` | Null only for system-generated rows |
| `updated_by` | `uuid` FK → `app_user` | |
| `deleted_at` | `timestamptz` NULL | Soft delete; **forbidden** on ledger/immutable tables |
| `version` | `integer` NOT NULL default 1 | Optimistic concurrency + sync conflict detection |
| `device_id` | `text` NULL | Origin device for offline-capable tables |
| `sync_status` | enum NULL | `LOCAL_ONLY \| PENDING \| SYNCED \| CONFLICT` on offline tables |

**Naming:** `snake_case` tables (singular), `snake_case` columns, `fk_`/`ix_`/`uq_`/`ck_` prefixes
for constraints. Prisma models are `PascalCase` and map explicitly via `@@map`.

**Money:** `BIGINT` minor units (kobo) plus a `currency char(3)` column. Never `float`, never
`numeric` for money — integers are exact and comparisons are unambiguous. Percentages and rates use
`numeric(12,6)`.

**Enumerations:** native PostgreSQL enums for closed, code-meaningful sets (e.g. `encounter_status`).
Configurable, business-managed lists (services, tariffs, cadres, KPI definitions, assessment
questions) are **reference tables**, never enums — per spec §89.

---

## 2. Table taxonomy

Every table belongs to exactly one class, which determines its mutability rules.

### Class 1 — Reference / configuration
`service`, `tariff`, `lab_test`, `medication`, `assessment_template`, `kpi`, `chart_of_accounts`,
`compliance_requirement`, `role`, `permission`.

Mutable, versioned where the value feeds historical calculations. **A tariff is never edited in
place** — a new `tariff_version` row is created with an effective date range, because a charge
raised in March must forever price at March's tariff.

### Class 2 — Transactional (mutable within a lifecycle)
`encounter`, `lab_order`, `purchase_order`, `project_task`, `invoice` (pre-issue).

Mutable while open; frozen on completion. Every mutation writes an audit row with old/new values.

### Class 3 — Append-only ledgers
`journal_entry`, `journal_line`, `stock_transaction`, `payment`, `attendance`, `capital_recovery_event`.

**No UPDATE. No DELETE.** Enforced by a database rule:

```sql
CREATE RULE no_update_journal_line AS ON UPDATE TO journal_line DO INSTEAD NOTHING;
CREATE RULE no_delete_journal_line AS ON DELETE TO journal_line DO INSTEAD NOTHING;
```

Corrections are new, linked, contra rows (`reverses_id`), never edits. See §12 of this document.

### Class 4 — Immutable snapshots
`baseline_snapshot`, `baseline_metric`, `contract_version`, `document_version`, `model_projection`
(once its model is approved), `audit_log`.

Sealed on creation. Protected by a `BEFORE UPDATE OR DELETE` trigger that raises an exception.

### Class 5 — Clinical records with amendment semantics
`clinical_note`, `diagnosis`, `triage`, `lab_result`, `nursing_note`.

Never overwritten. An amendment is a new row referencing `amends_id`, with `amendment_reason`,
author and timestamp; the original keeps `status = AMENDED` and remains fully readable. The current
clinical view is the head of each amendment chain. See `13-clinical-architecture.md`.

---

## 3. Schema organisation

One database, logical separation by PostgreSQL schema for clarity and for granular grants:

| Schema | Contents | AI role grant |
|---|---|---|
| `core` | organisation, facility, user, role, permission, config | none |
| `assess` | assessments, evidence, findings, baseline | none |
| `plan` | needs, capex, financial model, partnership, proposal, contract | none |
| `exec` | projects, procurement, assets, commissioning | none |
| `clinical` | patient, encounter, clinical, lab, pharmacy | none |
| `supply` | inventory, batches, stock ledger, suppliers | none |
| `fin` | accounts, charges, invoices, payments, journal | none |
| `people` | staff, attendance, performance, incentives | none |
| `qual` | KPI, incidents, complaints, quality improvement | none |
| `audit` | audit_log, sync_event, outbox | none |
| `analytics` | views and materialised views only | **SELECT** |

The AI database role holds `SELECT` on `analytics` and nothing else. Isolation is a grant, not a
code convention.

---

## 4. Core entity groups

### 4.1 Tenancy and identity

```
organisation ──< facility ──< department ──< service_offering
     │              │
     │              ├──< facility_location   (state, lga, ward, gps)
     │              ├──< facility_ownership  (owner type, custodian, evidence)
     │              └──< facility_stage_transition
     │
     └──< app_user ──< user_role >── role ──< role_permission >── permission
                  └──< user_facility_access   (which facilities, what scope)
                  └──< user_session ──< refresh_token
                  └──< user_mfa_factor
```

`app_user` (not `user` — reserved word) is the authentication principal. `staff` is the HR record.
A user may have no staff record (a government observer); a staff member may have no user account
(a cleaner who is rostered but never logs in). The optional link is `staff.user_id`.

### 4.2 Assessment and baseline

```
assessment_template ──< assessment_section ──< assessment_item
        │                                            │
facility_assessment ──< assessment_response ─────────┘
        │                     │
        │                     ├──< assessment_finding ──< finding_evidence >── evidence
        │                     └──< assessment_evidence  >── evidence ──< photograph
        │                                                            └──< document
        └──< assessment_score  (per domain, configurable weights)

baseline_snapshot ──< baseline_metric      [IMMUTABLE, sealed]
        └── derived from a specific facility_assessment
```

`assessment_template` versioning matters: a response must always be interpretable against the exact
template version it was captured with, so `assessment_response.template_version_id` is stored.

### 4.3 Needs, CAPEX, financial model, partnership

```
assessment_finding ──< need ──< recommendation ──< capex_line >── capex_plan
                                      │                 │
                                      └──────────────► capital_project
financial_model ──< model_assumption        [each with classification = ASSUMPTION]
        └──< model_scenario  (CONSERVATIVE|BASE|GROWTH|STRESS)
                └──< model_projection  (60 monthly periods)  [classification = PROJECTED]

partnership ──< partnership_obligation
        ├──< revenue_share_model ──< waterfall_step   (ordered, configurable)
        ├──< capital_recovery_event                    [append-only]
        └──< contract ──< contract_version             [immutable versions]
```

No percentage is hard-coded anywhere. `waterfall_step` rows define the ordered computation, each
with a basis (`GROSS_REVENUE | OPERATING_SURPLUS | FIXED | RESIDUAL`), a rate or amount, a cap, and
a floor.

### 4.4 Clinical

```
patient ──< patient_identifier      (facility MRN, NIN, NHIS, phone)
      ├──< patient_contact
      ├──< patient_consent          (purpose-scoped, withdrawable, versioned)
      └──< encounter ──< triage
                    ├──< clinical_note   [amendment chain]
                    ├──< diagnosis       [amendment chain, ICD-10 + local synonym]
                    ├──< procedure
                    ├──< prescription ──< prescription_item ──< dispensing
                    ├──< lab_order ──< lab_order_item ──< lab_sample ──< lab_result
                    ├──< referral
                    ├──< charge ──> invoice_item
                    └──< appointment (follow-up)
```

### 4.5 Supply chain

```
inventory_category ──< inventory_item ──< inventory_batch ──< stock_transaction  [append-only]
                              │                    │
                              │                    └── quantity_on_hand (trigger-maintained cache)
                              ├──< reorder_rule
                              └──< stock_count ──< stock_count_line ──< stock_adjustment

supplier ──< purchase_request ──< purchase_order ──< goods_receipt ──< goods_receipt_line
                                        │                   │
                                        └──< supplier_invoice ──< payment
                                                                    │
                                        goods_receipt_line ────────► equipment_asset (if capital)
```

### 4.6 Finance

```
financial_period ──< journal_entry ──< journal_line        [append-only, balanced]
financial_account (chart of accounts, hierarchical)
        └──< journal_line

charge ──< invoice_item >── invoice ──< payment_allocation >── payment
                                   └──< refund
budget ──< budget_line
bank_account ──< bank_statement_line ──< bank_reconciliation
```

`journal_entry` carries `source_type` + `source_id` — a polymorphic pointer back to the dispensing,
payment, payroll run, or project expense that caused it. This is what makes every naira traceable.

### 4.7 People

```
staff ──< staff_credential   (licence number, issuing body, expiry → notification)
    ├──< staff_posting       (department, role, cadre, employer, period)
    ├──< staff_schedule ──< shift
    ├──< attendance          [append-only clock events]
    ├──< leave
    ├──< performance_metric_result ──> performance_metric (configurable)
    ├──< performance_review
    └──< staff_incentive ──< incentive_component   (transparent, auditable formula)
```

### 4.8 Quality, KPI, audit

```
kpi ──< kpi_result   (computed; stores the SQL identity + inputs used, never hand-typed)
risk
incident ──< corrective_action
complaint ──< complaint_action
quality_improvement  (problem → root cause → intervention → measurement → review)

audit_log        [immutable]
sync_event
outbox_message
notification
```

---

## 5. Indexing strategy

Indexes are added for demonstrated access paths, not speculatively.

**Mandatory on every tenant-scoped table:**
```sql
CREATE INDEX ix_<table>_org_facility ON <table> (organisation_id, facility_id);
```

**Time-series tables** (`encounter`, `stock_transaction`, `journal_line`, `attendance`,
`audit_log`):
```sql
CREATE INDEX ix_<table>_facility_time ON <table> (facility_id, created_at DESC);
```

**Global search** (spec §60) uses trigram indexes:
```sql
CREATE INDEX ix_patient_search_trgm ON clinical.patient
  USING gin ((coalesce(given_name,'') || ' ' || coalesce(family_name,'')) gin_trgm_ops);
```

**Partial indexes** for hot, selective predicates:
```sql
CREATE INDEX ix_lab_order_pending ON clinical.lab_order (facility_id, ordered_at)
  WHERE status IN ('ORDERED','COLLECTED','IN_PROCESS');
CREATE INDEX ix_batch_active ON supply.inventory_batch (inventory_item_id, expiry_date)
  WHERE quantity_on_hand > 0;   -- FEFO selection
```

**Exclusion constraint** to prevent overlapping staff postings:
```sql
ALTER TABLE people.staff_posting ADD CONSTRAINT ck_no_overlapping_posting
  EXCLUDE USING gist (staff_id WITH =, period WITH &&);
```

---

## 6. Row-level security

Enabled on every table containing tenant data.

```sql
ALTER TABLE clinical.patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.patient FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clinical.patient
  USING (
    organisation_id = current_setting('app.current_org', true)::uuid
    AND facility_id = ANY (
      string_to_array(current_setting('app.current_facilities', true), ',')::uuid[]
    )
  );
```

The application sets these per transaction:

```sql
SET LOCAL app.current_org = '...';
SET LOCAL app.current_facilities = '...,...';
SET LOCAL app.current_user = '...';
```

`SET LOCAL` (not `SET`) is essential — the setting dies with the transaction, so a pooled connection
cannot leak one user's scope into another's request.

The migration role bypasses RLS; the application role does not. Verified by
`tenancy-isolation.spec.ts`, which asserts that a raw query as the app role returns zero rows for a
foreign facility.

---

## 7. Triggers and database-enforced invariants

| Trigger | Table | Guarantee |
|---|---|---|
| `trg_set_updated_at` | all | `updated_at` cannot be falsified by the application |
| `trg_bump_version` | offline-capable tables | `version` increments on every write |
| `trg_immutable` | Class-4 tables | `RAISE EXCEPTION` on UPDATE/DELETE |
| `trg_balance_journal_entry` | `journal_entry` (deferred constraint trigger) | sum(debits) = sum(credits) |
| `trg_stock_apply` | `stock_transaction` | maintains `inventory_batch.quantity_on_hand`; rejects negative stock |
| `trg_no_negative_batch` | `inventory_batch` | `CHECK (quantity_on_hand >= 0)` |
| `trg_period_closed` | `journal_entry` | rejects postings into a closed `financial_period` |
| `trg_audit_row` | high-value tables | writes an audit row even if the ORM is bypassed |
| `trg_classification_required` | tables with a numeric business value | `classification` must be non-null |

These live in `infra/sql/` and ship as ordinary Prisma migrations, so they are version-controlled
and applied identically in every environment.

**Why in the database rather than the service layer:** these are the guarantees the whole product
rests on. A future developer writing a quick script, a data fix, or a new service must not be able
to violate them.

---

## 8. Materialised views (analytics schema)

| View | Grain | Refresh |
|---|---|---|
| `mv_daily_clinical` | facility × day | every 15 min |
| `mv_daily_financial` | facility × day × account | every 15 min |
| `mv_stock_position` | facility × item × batch | every 10 min |
| `mv_attendance_daily` | facility × staff × day | hourly |
| `mv_lab_turnaround` | facility × test × day | hourly |
| `mv_kpi_period` | facility × kpi × period | hourly |
| `mv_project_financials` | project × month | hourly |
| `mv_baseline_vs_current` | facility × metric | hourly |

All refreshed `CONCURRENTLY` (each carries a unique index) so dashboards never block. Every view
exposes `computed_at`, and every API response derived from one returns that timestamp.

---

## 9. Partitioning (prepared, not enabled)

`audit_log`, `stock_transaction`, `journal_line`, `encounter`, and `attendance` are the tables that
will grow without bound. Their DDL is written to be convertible to declarative monthly range
partitions without a data migration (no cross-partition unique constraints other than on the
partition key). The switch is documented in `docs/runbooks/partitioning.md` and is not needed for a
single facility.

---

## 10. Migrations

- Prisma Migrate owns schema evolution. Every migration is reviewed SQL committed to the repo.
- Hand-written SQL (views, triggers, RLS, rules) lives in numbered migration folders alongside it.
- **Forward-only in production.** Rollback is by a new corrective migration plus a tested restore
  procedure — never by `migrate reset`.
- CI runs every migration against a fresh database *and* against a restored production-shaped dump,
  so a migration that works on empty schemas but breaks on real data is caught before deployment.
- Destructive changes (drop column, drop table, narrow a type) require an ADR and a two-phase
  deploy: expand, backfill, contract.

---

## 11. Data retention

| Data | Retention | Mechanism |
|---|---|---|
| Clinical records | 10 years minimum after last encounter | never auto-deleted; archival tier |
| Financial records | 7 years | never auto-deleted |
| Audit log | 7 years | partition drop after retention, logged |
| Evidence media | life of the partnership + 7 years | object-storage lifecycle policy |
| Sync events | 90 days | scheduled purge |
| Sessions / refresh tokens | 30 days after expiry | scheduled purge |
| Notifications | 1 year | scheduled purge |

Retention is configuration (`system_configuration`), not code, because the governing rules may
change. Deletion of clinical or financial data always writes an audit record describing what was
removed and under which policy.

---

## 12. Corrections, not edits

Three distinct correction mechanisms, matched to the three kinds of truth:

| Domain | Mechanism | Shape |
|---|---|---|
| Clinical | Amendment chain | original row `status = AMENDED`; new row `amends_id` + reason + author |
| Financial | Reversal / adjustment | contra `journal_entry` with `reverses_id`, reason, approver |
| Inventory | Adjustment transaction | new `stock_transaction` type `ADJUSTMENT`, reason code, approver |

In none of these is the original row modified or removed. This is what makes the audit trail the
institutional memory the brief requires.
