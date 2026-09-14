# 18 — Security Architecture

---

## 1. Threat model

Designed against threats that are actually likely here, not a generic checklist.

| # | Threat | Likelihood | Controls |
|---|---|---|---|
| T1 | Field device stolen with patient data | High | Encrypted local store, in-memory keys, 7-day offline grace, remote revocation |
| T2 | Shared clinic workstation left logged in | High | Idle timeout, quick-lock, per-user PIN resume, device registration |
| T3 | Weak or shared passwords | High | Argon2id, minimums, breach list, MFA for privileged roles, session visibility |
| T4 | Insider browsing records out of curiosity | Medium-high | Scope enforcement, read auditing outside caseload, break-glass visibility |
| T5 | Cash or stock theft concealed in the system | Medium-high | Append-only ledgers, segregation of duties, reconciliation, variance analytics |
| T6 | Cross-tenant data leakage as facilities are added | Medium | Four-layer tenancy: guard, ORM extension, RLS, DTO mapping |
| T7 | SQL injection | Medium | Parameterised queries only; no string-built SQL; lint rule |
| T8 | XSS leading to token theft | Medium | Strict CSP, no third-party scripts, React escaping, short token lifetime |
| T9 | Backup exfiltration | Medium | Encrypted backups, separate credentials, restricted bucket, access audited |
| T10 | Ransomware on the host | Medium | Off-host encrypted backups, tested restore, immutable object versions |
| T11 | Prompt injection via the AI layer | Medium | Read-only role, no tools, numeric validation, data/instruction separation |
| T12 | Supply-chain compromise via npm | Medium | Lockfiles, `npm audit` in CI, Dependabot, minimal dependency surface |
| T13 | Denial of service on a small host | Medium | Rate limits, payload caps, query timeouts, connection pooling |
| T14 | Physical theft of the server | Low-medium | Disk encryption, off-site backups, documented recovery |
| T15 | Malicious administrator | Low | Tamper-evident audit chain, external hash publication, four-eyes on high-value actions |

T15 is bounded, not eliminated. An administrator with full database access can alter data; the hash
chain makes it **detectable**. Claiming otherwise would be dishonest.

---

## 2. Defence in depth

```
Network      TLS 1.3 · HSTS · proxy rate limits · restricted admin ports · no public DB
Application  AuthN → tenancy → AuthZ → validation → DTO mapping → audit  (fails closed)
Data         RLS · append-only rules · immutability triggers · field encryption
Key          Secret manager · rotation · envelope encryption · in-memory-only device keys
Operational  Least-privilege DB roles · separate AI role · backup isolation · monitoring
```

---

## 3. Encryption

| State | Mechanism |
|---|---|
| In transit | TLS 1.3, modern ciphers only, HSTS preload, certificate monitoring |
| At rest (server) | Full-disk encryption; PostgreSQL on an encrypted volume |
| At rest (object storage) | Server-side encryption; pre-signed URLs only; no public objects |
| At rest (device) | AES-256-GCM per record; key derived from the password, held in memory only |
| Field-level | NIN, phone, and bank details encrypted with a versioned data key |
| Backups | Encrypted before leaving the host; keys held separately from the backups |

**Field-level encryption is applied selectively.** Encrypting every column would make search and
reporting impossible and would push developers toward workarounds. It is applied where the field is
both highly identifying and rarely searched.

---

## 4. Input and output

- **Input:** every request body, query and param validated by Zod from `packages/contracts`.
  Unknown keys are stripped, not ignored. Numeric bounds, string lengths and enum membership are
  enforced at the edge.
- **SQL:** parameterised, always. An ESLint rule bans template-literal SQL containing `${`.
- **Output:** explicit DTO mapping. Prisma entities are never serialised directly, so a newly added
  sensitive column cannot leak by default.
- **Uploads:** content-type and magic-byte verification, size limits, image re-encoding (which
  strips embedded payloads), filenames never echoed into paths, and object keys that are random
  rather than derived from user input.

---

## 5. Content Security Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://<object-storage-host>;
connect-src 'self' https://<api-host> https://<object-storage-host>;
font-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

No CDN-hosted scripts. Everything is bundled and served from origin — which also makes the app work
in poor connectivity and removes an entire supply-chain vector.

---

## 6. Rate limiting

