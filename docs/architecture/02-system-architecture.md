# 02 — System Architecture

---

## 1. Component view

```
                        ┌──────────────────────────────────────────────┐
                        │              CLIENT TIER                     │
                        ├──────────────────────────────────────────────┤
  Field assessor  ───►  │  PWA (React 19 + Vite)                       │
  Nurse / Clinician ─►  │   ├─ Service Worker (Workbox)                │
  Pharmacist ───────►   │   │    • app shell precache                  │
  Cashier ──────────►   │   │    • runtime cache, stale-while-revalid. │
  Facility Manager ─►   │   ├─ Dexie / IndexedDB (AES-GCM encrypted)   │
  Gov't Observer ───►   │   │    • outbox queue  • form definitions    │
                        │   │    • cached reference data • evidence    │
                        │   └─ TanStack Query (server state, retries)  │
                        └───────────────────┬──────────────────────────┘
                                            │ HTTPS / TLS 1.3
                                            │ JWT access (10 min, EdDSA)
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │            EDGE / REVERSE PROXY              │
                        │  Caddy or nginx: TLS, HSTS, gzip/brotli,     │
                        │  request-size limits, IP rate limiting       │
                        └───────────────────┬──────────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION TIER  (NestJS on Fastify)                   │
│                                                                                    │
│  GLOBAL PIPELINE — applied to every request, fails closed                          │
│   RequestContext → RateLimit → AuthGuard → TenancyGuard → PermissionsGuard         │
│        → ZodValidationPipe → [handler] → ClassificationInterceptor                 │
│        → AuditInterceptor → ProblemDetailsFilter                                   │
│                                                                                    │
│  ┌── PLATFORM MODULES ────────────────────────────────────────────────────────┐    │
│  │ auth · identity · tenancy · rbac · audit · config · notification · search  │    │
│  │ storage · sync · document · reporting · lineage · dataquality             │    │
│  └───────────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
│  ┌── MODE A: REVITALISATION ────────┐  ┌── MODE B: OPERATIONS ─────────────────┐   │
│  │ facility   assessment  evidence  │  │ patient    encounter   clinical       │   │
│  │ baseline   needs       capex     │  │ triage     laboratory  pharmacy       │   │
│  │ risk       financial-model       │  │ inventory  billing     finance        │   │
│  │ partnership  proposal   contract │  │ hr         attendance  performance    │   │
│  │ project    procurement  asset    │  │ quality    kpi         analytics      │   │
│  └──────────────────────────────────┘  └───────────────────────────────────────┘   │
│                                                                                    │
│  ┌── AI MODULE (read-only DB role, analytics read-models only) ───────────────┐    │
│  └───────────────────────────────────────────────────────────────────────────┘    │
└────────┬───────────────────────┬────────────────────┬───────────────────┬──────────┘
         │                       │                    │                   │
         ▼                       ▼                    ▼                   ▼
  ┌─────────────┐        ┌──────────────┐     ┌──────────────┐   ┌────────────────┐
  │ PostgreSQL  │        │    Redis     │     │  S3 / MinIO  │   │  Anthropic API │
  │     16      │        │  + BullMQ    │     │              │   │  (Claude)      │
  │             │        │              │     │  evidence    │   │                │
  │ • OLTP      │        │ • job queues │     │  documents   │   │  read-only     │
  │ • RLS       │        │ • cache      │     │  backups     │   │  grounded      │
  │ • mat.views │        │ • rate limit │     │              │   │  prompts       │
  │ • audit     │        │ • revocation │     │  pre-signed  │   │                │
  └──────┬──────┘        └──────────────┘     └──────────────┘   └────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │ WORKER TIER (same image, worker entrypoint)              │
  │  sync-processor · document-render (Playwright Chromium)  │
  │  matview-refresh · notification-dispatch                 │
  │  inventory-reconcile · backup-verify · forecast          │
  └──────────────────────────────────────────────────────────┘
```

