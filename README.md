# Community Health Centre Platform

**Revitalisation · Partnership · EMR · Facility Management**

A single longitudinal health-facility information system. It records, with evidence, the complete
transformation of a health facility — from the first field observation through investment and
rehabilitation into live clinical operations — and keeps every reported number traceable to the
transaction that produced it.

**Initial implementation:** Community Health Centre, Ikem — Isi-Uzo LGA, Enugu State, Nigeria.
The architecture is multi-organisation, multi-state, multi-LGA and multi-facility from the first
migration; Ikem is the first deployment, not a constraint.

---

## The question this system exists to answer

> **WHERE WE STARTED → WHAT WE DID → WHAT WE SPENT → WHAT CHANGED → WHAT OUTCOMES WE ACHIEVED → WHERE WE ARE NOW → WHAT WE SHOULD DO NEXT.**

---

## Two modes, one database

| Mode A — Revitalisation Command Centre | Mode B — Live Facility Operating System |
|---|---|
| Pre-assessment, due diligence, field assessment | Registration, EMR, triage, consultation |
| Evidence, baseline, needs analysis | Nursing, maternity, child health, chronic disease |
| CAPEX, five-year financial model | Laboratory, pharmacy, inventory |
| Partnership model, proposal, MOU | Billing, payments, finance |
| Projects, procurement, commissioning | HR, attendance, performance, quality, KPIs |

Mode is a property of `facility.lifecycle_stage`, not a separate application. A live facility retains
its full revitalisation history, read-only, because the baseline is immutable.

---

## Non-negotiable principles

1. **The database is the source of truth.** No dashboard value is stored where it can be derived.
2. **Every number is classified** — `ACTUAL`, `VERIFIED`, `REPORTED`, `ESTIMATED`, `ASSUMPTION`,
   `PROJECTED`, `AI_GENERATED`. An assumption never becomes a fact.
3. **Nothing is silently overwritten.** Clinical records amend, financial records reverse, inventory
   adjusts. The original always survives.
4. **The baseline is immutable.** Day 0 is sealed and can never be edited.
5. **Every figure is traceable** to the transaction that produced it, and drillable in the UI.
6. **The system works offline** for field assessment and essential clinical work.
7. **AI is an assistant, never a source of truth.** It holds read-only access to analytics
   read-models and cannot write anywhere.
8. **No fabricated data.** No fake charts, no placeholder statistics, no buttons without an
   implementation.

---

## Technology

| Layer | Choice |
|---|---|
| Language | TypeScript 5.7 (server, client, contracts) |
| Backend | NestJS 12 on Fastify, Node 22 |
| Database | PostgreSQL 16 — RLS, append-only ledgers, immutability triggers |
| ORM | Prisma 6 for writes; hand-written SQL for analytics |
| Cache / queue | Redis 7 + BullMQ |
| Frontend | React 19 + Vite, installable PWA |
| Styling | Native HTML elements + CSS tokens (ADR 0006) — 2.3 kB gzipped |
| Offline | Dexie / IndexedDB with AES-GCM record encryption |
| Storage | S3-compatible (MinIO self-hosted) |
| Documents | Playwright Chromium (PDF), docxtemplater (DOCX for legal drafts) |
| AI | Claude, behind a provider interface, read-only analytics role |
| Testing | Vitest, Testcontainers, Supertest, Playwright, k6 |

Rationale for every choice: [`docs/architecture/01-technology-stack.md`](docs/architecture/01-technology-stack.md).

---

## Repository layout

```
apps/
  api/                NestJS API + workers + Prisma schema and migrations
  web/                React PWA — offline field capture, encrypted local store
packages/
  contracts/          Zod schemas, shared types, permission catalogue, money helpers
  config/             shared tsconfig / eslint / prettier
docs/
  architecture/       24 architecture documents (Release 0)
  adr/                architecture decision records
  runbooks/           operational procedures
infra/
  docker/             Compose environment
  sql/                views, triggers, RLS policies, seed SQL
```

---

## What is built, and what is not

All twelve releases are complete **on the server**: the schema, the domain logic, the API, the
database invariants and the acceptance suites. 197 routes, every one of them behind a declared
permission.

