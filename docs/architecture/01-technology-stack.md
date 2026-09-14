# 01 — Technology Stack

Every choice below is justified against the actual operating conditions: a rural Nigerian health
centre, intermittent 3G, mid-range Android devices, mixed staff digital literacy, real money, real
patients, and a ten-year record-retention expectation.

The bias throughout is toward **boring, mature, typed, self-hostable** technology.

---

## 1. Summary

| Layer | Choice | Version |
|---|---|---|
| Language (all tiers) | TypeScript | 5.7+ |
| Runtime | Node.js LTS | 22.x |
| Backend framework | NestJS on Fastify | 12.x |
| ORM / migrations | Prisma | 6.x |
| Database | PostgreSQL | 16.x |
| Cache / queue | Redis + BullMQ | 7.x |
| Object storage | S3-compatible (MinIO self-host) | — |
| Frontend | React + Vite, installable PWA | 19.x / 6.x |
| Offline store | IndexedDB via Dexie, AES-GCM field encryption | 4.x |
| Server state | TanStack Query | 5.x |
| Styling | Native HTML elements + hand-authored CSS tokens (ADR 0006) | — |
| Validation (shared) | Zod | 3.x |
| PDF generation | Playwright Chromium (HTML to PDF) | — |
| DOCX generation | docxtemplater | — |
| Testing | Vitest, Supertest, Testcontainers, Playwright | — |
| Observability | Pino, OpenTelemetry, Sentry-compatible sink | — |
| Container | Docker + Compose (dev), OCI images (prod) | — |

---

## 2. One language across the stack — TypeScript

**Decision.** TypeScript on the server, in the browser, in the shared contracts package, and in
migration/tooling scripts.

**Why.** The dominant defect risk in a system of this breadth is not algorithmic difficulty, it is
**shape drift** — the API returning a field the UI does not expect, or an offline record written in
a form the server rejects after a two-week sync delay. A single type system with one schema source
(`packages/contracts`, Zod) eliminates that class of bug at compile time, and keeps validation
identical on the device and on the server.

**Rejected.** Python/Django (weaker static guarantees for a 150-table domain, and a second language
in the browser anyway). Java/Spring (excellent typing, but heavier operationally and a smaller
Nigerian hiring pool for this profile). Go (fine for services, poor fit for a large relational
domain model with this much CRUD surface).

---

## 3. Backend — NestJS on Fastify

**Decision.** NestJS 12 with the Fastify HTTP adapter (Fastify 5).

**Why.**

1. **The module system matches the domain.** The brief specifies ~54 functional modules. NestJS
   modules give each a hard boundary, explicit imports, and an injectable service layer — so
   "pharmacy depends on inventory and finance" is a compile-time fact, not a convention.
2. **Cross-cutting concerns are first-class.** Multi-tenancy, RBAC, audit, and data classification
   must apply to *every* endpoint without a developer remembering to add them. NestJS guards,
   interceptors and pipes let us enforce these globally, and fail closed:
   - `TenancyGuard` — resolves and pins organisation/facility scope
   - `PermissionsGuard` — denies unless the handler declares a permission
   - `AuditInterceptor` — writes who/what/when/old/new/reason/device
   - `ClassificationInterceptor` — refuses to serialise an unlabelled quantitative value
3. **Fastify over Express.** Roughly 2x throughput, lower memory, and native JSON-schema
   serialisation — which matters on a small VPS serving a facility on a metered link.
4. **Testability.** Dependency injection makes the nine mandated workflow test suites (spec §77)
   straightforward to write against real services with a containerised database.