| Scope | Limit |
|---|---|
| Login, per account | 5 / 15 min, then a 30-minute lock |
| Login, per IP | 20 / 15 min |
| Password reset, per account | 3 / hour |
| API, per user, general | 300 / min |
| API, per user, writes | 60 / min |
| Sync push | 10 batches / min, 50 records per batch |
| Report/document generation | 10 / hour |
| AI queries | 30 / hour, plus a token budget |
| Global per IP | 1000 / min at the proxy |

Limits are configuration. Sync limits are deliberately generous — a device returning from a week
offline must be able to drain its queue without being throttled into failure.

---

## 7. Secrets

- Never in the repository. `.env.example` documents every variable with no values.
- Injected from the platform's secret store at runtime.
- Rotation schedule per `07-authentication.md` §7.
- A pre-commit hook plus CI secret scanning (gitleaks) blocks accidental commits.
- Application logs redact `password`, `token`, `secret`, `authorization`, `refreshToken`, `nin`,
  and `pin` by key name at the logger level, not at each call site.

---

## 8. Data protection (spec §84, Nigerian NDPA context)

| Requirement | Implementation |
|---|---|
| Lawful basis | Consent recorded per purpose; care delivery as the basis for treatment records |
| Data minimisation | Collect only what a workflow uses; optional fields genuinely optional |
| Purpose limitation | Purpose-scoped consent; government reporting is aggregate-only |
| Accuracy | Correction workflows with amendment chains; patients may request correction |
| Storage limitation | Retention policies as configuration; archival then deletion, audited |
| Integrity & confidentiality | The controls in this document |
| Accountability | Audit trail, DPIA template, processing register in `docs/data-protection/` |
| Subject access | Export of a patient's own record, permissioned and audited |
| Breach management | Documented runbook: detect, contain, assess, notify, remediate, review |
| Cross-border | Data residency is a deployment decision, recorded per organisation |

A privacy notice is presented at registration, versioned, and the accepted version is recorded with
the consent.

---

## 9. Segregation of duties

| Action | Cannot also be performed by |
|---|---|
| Raise a payment | The person who approves it |
| Request procurement | The person who approves the purchase order |
| Record a stock adjustment | The person who approves it |
| Prescribe | Enforced separately: pharmacist verification is a distinct permission |
| Post a journal entry | The person who closes the period |
| Compute an incentive | The person who approves the payment of it |

Enforced in the service layer with explicit checks and covered by tests, not left to role design
alone — because an organisation may legitimately grant one person both permissions, and the
*action-level* check must still hold. The incentive rule is enforced twice over: by the service, and
by a CHECK constraint on `people.staff_incentive` that refuses a row whose approver is its creator,
so the same self-approval written in raw SQL is refused too.

Each side of each rule must name a permission that exists and that some assignable role holds —
asserted by test, after two of these rules were found naming permissions the catalogue had never
heard of, which made them read as controls while being unenforceable in fact. The same test found
that only the finance officer could close a period, so "the person posting entries may not close the
period" could be satisfied only by employing two finance officers; the organisation administrator,
who cannot post, now holds `finance.close_period` as well.

---

## 10. Secure development

- TypeScript strict mode; `any` requires a justification comment and is flagged in review.
- Dependency lockfiles committed; `npm audit --audit-level=high` fails CI; Dependabot enabled.
- Static analysis: ESLint with security rules, plus Semgrep rules for this codebase's own
  invariants (no raw SQL interpolation, no direct `prisma` import outside a repository, no route
  without a permission decorator).
- Every pull request touching auth, tenancy, finance, or clinical data requires review.
- `npm run security-review` before each release, and the mandated test suites in §11 must pass.

---

## 11. Security test suite

| Test | Asserts |
|---|---|
| `tenancy-isolation.spec.ts` | Cross-facility access fails at API and at SQL |
| `rls-enforcement.spec.ts` | RLS holds when the ORM is bypassed |
| `authz-route-coverage.spec.ts` | No mutating route lacks a permission |
| `authn-brute-force.spec.ts` | Lockout and rate limits behave as specified |
| `token-reuse.spec.ts` | Refresh reuse revokes the family and is audited |
| `redaction.spec.ts` | Observer roles never receive identifying fields |
| `injection.spec.ts` | Payloads with SQL/NoSQL/command metacharacters are handled safely |
| `upload-safety.spec.ts` | Disguised executables and oversized files are rejected |
| `csp.spec.ts` | Response headers match the policy above |
| `secrets-scan` | No secret patterns anywhere in the tree |
| `segregation.spec.ts` | Each rule in §9 is enforced at action level |