**The web client covers Release 2 only.** Sign in, the facility list, field assessment and evidence
capture — the offline journey an assessor walks in Isi-Uzo, which is the part that had to work
without signal. Everything from Release 3 onward (planning, partnership, documents, EMR, pharmacy,
laboratory, finance, people, analytics, AI) is reachable over the API and has no screens. Each
release's checklist item for a responsive UI was deferred, deliberately and in writing, rather than
met with something thin.

That is the honest state of it. A facility could not yet be run from this software by a person who
does not use `curl`.

---

## Getting started

Requires Node 22+, Docker, and npm 10+.

```bash
git clone https://github.com/astrobsm/community-health-center.git
cd community-health-center

cp .env.example .env          # then fill in the values — see the file's comments
npm install

npm run infra:up              # PostgreSQL, Redis, MinIO, Mailpit
npm run db:migrate            # apply migrations
npm run db:seed               # structural reference data only — no patient or financial fixtures

npm run dev                   # API on :3000, web on :5173
```

| URL | Service |
|---|---|
| http://localhost:5173 | Web application |
| http://localhost:3000/api/v1/meta/health | API health, with its database check |
| http://localhost:9001 | MinIO console |
| http://localhost:8025 | Mailpit |

The API serves no documentation endpoint. The route surface is generated from the router and
committed instead — [`docs/api/routes.md`](docs/api/routes.md) for every route and the permission it
requires, [`docs/api/openapi.json`](docs/api/openapi.json) for the machine-readable form. Reading it
needs no running server, and it cannot drift from the code because it is generated from it:

```bash
npm run openapi --workspace @chc/api
```

---

## Commands

### Running it locally

```bash
# One command: fresh PostgreSQL and Redis, migrations, reference data,
# one organisation with one facility, and two users.
bash apps/api/scripts/setup-local-demo.sh
bash apps/api/scripts/run-local.sh

# In another shell, exercise the whole chain against the running API. Each suite
# expects a freshly built database — one run on a database another has used
# fails on references already taken, which is not a fault in the code:
npm run smoke:all --workspace @chc/api      # all eleven suites, 687 checks, resetting between each

# The field app, and the offline proof:
npm run dev --workspace @chc/web            # http://127.0.0.1:5173
API_TARGET=http://127.0.0.1:3100 npm run test:e2e --workspace @chc/web
```

### What the offline suite proves

Acceptance criterion N, on a Pixel 7 profile against a real API and PostgreSQL:

| Asserted |
|---|
| An assessor signs in, opens an assessment, and **loses signal** |
| The app says it is offline rather than silently degrading |
| Questions are answered with no network at all |
| A reload lands on a lock screen that shows the unsynced count *before* unlocking |
| The password unlocks the encrypted store and restores the session |
| Signal returns and the queue drains on its own, with no user action |
| An assessment never opened on this device explains that, rather than spinning |
| A photograph is compressed to 1920px WebP, stripping the EXIF a phone embeds silently |
| Location is attached **only** when the assessor ticks the box |
| The bytes genuinely reach object storage — asserted against the server's own verification, not against a quiet status bar |

```bash
npm run dev                # API + web in watch mode
npm run build              # build all workspaces
npm run test               # unit tests
npm run test:integration   # integration tests (starts a real PostgreSQL via Testcontainers)
npm run test:e2e           # Playwright end-to-end
npm run test:acceptance    # the full-chain acceptance test
npm run lint               # eslint across workspaces
npm run typecheck          # tsc --noEmit
npm run check:boundaries   # module dependency rules
npm run db:migrate         # prisma migrate dev
npm run db:studio          # Prisma Studio
npm run db:erd             # regenerate the ERD from the live schema
npm run infra:up|down      # docker compose

# Release 0 acceptance gate — needs Docker, no other setup:
# spins up a throwaway PostgreSQL 16, applies every migration to an empty
# database, loads fixtures, and asserts that each database invariant refuses
# what it must.
npm run db:test-migrate --workspace @chc/api

# The route surface, generated from the router. Needs no database and no Docker.
npm run openapi --workspace @chc/api
```

### The acceptance suites