---

## 2. Layering inside a module

Every domain module follows the same four-layer shape. No exceptions, so that a developer who has
read one module can read all fifty.

```
apps/api/src/modules/<module>/
  <module>.module.ts          wiring; declares dependencies explicitly
  <module>.controller.ts      HTTP only: DTO in, DTO out, permission decorators
  <module>.service.ts         use cases; transaction boundaries; emits domain events
  <module>.repository.ts      Prisma access; the ONLY place Prisma is imported
  domain/                     pure functions and invariants; no I/O, fully unit-testable
  dto/                        Zod schemas re-exported from packages/contracts
  events/                     domain events published to the in-process bus
  sql/                        analytical SQL for this module, if any
  __tests__/                  unit + integration tests
```

**Rules:**

1. A controller never touches Prisma or Redis.
2. A service never builds SQL by string concatenation; parameterised SQL lives in `sql/`.
3. `domain/` has zero imports from `@prisma/client`, `@nestjs/*`, or anything doing I/O —
   the waterfall calculator, FEFO selector, readiness scorer, and incentive engine are all pure
   functions, tested without a database.
4. Cross-module communication is via an injected service (synchronous, same transaction) or a
   domain event (asynchronous, eventually consistent). Never by reaching into another module's
   repository.

---

## 3. Transaction boundaries

The service layer owns transactions. Several operations in this system are only correct if they are
atomic; these are enumerated and tested.

| Operation | Must be atomic across |
|---|---|
| Dispense medication | `dispensing` + `stock_transaction` + batch cache + `charge` + `journal_entry` |
| Record payment | `payment` + `invoice` allocation + `journal_entry` + `journal_line` |
| Receive goods | `goods_receipt` + `inventory_batch` + `stock_transaction` + `equipment_asset` (if capital) |
| Seal baseline | `baseline_snapshot` + all `baseline_metric` rows + facility stage transition |
| Verify lab result | `lab_result` + `encounter` timeline entry + critical-result notification |
| Post journal entry | all `journal_line` rows; debits must equal credits or the transaction aborts |
| Approve capex line | `capex_line` + `budget_line` reservation + audit |

`ReadCommitted` is the default; `Serializable` is used for stock deduction and journal posting,
with a bounded retry on serialisation failure.

---

## 4. Domain events

An in-process event bus (NestJS `EventEmitter`, transactionally outboxed for anything with external
effect) decouples reactions from the primary use case.

```
EncounterClosed        → BillingModule.createChargesFromEncounter
                       → KpiModule.markPeriodDirty
DispensingCompleted    → InventoryModule.assertBatchIntegrity
                       → NotificationModule.checkReorderLevel
LabResultVerified      → ClinicalModule.appendToTimeline
                       → NotificationModule.notifyIfCritical
PaymentPosted          → FinanceModule.postToLedger
                       → PartnershipModule.markWaterfallDirty
GoodsReceived          → AssetModule.createAssetsForCapitalItems
                       → ProcurementModule.reconcilePoGrnInvoice
BaselineSealed         → FacilityModule.transitionStage
                       → NeedsModule.deriveNeedsFromFindings
AttendanceRecorded     → PerformanceModule.markMetricDirty
StockTransactionPosted → NotificationModule.evaluateStockAlerts
```

Events with external side effects (SMS, email, webhook) are written to a **transactional outbox**
table in the same transaction as the business data, then dispatched by a worker. This guarantees we
never send a critical-result SMS for a result that was rolled back.

---

## 5. Request lifecycle — a worked example

**A pharmacist dispenses a prescription while online.**

