# 11 — Audit Architecture

The audit trail is the institutional memory. When the partnership is reviewed in year four and
someone asks "who approved this, and on what evidence?", the answer must exist and must be
trustworthy.

---

## 1. The audit record

```sql
CREATE TABLE audit.audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  organisation_id  uuid NOT NULL,
  facility_id      uuid,
  actor_user_id    uuid,               -- null for system actions
  actor_type       audit_actor_type NOT NULL,  -- USER | SYSTEM | INTEGRATION | AI
  on_behalf_of     uuid,               -- impersonation: the effective user
  action           text NOT NULL,      -- 'pharmacy.dispense', 'auth.login.failed'
  entity_type      text NOT NULL,
  entity_id        uuid,
  old_value        jsonb,
  new_value        jsonb,
  changed_fields   text[],             -- computed, for fast filtering
  reason           text,               -- required for corrections and overrides
  outcome          audit_outcome NOT NULL,     -- SUCCESS | FAILURE | DENIED
  severity         audit_severity NOT NULL,    -- INFO | NOTICE | WARNING | CRITICAL
  device_id        text,
  ip_address       inet,
  user_agent       text,
  session_id       uuid,
  trace_id         text NOT NULL,      -- ties to application logs
  request_id       text,
  prev_hash        bytea,              -- tamper-evident chain
  row_hash         bytea NOT NULL
);
```

This satisfies spec §42 literally: **WHO** (`actor_user_id`, `on_behalf_of`), **WHAT** (`action`,
`entity_type`, `entity_id`), **WHEN** (`occurred_at`), **OLD VALUE**, **NEW VALUE**, **REASON**,
**DEVICE** (`device_id`, `ip_address`, `user_agent`).

---

## 2. Immutability and tamper evidence

```sql
CREATE RULE audit_log_no_update AS ON UPDATE TO audit.audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit.audit_log DO INSTEAD NOTHING;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM app_role;
```

Each row's `row_hash` is `SHA-256(prev_hash || canonical_json(row_without_hashes))`, chaining rows
per facility per day. A nightly job verifies the chain and publishes the terminal hash to an
append-only external location.

This does not make tampering impossible for someone with full database administrator rights — no
application-level design can. It makes tampering **detectable**, which is the achievable and honest
goal. The limitation is documented rather than glossed over.

---

## 3. Capture — three independent paths

| Path | Covers | Mechanism |
|---|---|---|
| 1. Interceptor | All HTTP mutations | `AuditInterceptor`, global, captures before/after state |
| 2. Database trigger | Any write, including scripts and raw SQL | `trg_audit_row` on high-value tables |
| 3. Domain event | Business meaning beyond a row change | Explicit `audit.record()` calls |

Three paths because each has a blind spot. The interceptor misses a `psql` session; the trigger
misses request context (IP, device, reason); domain events miss anything a developer forgets. A
daily reconciliation job compares trigger-sourced rows against interceptor-sourced rows and flags
writes that appear in one but not the other — a direct indicator of a bypass.

**Tables with mandatory trigger-level audit:** every Class-3 ledger, every Class-4 snapshot, plus
`patient`, `clinical_note`, `diagnosis`, `lab_result`, `dispensing`, `payment`, `journal_entry`,
`stock_transaction`, `contract_version`, `app_user`, `user_role`, `role_permission`,
`system_configuration`.

---

## 4. Actions audited

**Authentication** — login success/failure/lockout, MFA issued/passed/failed, refresh, token reuse
detection, logout, session revocation, password change/reset, MFA enrolment/removal, offline bundle
issuance.

**Access control** — role created/modified, permission granted/revoked, facility access changed,
break-glass invoked and expired, impersonation started and ended.

**Clinical** — patient registered/merged, consent granted/withdrawn, encounter opened/closed, note
written/amended, diagnosis recorded/amended, prescription written, lab order placed, sample
collected, result entered/verified/amended, critical result acknowledged, referral made, record
viewed *where the record is not the caller's routine caseload*.

**Financial** — charge raised, invoice issued, payment received, refund, journal posted, journal
reversed, period closed/reopened, budget approved/revised, bank reconciliation completed, waiver
granted.

**Supply** — goods received, stock issued, transferred, adjusted, written off, count performed,
variance accepted, batch expired and quarantined.

**Procurement** — request raised/approved/rejected, quotations recorded, supplier selected, PO
issued/amended/cancelled, GRN recorded, supplier invoice matched, payment authorised.

**Revitalisation** — assessment submitted, response verified, evidence uploaded/verified, baseline
sealed, need prioritised, capex approved, model assumption changed, model approved/unlocked,
waterfall computed, proposal approved, contract drafted/versioned/executed, obligation marked met.

**System** — configuration changed, tariff versioned, KPI definition changed, template published,
backup taken/verified/restored, data export performed, AI insight generated.

---

## 5. Reading a record is sometimes auditable

Write auditing is uncontroversial. Read auditing needs judgement: logging every row a clinician
opens produces millions of rows that nobody reviews, which is security theatre.

We audit reads only where disclosure is the risk:

- any access to a patient record **outside** the caller's active caseload or department;
- any break-glass access;
- any bulk export or report containing identified data;
- any access by an Auditor, Super Administrator, or Government Observer to identified data;
- any search that returns identified results.

Routine reads (a nurse opening the patient she is currently triaging) are not individually logged;
the encounter itself is the record of that access.

---

## 6. Correction semantics

Corrections are visible history, never edits. Each domain has its own mechanism, and each writes
a linked audit pair.

| Domain | Original | Correction |
|---|---|---|
| Clinical | `status = AMENDED`, retained in full | New row, `amends_id`, reason, author, timestamp |
| Financial | `status = REVERSED`, retained | Contra `journal_entry`, `reverses_id`, reason, approver |
| Inventory | Retained | New `stock_transaction` type `ADJUSTMENT`, reason code, approver |
| Assessment | Retained | New `assessment_response` version with reason |
| Document | `status = SUPERSEDED` | New `document_version`; approved versions are never overwritten |

A `reason` is **mandatory** — enforced by the API schema — for every correction, override,
break-glass, waiver, adjustment, reversal, and any change to an approved financial model.

---

## 7. Audit access

Exposed at `/api/v1/audit`, requiring `audit.read`, held by the Auditor role and by Organisation
Administrators.

- Filter by actor, entity, action, date range, facility, severity, outcome.
- **Entity history** — the full lifecycle of one record, in order, with diffs.
- **Actor history** — everything one user did in a period.
- **Chain verification** — on-demand recomputation of the hash chain for a date range.
- Export to CSV/JSON, itself audited.

The Auditor role has **no write permission anywhere in the system**. This is asserted by
`rbac-least-privilege.spec.ts`, not merely intended.

---

## 8. Retention, volume and performance

- Retained **7 years**, then archived to cold object storage before the partition is dropped; the
  drop itself is audited.
- `audit_log` is designed for monthly range partitioning; enabled when volume warrants it.
- Writes are asynchronous through an in-process queue with a bounded buffer, **except** for
  `CRITICAL` severity (authentication failures, permission denials, financial reversals, break-glass)
  which are written synchronously in the same transaction as the business data.
- If the audit write fails for a `CRITICAL` action, **the business transaction fails**. An action
  that cannot be recorded must not happen.