Every release ends in a suite that exercises its criteria against a running API, a real PostgreSQL, a
real Redis and a real MinIO — never a mock. `smoke:all` runs them in order, rebuilding the database
between each, and is the thing to reach for before a release.

| Suite | Checks | Proves |
|---|---|---|
| `smoke:auth` | 24 | Sign-in, MFA enrolment, token refresh, lockout, session revocation |
| `smoke:assessment` | 39 | Criterion A — assessment becomes baseline; evidence reaches object storage |
| `smoke:planning` | 67 | Findings become needs, needs become costed recommendations, the five-year model |
| `smoke:partnership` | 57 | Criterion K — the waterfall, capital recovery, and a renegotiation that cannot reach back |
| `smoke:documents` | 63 | Provenance, completeness gating, immutable versions, the MOU draft banner |
| `smoke:execution` | 71 | Criteria C–F — finding to project to purchase order to asset to commissioned service |
| `smoke:clinical` | 62 | Consent gating, the amendment chain, the clinical timeline |
| `smoke:operations` | 74 | Criteria G–I — dispensing moves stock, charges and the ledger in one transaction |
| `smoke:people` | 95 | Criterion J — attendance feeds performance feeds incentive; volume alone cannot pay |
| `smoke:analytics` | 69 | Criteria B and M — every figure drills to its rows; the baseline comparison reconciles |
| `smoke:ai` | 66 | The AI role writes nothing; an ungrounded figure is rejected; the kill switch works |

**687 checks, all passing**, most recently against PostgreSQL 16 on 28 September 2026.

### What the acceptance gate proves

The guarantees this product rests on live in the database, not in application code, so they hold
even when the ORM is bypassed. `db:test-migrate` asserts all **142** of them against a real
PostgreSQL — each one attempting the forbidden operation and checking that it is refused, and
refused *for the right reason*:

| Area | Asserted |
|---|---|
| Double-entry | An unbalanced entry cannot commit; a line cannot be both debit and credit |
| Append-only | `journal_line`, `journal_entry`, `stock_transaction`, `attendance`, `audit_log` refuse UPDATE/DELETE |
| Corrections | An entry can be marked `REVERSED` with a reason, but never edited |
| Periods | Posting into a closed period is refused |
| Stock | The batch cache equals the ledger sum; stock cannot go negative; an adjustment without a reason and approver is refused |
| Baseline | A sealed baseline metric cannot be edited or deleted |
| Clinical | BMI and EDD are computed by the database; impossible vitals are rejected |
| Staffing | Overlapping primary postings are refused |
| Billing | An invoice cannot be paid more than it asks; its recorded payments equal the allocations against it; a payment cannot be applied twice |
| People | An incentive's approver is never its computer; its total equals the components that explain it; a manual attendance entry says why |
| Quality | A closed incident has a root cause; a completed action was verified; an anonymous complaint carries no name |
| Analytics | The cached daily rollup agrees with the tables it was built from; the app role cannot reach the materialised view row-level security cannot protect |
| AI | Every write attempt as the AI role is refused; an insight cannot lose its label, its provenance, or be edited after the fact |
| Tenancy | Another tenant sees zero rows; with no scope set, nothing is visible (fails closed) |

---

## Development order

Twelve controlled releases, defined in
[`docs/architecture/21-development-roadmap.md`](docs/architecture/21-development-roadmap.md).

| | Release | Status |
|---|---|---|
| 0 | Architecture, schema, security baseline | **complete** — 142 invariants verified against a real PostgreSQL |
| 1 | Foundation — auth, org, facility, users, roles, audit | **complete** — 24 checks end to end |
| 2 | Field assessment, evidence, baseline | **complete** — 39 API checks + the offline E2E suite. **The only release with screens.** |
| 3 | Planning — needs, CAPEX, risk, financial model | **complete** — 67 checks. API only |
| 4 | Partnership — revenue models, capital recovery | **complete** — 57 checks. API only |
| 5 | Documents — proposal, letters, MOU, reports | **complete** — 63 checks. API only |
| 6 | Project execution — procurement, assets, commissioning | **complete** — 71 checks. API only |
| 7 | EMR — patients, encounters, clinical, referrals | **complete** — 62 checks. API only |
| 8 | Operations — laboratory, pharmacy, inventory, finance | **complete** — 74 checks. API only |
| 9 | People and quality — HR, attendance, performance, KPI | **complete** — 95 checks. API only |
| 10 | Analytics — dashboards, drill-down, lineage, billing | **complete** — 69 checks. API only |
| 11 | AI — assistant, anomaly detection, predictive analytics | **complete** — 66 checks. API only |

