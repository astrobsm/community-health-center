# 08 — RBAC Architecture

Authorisation answers three questions on every request, in order. All three must pass.

```
1. SCOPE    Is this record inside the caller's organisation and facility scope?
2. ACTION   Does the caller hold the permission this endpoint declares?
3. FIELD    Which fields of the result may this caller see?
```

Failing any one returns 404 (not 403) for scope failures, so the existence of another facility's
record is never leaked.

---

## 1. Permission model

Permissions are `module.action` strings, defined once in `packages/contracts/src/permissions.ts` and
seeded into the `permission` table. The code catalogue is the source of truth; the table exists so
roles can reference permissions by foreign key.

```
facility.read           facility.write          facility.transition_stage
assessment.read         assessment.write        assessment.submit       assessment.verify
evidence.read           evidence.upload         evidence.verify
baseline.read           baseline.seal
needs.read              needs.write             needs.prioritise
capex.read              capex.write             capex.approve
financial_model.read    financial_model.write   financial_model.approve  financial_model.unlock
partnership.read        partnership.write       partnership.compute_waterfall
proposal.read           proposal.write          proposal.approve
contract.read           contract.draft          contract.execute
project.read            project.write           project.complete
procurement.request     procurement.approve     procurement.order        procurement.receive
asset.read              asset.write             asset.commission
patient.read            patient.write           patient.merge
encounter.read          encounter.write         encounter.close
clinical.read           clinical.write          clinical.amend
lab.order               lab.collect             lab.process              lab.verify
pharmacy.read           pharmacy.verify         pharmacy.dispense        pharmacy.return
inventory.read          inventory.receive       inventory.issue          inventory.adjust  inventory.count
billing.read            billing.charge          billing.invoice          billing.waive
finance.read            finance.post            finance.reverse          finance.close_period  finance.reconcile
payment.receive         payment.refund
hr.read                 hr.write                hr.credential_verify
attendance.read         attendance.record       attendance.correct
performance.read        performance.configure   performance.approve_incentive
quality.read            quality.write           quality.close
kpi.read                kpi.configure
document.read           document.generate       document.approve
report.read             report.export
analytics.read          analytics.benchmark
ai.query
audit.read
rbac.read               rbac.write
config.read             config.write
admin.system            admin.backup            admin.impersonate
```

Two derived permissions deserve note:

- `*.read_identified` — the right to see patient-identifying fields. A government observer holds
  `encounter.read` but not `patient.read_identified`, which is exactly how spec §41 is satisfied.
- `admin.impersonate` — held by no seeded role. It must be granted deliberately, is time-boxed,
  and every impersonated request is audited with both the real and effective user.

---

## 2. Roles

Roles are organisation-scoped rows, not code. The eighteen roles from spec §58 are seeded as
`is_system_managed = true` templates that an organisation administrator may clone and adjust but
not silently redefine.

| Role | Scope | Shape of access |
|---|---|---|
| Super Administrator | Platform | Everything except reading identified clinical data without a logged break-glass |
| Organisation Administrator | Organisation | All facilities in the organisation; no clinical write |
| Facility Manager | Facility | Operations, staff, stock, finance read, KPIs; no clinical write |
| Project Manager | Facility | Assessment, projects, procurement, CAPEX, risks |
| Clinical Lead | Facility | Full clinical read/write, clinical audit, quality |
| Doctor / Clinician | Facility | Own-facility clinical read/write, orders, prescriptions |
| Nurse / Midwife | Facility | Triage, nursing, maternity, immunisation, follow-up |
| CHEW / CHW | Facility | Triage, limited consultation, community, outreach |
| Laboratory Personnel | Facility | Orders, samples, results, verification, QC, reagents |
| Pharmacy Personnel | Facility | Prescriptions, dispensing, pharmacy stock |
| Inventory Officer | Facility | Inventory, counts, adjustments (adjustments need approval) |
| Finance Officer | Facility | Billing, payments, ledger, reconciliation, budgets |
| Cashier | Facility | Receive payments, issue receipts; **no clinical record access** |
| HR Officer | Facility | Staff, credentials, postings, attendance, leave |
| Auditor | Organisation | **Read-only everywhere**, including the audit log; no write permission exists |
| Government / LGA Observer | Facility (aggregated) | Aggregate dashboards, KPIs, public value; no identified data |
| Community Observer | Facility (aggregated) | A narrower aggregate subset |
| Patient | Own record | Own demographics, appointments, results released to patients |