```
1. PWA        POST /api/v1/pharmacy/dispensings  { prescriptionItemId, quantity, batchId? }
                 Idempotency-Key: <uuid from client>
2. Proxy      TLS terminate, rate-limit by IP
3. RateLimit  per-user token bucket in Redis
4. AuthGuard  verify EdDSA JWT; load user, session, device
5. Tenancy    pin organisation_id + facility_id into AsyncLocalStorage;
              SET LOCAL app.current_org / app.current_facility for RLS
6. Permission handler declares @RequirePermission('pharmacy.dispense') → check effective set
7. Validate   ZodValidationPipe against shared contract schema
8. Idempotency  Redis SETNX on key; replay returns the original response
9. Service    BEGIN (Serializable)
                a. load prescription item, assert status and facility scope
                b. FEFO batch selection (pure domain fn) unless batch explicitly supplied
                c. assert quantity <= batch.quantity_on_hand
                d. insert dispensing
                e. insert stock_transaction (type ISSUE, negative)   ← trigger updates batch cache
                f. insert charge (classification ACTUAL)
                g. insert journal_entry + journal_lines (Dr Receivable / Cr Revenue; Dr COGS / Cr Inventory)
                h. assert sum(debits) == sum(credits) or abort
              COMMIT
10. Events    DispensingCompleted → reorder check, KPI dirty flag
11. Audit     AuditInterceptor writes who/what/when/old/new/reason/device/ip
12. Response  201 + DispensingDto (each figure carries its classification)
```

**The same action offline** is written to the Dexie outbox with a client-generated UUID and the
device's FEFO choice recorded as a *preference*; the server re-runs FEFO authoritatively at sync
time and returns a conflict if the chosen batch is exhausted. See `10-synchronisation.md`.

---

## 6. Read path and analytics

Transactional reads go through Prisma with the tenancy extension applied.

Analytical reads never touch Prisma's query builder. They execute named, parameterised SQL from
`src/analytics/sql/`, against either:

- **live tables** — for small, current-period queries (today's queue, pending lab orders), or
- **materialised views** — for aggregate dashboards (`mv_daily_clinical`, `mv_daily_financial`,
  `mv_stock_position`, `mv_attendance_daily`, `mv_kpi_period`).

Materialised views are refreshed `CONCURRENTLY` by a scheduled worker, and every dashboard response
carries `computedAt` plus the freshness window — so a user always knows whether they are looking at
a figure from 30 seconds ago or 30 minutes ago. **No dashboard ever presents a number without its
timestamp and classification.**

Drill-down (spec §71) works because every aggregate view retains the key set needed to reach the
underlying rows: a revenue figure resolves to `journal_line` ids, which resolve to `payment`,
`invoice`, `charge`, `encounter`, and finally `patient` — subject to the caller's permissions at
each hop.

---

## 7. Environments

| Environment | Purpose | Data |
|---|---|---|
| `local` | Developer workstation, Docker Compose | Synthetic fixtures only |
| `test` | CI; ephemeral Testcontainers Postgres | Generated per test |
| `staging` | UAT with facility staff | Synthetic, structurally realistic, clearly marked |
| `production` | Live facility | Real data; no fixtures, no seed patients |

The seeder refuses to run patient/clinical/financial fixtures when `NODE_ENV=production`. Only
structural reference data (roles, permissions, assessment templates, chart of accounts, KPI
definitions, compliance requirements) is seeded in production, and each seeded row is marked
`is_system_managed = true`.

---

## 8. Scaling path

Release 1 runs on one modest host. The path beyond it is deliberate and requires no rewrite:

1. **Vertical** — the API is stateless; sessions and rate limits live in Redis.
2. **Horizontal API** — run N replicas behind the proxy; workers scale independently.
3. **Read replica** — point analytics SQL at a replica by changing one connection string.
4. **Partitioning** — `audit_log`, `stock_transaction`, `journal_line`, and `encounter` are
   designed for declarative range partitioning by month; the DDL is prepared but not enabled.
5. **Warehouse** — if cross-facility analytics outgrow Postgres, CDC into a columnar store. The
   read-model boundary already exists, so nothing in the domain changes.