Billing — invoices, payments and waivers — was built in Release 10 rather than Release 8. Release 8
recorded charges and the ledger; nothing created an invoice or a patient payment until criterion M
needed the chain from care to money to be walkable end to end.

The field PWA ships with Release 2: encrypted offline store, dependency-ordered outbox, a lock
screen, and an always-visible sync status strip. Acceptance criterion N ("the system can operate
offline") is verified on a Pixel 7 profile against a real API and database.

A release ships only when it satisfies all nine Definition-of-Done criteria (migrations, validation,
permissions, audit, tests, error handling, responsive UI, offline where required, documentation).

**One of the nine was not met, in nine releases: the responsive UI.** Releases 3 to 11 have no
screens. That is recorded here rather than in a backlog nobody reads, because a reader deciding
whether this software can run a facility needs to know it before they read anything else.

---

## Documentation

| Document | Subject |
|---|---|
| [00 Product architecture](docs/architecture/00-product-architecture.md) | What this is; the data chain; assumptions |
| [01 Technology stack](docs/architecture/01-technology-stack.md) | Every choice, with rationale |
| [02 System architecture](docs/architecture/02-system-architecture.md) | Components, layering, transactions, events |
| [03 Database architecture](docs/architecture/03-database-architecture.md) | Conventions, table classes, RLS, triggers |
| [04 ERD](docs/architecture/04-erd.md) | Entity relationships by bounded context |
| [05 Module dependency map](docs/architecture/05-module-dependency-map.md) | Layers, dependencies, broken cycles |
| [06 API architecture](docs/architecture/06-api-architecture.md) | REST surface, errors, idempotency |
| [07 Authentication](docs/architecture/07-authentication.md) | Tokens, MFA, offline authentication |
| [08 RBAC](docs/architecture/08-rbac.md) | Permissions, roles, scope, redaction, break-glass |
| [09 Offline-first](docs/architecture/09-offline-first.md) | What works offline and why |
| [10 Synchronisation](docs/architecture/10-synchronisation.md) | Conflict detection and resolution |
| [11 Audit](docs/architecture/11-audit.md) | Tamper-evident institutional memory |
| [12 Financial](docs/architecture/12-financial-architecture.md) | Double-entry, model, waterfall, capital recovery |
| [13 Clinical](docs/architecture/13-clinical-architecture.md) | EMR, laboratory, pharmacy, safety |
| [14 Inventory](docs/architecture/14-inventory-architecture.md) | Stock ledger, FEFO, reconciliation |
| [15 Project management](docs/architecture/15-project-management.md) | Finding to outcome, CAPEX states |
| [16 Document generation](docs/architecture/16-document-generation.md) | Provenance, versioning, MOU |
| [17 AI](docs/architecture/17-ai-architecture.md) | Isolation, grounding, anti-fabrication |
| [18 Security](docs/architecture/18-security.md) | Threat model and controls |
| [19 Backup and DR](docs/architecture/19-backup-disaster-recovery.md) | RPO/RTO, verification, runbooks |
| [20 Testing](docs/architecture/20-testing.md) | Strategy and suites |
| [21 Roadmap](docs/architecture/21-development-roadmap.md) | Release order and gates |
| [22 Data lineage](docs/architecture/22-data-lineage.md) | The chains, and the lineage API |
| [23 Acceptance tests](docs/architecture/23-acceptance-tests.md) | How each criterion is proved |

---

## A note on legal and regulatory content

Generated agreements are drafts. Every MOU and management agreement produced by this system carries,
inescapably:

> **DRAFT — SUBJECT TO LEGAL, GOVERNMENT AND PROFESSIONAL REVIEW**

The system holds a configurable compliance register rather than hard-coded legal conclusions. It
does not give legal advice, and nothing it generates should be executed without qualified review.

---

## Licence

Proprietary. © Community Health Centre Platform contributors.