**Least privilege is verified, not asserted.** `rbac-least-privilege.spec.ts` asserts that:
the Cashier role holds no `clinical.*` permission; the Government Observer holds no
`*.read_identified`; the Auditor holds no permission ending in `write`, `post`, `approve`,
`execute`, or `delete`; and no seeded role holds `admin.impersonate`.

---

## 3. Scope model

A user's scope is the tuple `(organisation, facility set, scope level)`.

```
user_facility_access {
  user_id, facility_id,
  scope_level: FULL | DEPARTMENT | AGGREGATE_ONLY | SELF_ONLY,
  department_id NULL
}
```

| Scope level | Meaning |
|---|---|
| `FULL` | All records of that facility, subject to permissions |
| `DEPARTMENT` | Only records owned by the named department |
| `AGGREGATE_ONLY` | Only aggregated read-models; no row-level access — government/community observers |
| `SELF_ONLY` | Only records where the caller is the subject — the Patient role |

Scope is resolved once per request by `TenancyGuard`, cached in `AsyncLocalStorage`, pushed into
PostgreSQL via `SET LOCAL`, and applied automatically by the Prisma tenancy extension. A developer
writing a new repository method gets tenancy filtering whether or not they remember it — and RLS
catches them if the extension is somehow bypassed.

---

## 4. Enforcement layers

Four layers, because a single mistake in any one of them must not become a breach.

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Route | `@RequirePermission('pharmacy.dispense')`; boot fails if a mutating route lacks one | Missing authorisation |
| 2. Query | Prisma client extension injects `organisation_id`/`facility_id` predicates | Forgotten scope filter |
| 3. Database | PostgreSQL RLS on every tenant table | Raw SQL, scripts, ORM bypass |
| 4. Response | DTO mapping + field-level redaction based on `*.read_identified` | Over-disclosure in a payload |

---

## 5. Field-level redaction

Redaction is declarative, applied by an interceptor, and the redaction itself is visible:

```ts
@Sensitive('patient.read_identified')
givenName: string;
```

A caller without the permission receives `null` for the field plus a `_redacted: ['givenName',
'familyName', 'phone']` array. Hiding the fact of redaction would let a government observer believe
they were seeing a complete record; showing it makes the boundary explicit and honest.

For aggregate consumers there is a further protection: any aggregate with a denominator below the
configured **small-cell threshold** (default 5) returns `value: null, suppressed: true,
reason: 'SMALL_CELL'`. Otherwise "1 HIV-positive patient in ward X" re-identifies a person through
arithmetic alone.

---

## 6. Break-glass access

Emergency clinical access is a real requirement — a patient may arrive unconscious at 2 a.m. and the
attending clinician may not have standing access to their record.

```
POST /api/v1/patients/:id/break-glass   { reason, clinicalJustification }
```

Grants 60 minutes of `patient.read_identified` + `clinical.read` for that single patient. It is
self-service (blocking care to wait for an administrator would be dangerous) but:

- writes a high-severity audit record;
- notifies the Clinical Lead and Facility Manager immediately;
- appears on a standing report reviewed weekly;
- is listed on the patient's own access log.

Deterrence by visibility, not by obstruction.

---

## 7. Permission resolution and caching

```
effective(user) = ⋃ permissions(role) for role in roles(user)
                  ∩ permissions_allowed_at(scope_level)
                  − explicit_denials(user)
```

Explicit denials always win over grants. The resolved set is cached in Redis under
`perm:{userId}:{permissionVersion}`; any role or access change increments the user's
`permission_version`, which invalidates the cache instantly and makes every existing access token's
`pv` claim stale — so revocation is effective on the very next request rather than at token expiry.

---

## 8. Testing

| Test | Asserts |
|---|---|
| `rbac-route-coverage.spec.ts` | Every mutating route declares a permission |
| `rbac-least-privilege.spec.ts` | The role invariants in §2 |
| `tenancy-isolation.spec.ts` | Cross-facility read returns 404 at API and 0 rows at SQL under the app role |
| `rls-enforcement.spec.ts` | Direct SQL as the app role cannot escape RLS |
| `redaction.spec.ts` | Observer roles never receive identifying fields |
| `small-cell.spec.ts` | Aggregates below threshold are suppressed |
| `break-glass.spec.ts` | Access expires, is audited, and notifies |
| `permission-revocation.spec.ts` | A revoked role takes effect on the next request |
