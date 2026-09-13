# 06 — API Architecture

REST over HTTPS, versioned, OpenAPI-described, Zod-validated at both ends.

---

## 1. Why REST rather than GraphQL or tRPC

- A government or NHIS integration will be handed an OpenAPI document, not a GraphQL schema.
- Field clients must cache and replay requests offline; REST's resource/verb semantics make an
  outbox queue trivial to reason about and to retry idempotently.
- Per-endpoint permission declaration is explicit and auditable. GraphQL field-level authorisation
  across 160 entities is a far larger attack surface to get right.
- tRPC would be pleasant internally but couples every consumer to our TypeScript build.

Aggregation pressure (the dashboard needs many resources at once) is handled by **purpose-built
read endpoints** under `/dashboard` and `/reports` that return exactly one screen's data in one
round trip — important on a 3G link — rather than by a general query language.

---

## 2. Versioning

Base path: `/api/v1`. The version is in the URL, not a header, so a cached offline client and a
server log both make the version obvious.

- Additive changes (new optional field, new endpoint) ship within `v1`.
- Breaking changes create `v2`; `v1` is supported for at least 12 months because field devices may
  be offline for weeks.
- `GET /api/v1/meta/version` returns API version, minimum supported client version, and the active
  assessment-template versions — the client checks this on every successful sync.

---

## 3. Endpoint surface

```
/api/v1/auth                 login, refresh, logout, mfa, password, sessions
/api/v1/meta                 version, health, capabilities
/api/v1/organisations        CRUD (super admin)
/api/v1/facilities           CRUD, lifecycle transitions, profile, departments, services
/api/v1/users                users, roles, facility access
/api/v1/rbac                 roles, permissions, assignments
/api/v1/config               tariffs, chart of accounts, KPI definitions, templates, reference lists

/api/v1/assessments          assessments, sections, items, responses, scores, completion
/api/v1/evidence             upload intent, evidence records, verification
/api/v1/baselines            snapshots, metrics, seal
/api/v1/needs                needs, recommendations, prioritisation
/api/v1/capex                plans, lines, approvals, working capital
/api/v1/financial-models     models, assumptions, scenarios, projections, sensitivity
/api/v1/partnerships         partnerships, waterfall models, obligations, capital recovery
/api/v1/proposals            proposals, sections, approvals
/api/v1/letters              templates, generated letters
/api/v1/contracts            contracts, versions, MOU drafts, execution

/api/v1/projects             projects, phases, tasks, milestones, budgets, expenses, evidence
/api/v1/procurement          requests, quotations, orders, receipts, supplier invoices
/api/v1/assets               assets, maintenance, commissioning
/api/v1/rooms                rooms, infrastructure, utilities

/api/v1/patients             registration, identifiers, contacts, consent, search, timeline
/api/v1/encounters           encounters, triage, notes, diagnoses, procedures, referrals
/api/v1/laboratory           catalogue, orders, samples, results, verification, QC
/api/v1/pharmacy             prescriptions, verification, dispensing, returns
/api/v1/inventory            items, batches, stock transactions, counts, adjustments, alerts
/api/v1/billing              charges, invoices, payments, refunds
/api/v1/finance              accounts, journals, periods, budgets, reconciliation
/api/v1/staff                staff, credentials, postings, schedules
/api/v1/attendance           clock events, rosters, leave
/api/v1/performance          metrics, results, reviews, incentives
/api/v1/community            communities, profiles, surveys

/api/v1/kpis                 definitions, assignments, results, baseline-current-target
/api/v1/quality              incidents, complaints, improvements, corrective actions
/api/v1/risks                risk register
/api/v1/compliance           requirements, statuses, expiries
/api/v1/documents            generation, versions, approvals, download
/api/v1/reports              daily, weekly, monthly, quarterly, annual
/api/v1/dashboard            role-scoped dashboard payloads
/api/v1/analytics            benchmarking, trends, drill-down
/api/v1/ai                   insights, summaries, anomaly detection (all labelled)
/api/v1/search               global permission-aware search
/api/v1/notifications        list, read, preferences
/api/v1/sync                 pull, push, status, conflicts
/api/v1/audit                query audit log (auditor role)
/api/v1/admin                backups, jobs, system health, data quality
```

---

## 4. Conventions