**Rejected.** Bare Fastify (we would rebuild Nest's module/DI/guard machinery by month three).
tRPC (excellent DX, but we need a documented, versioned, OpenAPI-described REST surface that a
government integration or a future mobile client can consume).

---

## 4. Database — PostgreSQL 16

**Decision.** PostgreSQL as the single transactional source of truth.

**Why.**

- **Real transactions.** Dispensing a drug must atomically write a dispensing record, a stock
  ledger entry, a charge, and journal lines. Anything less than ACID corrupts the inventory and the
  accounts simultaneously.
- **Row-level security.** Postgres RLS gives tenancy isolation *below* the application, so an ORM
  mistake cannot leak another facility's patients. This is defence in depth we cannot get from
  MySQL's weaker policy support or from a document store.
- **Analytical capability in the same engine.** Window functions, `GENERATED` columns, CTEs,
  materialised views, and `tablefunc` cover the entire KPI/benchmarking/drill-down requirement
  without a separate warehouse until scale demands one.
- **Extensions we rely on:** `pgcrypto` (UUIDv4/digests), `pg_trgm` (global fuzzy search over
  patients, assets, medicines), `btree_gist` (exclusion constraints for scheduling/postings),
  `uuid-ossp` optional.
- **Append-only enforcement.** Rules and triggers can make `journal_entry`, `baseline_metric`, and
  `audit_log` genuinely immutable at the storage layer, not merely by convention.

**Rejected.** MongoDB (money and clinical records need constraints and joins, not flexibility).
SQLite server-side (fine on the device, not for concurrent facility operations). MySQL (weaker
RLS, weaker analytical SQL).

---

## 5. ORM — Prisma 6, with hand-written SQL where it matters

**Decision.** Prisma for the model layer and migration engine. **Raw SQL migrations** for views,
triggers, RLS policies, and immutability rules. Raw SQL (`$queryRaw` with typed results) for all
analytical/reporting queries.

**Why.**

- Prisma's migration engine handles a 150-table schema with confidence, produces reviewable SQL,
  and supports the multi-file schema layout we need to keep the domain readable.
- The generated client is genuinely type-safe, which is the whole point of §2.
- A Prisma **client extension** is the natural place to inject the tenancy filter on every query —
  one implementation, applied everywhere.

**Honest trade-off.** Prisma's query builder is weak at the analytical SQL this product needs
(window functions, lateral joins, recursive drill-down). We do not fight it: **reporting is written
in SQL**, lives in `src/analytics/sql/`, is unit-tested against a containerised Postgres, and
returns Zod-validated shapes. Prisma owns writes and simple reads; SQL owns analytics. See
`docs/adr/0002-prisma-with-raw-sql-analytics.md`.

**Rejected.** TypeORM (migration reliability problems at this scale). Drizzle (attractive
SQL-first model; rejected only because Prisma's migration tooling and ecosystem maturity matter
more for a decade-lived clinical system than syntax elegance — recorded as a close call in ADR
0002). Knex alone (no type safety).

---

## 6. Frontend — React 19 + Vite, as an installable PWA

**Decision.** A responsive, installable Progressive Web App. No native application at Release 1.

**Why PWA rather than native.**

- One codebase serves the assessor's phone in a village, the nurse's tablet, and the facility
  manager's laptop.
- Updates deploy without an app store — critical when a tariff or assessment form changes.
- Service workers plus IndexedDB satisfy the offline requirement (spec §55) for the scoped
  workflows.
- Install-to-home-screen gives the field experience the app affordance staff expect.

**Where native would win, and why we still decline:** background sync while the app is closed,
biometric hardware, and reliable large-file camera capture. The brief makes biometrics *optional*
(§24) and the rest is manageable. If field evidence shows this is wrong, the contracts package and
API are client-agnostic — a React Native client can be added without touching the server.

**Supporting choices.**

- **TanStack Query** for server state: caching, retry with backoff, offline mutation queues, and
  stale-while-revalidate behaviour that suits a 3G link.
- **React Router 7** (data router) for route-level code splitting — the nurse never downloads the
  finance bundle.
- **Native HTML elements with hand-authored CSS** (`design-system/tokens.css`, `base.css`).
  This reverses the original Tailwind + Radix choice — see ADR 0006 for the full reasoning. In
  short: the entire component set here is inputs, selects, radios, checkboxes, buttons and a modal,
  all of which the platform already implements with correct keyboard and screen-reader behaviour.
  Radix would render `<div role="radio">` and re-implement arrow-key navigation in JavaScript,
  which is how apps get *less* accessible, not more. The whole stylesheet is 2.3 kB gzipped.
- **React Hook Form + Zod** — the same Zod schema validates on the device offline and on the
  server, so a form filled in a village cannot fail validation on sync two weeks later.
- **Recharts** for charts: small, declarative, SVG-based, and every series binds to a real query.

---

## 7. Offline storage — Dexie over IndexedDB, with field-level encryption

**Decision.** Dexie 4 wrapping IndexedDB, with sensitive fields encrypted using AES-GCM via the
Web Crypto API. The data-encryption key is wrapped by a key derived from the user's credentials
(PBKDF2, high iteration count) and held only in memory for the session.

**Why.** IndexedDB is the only browser store with the capacity (hundreds of MB, needed for
photographic evidence) and transactional semantics required. It is *not* encrypted at rest by the
browser, and a field device carrying patient data can be stolen — so we encrypt patient
identifiers, clinical content, and evidence blobs before they are written. Non-sensitive
operational metadata (sync status, form definitions) stays plaintext for queryability.

**Rejected.** `localStorage` (5 MB, synchronous, no transactions). SQLite via WASM + OPFS
(genuinely attractive, and the likely future direction; rejected for Release 1 because Dexie's
maturity and simpler debugging reduce delivery risk — revisit at Release 7).

---

## 8. Queue and cache — Redis 7 + BullMQ

Used for: sync fan-out, document generation (PDF rendering is slow and must not block a request),
scheduled KPI/materialised-view refresh, notification dispatch, nightly inventory reconciliation,
backup verification, and forecast recomputation.

Redis is also the rate-limit store and the session/refresh-token revocation list.

**Explicitly not** used as a source of truth. Anything Redis loses must be reconstructible from
PostgreSQL.

---

## 9. Object storage — S3-compatible

Photographs, scanned documents, generated PDFs and DOCX files, and database backups.

MinIO for self-hosted deployment; any S3-compatible service in cloud. Access is exclusively via
short-lived pre-signed URLs issued after a permission check — the bucket is never public. Server-side
encryption enabled; object keys carry no patient identifiers.

**Why not store binaries in PostgreSQL.** A facility assessment can produce hundreds of photographs;
`bytea` columns would make backup, restore and replication of the clinical database impractical.

---

## 10. Document generation — Playwright Chromium and docxtemplater

Two paths, deliberately:

- **PDF** (reports, briefs, commissioning records): render a versioned HTML template with real
  query results, print to PDF via headless Chromium. Same CSS as the app, so a report looks like the
  product. Runs in a worker, never in the request path.
- **DOCX** (MOU, management agreement, letters): generated with `docxtemplater` because legal
  counsel and government officials must *edit and track changes* in Word. A PDF MOU is unusable in a
  real negotiation.

Every generated artefact is stamped with source dataset, reporting period, model version, document
version, author, approval status, and — for agreements — the mandatory
**DRAFT — SUBJECT TO LEGAL, GOVERNMENT AND PROFESSIONAL REVIEW** banner.

---

## 11. AI layer — isolated by construction

The AI service is a separate NestJS module with **read-only database credentials restricted to
analytics read-models**. It cannot write to a transactional table; the grant does not exist.

Provider: Claude via the Anthropic API, behind a thin `LlmProvider` interface so the model is a
configuration value. All AI output is persisted to `ai_insight` with classification
`AI_GENERATED`, the prompt hash, the model identifier, and the exact result-set the answer was
grounded in.

See `17-ai-architecture.md` for the anti-fabrication controls.

---

## 12. Testing

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Domain services, calculators, waterfall, FEFO, scoring |
| Integration | Vitest + Testcontainers (real Postgres) | Repositories, triggers, RLS, immutability |
| API | Supertest | Every endpoint: authz, tenancy, validation, audit |
| E2E | Playwright | The nine workflow suites and the full acceptance chain (§78) |
| Offline | Playwright with network throttling/offline | Queue, sync, conflict resolution |
| Load | k6 | Dashboard queries and sync under 3G latency |

Testcontainers rather than mocks for anything touching the database: the tenancy, immutability and
inventory-trigger guarantees live *in the database*, so a mocked test would verify nothing.

---

## 13. Deployment and operations

- **Dev:** Docker Compose — Postgres, Redis, MinIO, API, Web, Mailpit.
- **Prod:** OCI images; a single container host is sufficient for one facility, with a documented
  path to managed Postgres + horizontal API scaling as facilities are added.
- **Migrations:** `prisma migrate deploy` gated in CI; no implicit schema changes at boot.
- **Secrets:** environment-injected, never committed; `.env.example` documents every variable.
- **Backups:** nightly `pg_dump` (encrypted, to object storage) plus continuous WAL archiving;
  restores are *tested*, and the last successful verified restore is surfaced in the admin UI
  (spec §86).

---

## 14. Rationale index

| Requirement | Satisfied by |
|---|---|
| Poor connectivity (§55, §85) | PWA + service worker + Dexie + TanStack Query offline mutations |
| Mobile-first field use (§61) | Responsive PWA, camera capture, install-to-home-screen |
| Secure financial transactions (§32) | Postgres ACID, double-entry, append-only ledger, approvals |
| Longitudinal clinical records (§28) | Normalised relational schema, append-only amendments |
| Multi-tenancy (§9, §68) | Tenancy guard + Prisma extension + Postgres RLS |
| Auditability (§42) | Global interceptor + immutable `audit_log` |
| Analytics and drill-down (§71) | SQL views + materialised views, every figure traceable |
| AI without fabrication (§53) | Isolated service, read-only grants, labelled outputs |
| Maintainability | One language, module boundaries, typed contracts, real tests |