**Collections** support `?page`, `?pageSize` (max 100), `?sort`, `?filter[field]`, `?q`.
Responses are envelope-free for single resources and enveloped for collections:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "pageSize": 25, "total": 412, "computedAt": "2026-09-13T09:14:00Z" }
}
```

**Cursor pagination** (`?cursor=`) is used for large append-only reads (`audit`, `stock
transactions`, `sync pull`) where offset pagination would drift.

**Every quantitative field** is serialised with its classification:

```json
{
  "patientsPerDay": { "value": 31, "classification": "ACTUAL", "computedAt": "...", "sourceRef": "mv_daily_clinical" },
  "projectedRevenue": { "value": 4820000, "currency": "NGN", "classification": "PROJECTED", "modelVersion": "fm-2026-03:v4" }
}
```

A response containing a bare number where the schema requires a classified value fails serialisation
in development and is logged as a defect in production. This is how §82 is enforced mechanically
rather than by discipline.

**Money** is always `{ "amountMinor": 482000000, "currency": "NGN" }`. No decimal strings, no floats.

---

## 5. Errors — RFC 9457 Problem Details

```json
{
  "type": "https://chc.health/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 409,
  "detail": "Batch AMX-2411 has 12 units; 30 requested.",
  "instance": "/api/v1/pharmacy/dispensings",
  "traceId": "01JB6X...",
  "errors": [ { "field": "quantity", "code": "max", "max": 12 } ]
}
```

Errors are never swallowed. A 5xx always carries a `traceId` that appears in the structured log,
and the client shows it so a facility manager can quote it in a support call.

| Status | Used for |
|---|---|
| 400 | Malformed request |
| 401 | No or invalid credentials |
| 403 | Authenticated but lacks permission, or out of tenant scope |
| 404 | Not found **or** not visible in scope (never distinguish — prevents enumeration) |
| 409 | Business-rule conflict: insufficient stock, closed period, sealed baseline, version conflict |
| 410 | Superseded document or contract version |
| 422 | Schema-valid but semantically invalid (e.g. debits ≠ credits) |
| 423 | Locked: approved financial model requires explicit change confirmation |
| 429 | Rate limited (`Retry-After` set) |

---

## 6. Idempotency

Every unsafe endpoint (`POST`, `PATCH`, `DELETE`) accepts an `Idempotency-Key` header, and it is
**mandatory** for offline-originated writes. The key is the client-generated UUID of the record.

The server stores key → (status, response body, entity id) in Redis for 48 hours and in Postgres
(`idempotency_record`) for 30 days, because a field device may retry a week later. A replay returns
the original response, never a duplicate payment or a double stock deduction.

---

## 7. Sync endpoints

```
GET  /api/v1/sync/pull?since=<cursor>&scopes=assessment,patient,inventory
POST /api/v1/sync/push        { deviceId, batch: [ { entity, op, id, version, payload } ] }
GET  /api/v1/sync/status
GET  /api/v1/sync/conflicts
POST /api/v1/sync/conflicts/:id/resolve   { resolution, reason }
```

`push` is transactional per record, not per batch: one rejected record must not block the other
forty. The response returns a per-record outcome (`applied | conflict | rejected`) with reasons.
See `10-synchronisation.md`.

---

## 8. Security controls on every request

| Control | Mechanism |
|---|---|
| Transport | TLS 1.3, HSTS, no mixed content |
| Authentication | EdDSA JWT access token, 10-minute lifetime |
| Tenant scope | Resolved server-side from the session, never from a request parameter |
| Authorisation | `@RequirePermission()` — an endpoint without the decorator is rejected at boot |
| Input validation | Zod pipe from `packages/contracts`; unknown keys stripped |
| Output | Explicit DTO mapping; entities are never serialised directly |
| Rate limiting | Per-IP at the proxy, per-user + per-endpoint-class in Redis |
| Payload limits | 1 MB JSON; media goes to object storage via pre-signed upload |
| CORS | Explicit allowlist; credentials via `Authorization` header, not cookies |
| Audit | `AuditInterceptor` on every mutating request |
| Tracing | `traceId` propagated to logs, errors, and the client |

**Boot-time assertion:** the application enumerates every route at startup and refuses to start if
any mutating route lacks a permission declaration. A developer cannot ship an unprotected endpoint.

---

## 9. Documentation

OpenAPI 3.1 is generated from the Zod contracts (single source of truth — the spec cannot drift
from validation) and served at `/api/v1/docs` in non-production environments. The generated
document is committed on each release so API changes are reviewable in a diff.
