# 07 — Authentication Architecture

The threat model is specific: shared devices in a clinic, phones that get stolen in the field, weak
passwords, staff turnover, and network operators who cannot be assumed to be honest.

---

## 1. Credential storage

- **Argon2id**, memory 64 MB, time cost 3, parallelism 4, 16-byte salt. Tuned so a hash takes
  ~250 ms on the target server, and re-tuned as a config value, not a code change.
- Passwords are never logged, never returned, never placed in an audit `old_value`/`new_value`.
- Minimum 12 characters; checked against a compiled list of the 100k most common passwords and
  against the user's own name, email and facility name.
- `password_changed_at` is recorded. Changing a password revokes every refresh token for that user
  except the current session, and the user is shown the count of sessions ended.

---

## 2. Token model

Two tokens with deliberately different properties.

### Access token — JWT, EdDSA (Ed25519), 10 minutes

```json
{
  "sub": "<user uuid>",
  "sid": "<session uuid>",
  "org": "<organisation uuid>",
  "fac": ["<facility uuid>", "..."],
  "roles": ["FACILITY_MANAGER"],
  "pv": 7,
  "typ": "access",
  "iat": 1789000000,
  "exp": 1789000600,
  "iss": "chc-platform",
  "aud": "chc-api"
}
```

- **EdDSA, not HS256** — the signing key is asymmetric, so the verification key can be distributed
  (to a future report service, for example) without granting the ability to mint tokens.
- **Permissions are not in the token.** Only `pv` (permission version). Effective permissions are
  resolved server-side from a Redis-cached set. A role change therefore takes effect on the next
  request, not in ten minutes — which matters when revoking a dismissed staff member.
- Ten minutes is short enough that a stolen token is of limited value, and long enough that a device
  on a poor link is not constantly refreshing.

### Refresh token — opaque, rotating, 30 days

- 32 bytes of CSPRNG output, returned once. Only its SHA-256 hash is stored.
- **Rotation on every use.** The old token is marked `ROTATED` and the new one is issued.
- **Reuse detection.** Presenting an already-rotated token means it was stolen: the entire token
  family (that session's lineage) is revoked immediately, an `AuditLog` entry of type
  `TOKEN_REUSE_DETECTED` is written, and the user is notified.
- Bound to `device_id` and a hash of the user agent. A mismatch revokes the family.
- 30 days because a field device may be offline for weeks; a shorter window would force an assessor
  to return to coverage merely to keep working.

### Why not cookies

Field clients are PWAs that also run as installed apps and must send credentials from a service
worker replaying an offline queue. A bearer token in the `Authorization` header, with the refresh
token in a non-extractable-where-possible storage slot, is simpler to reason about than
`SameSite` behaviour across those contexts, and removes CSRF as a category. The trade-off — XSS can
read the token — is addressed by a strict CSP, no third-party scripts, and short token lifetime.

---

## 3. Multi-factor authentication

- **TOTP** (RFC 6238), 30-second step, ±1 window tolerance. Works entirely offline, which matters
  where SMS delivery is unreliable and expensive.
- 10 single-use recovery codes, Argon2-hashed, shown once.
- **Mandatory** for: Super Administrator, Organisation Administrator, Finance Officer, Auditor, and
  any user holding a permission in the `finance.post`, `contract.execute`, or `rbac.*` families.
- **Optional but encouraged** for clinical roles — a nurse at a shared triage station cannot
  reasonably be asked for a phone-based code every shift.
- SMS is explicitly **not** a second factor. It is available for notifications only.

---

## 4. Session lifecycle

```
POST /auth/login  { email, password, deviceId }
  ├─ rate limited: 5 attempts / 15 min per account, 20 / 15 min per IP
  ├─ constant-time response whether or not the account exists
  ├─ if mfa_enabled → 200 { mfaRequired: true, mfaToken }  (mfaToken: 5 min, single purpose)
  └─ else → 200 { accessToken, refreshToken, user, permissions, facilities }

POST /auth/mfa/verify  { mfaToken, code }
  └─ 200 { accessToken, refreshToken, ... }

POST /auth/refresh  { refreshToken, deviceId }
  ├─ hash lookup; if ROTATED → revoke family, 401, audit TOKEN_REUSE_DETECTED
  ├─ if session revoked or user disabled → 401
  └─ 200 { accessToken, refreshToken }   (both new)

POST /auth/logout          revokes the current session
POST /auth/logout-all      revokes every session for the user
GET  /auth/sessions        lists active sessions: device, IP, last seen, current flag
DELETE /auth/sessions/:id  revoke one
```

Idle timeout 30 minutes for finance and administration roles; 8 hours for clinical roles on a
device registered as a shared clinic workstation. Absolute session lifetime 30 days regardless.

---

## 5. Offline authentication

A field device must let an assessor keep working for days without a network. It must not become a
way to bypass access control.

**How it works**

1. On a successful online login, the client derives a verifier from the password using Argon2id with
   parameters and salt supplied by the server, and stores **only the verifier** plus an encrypted
   credential bundle.
2. The bundle contains the user's identity, role and permission snapshot, tenant scope, and the
   data-encryption key for the local database. It is sealed with a key derived from the password.
3. Offline login re-derives the key from the entered password and attempts to unseal the bundle.
   Success proves the password without any network call; failure reveals nothing.
4. The unsealed data-encryption key exists only in memory for the session. Locking the app, closing
   the tab, or an idle timeout discards it, and the local database becomes unreadable again.

**Bounds**

- Offline grace period: **7 days** by default (configurable per organisation). After that, the app
  requires an online login before further data capture — a deliberate limit on how long a lost
  device stays useful.
- Offline attempt limiter: 10 failures wipes the local data-encryption key. Synced data is safe on
  the server; unsynced local data is lost. This trade-off is stated in the field-device policy and
  shown to the user on first offline login.
- Permissions used offline are the snapshot from the last sync. A revocation reaches the device only
  on its next connection — an unavoidable property of offline operation, which is why the grace
  period exists and why high-privilege roles (finance, contracts, RBAC) are **barred from offline
  mode entirely**.

---

## 6. Account lifecycle

| Event | Behaviour |
|---|---|
| Invitation | Admin creates the user; a single-use, 72-hour, hashed invitation token is emailed |
| First login | Password set, MFA enrolled if the role requires it, privacy notice acknowledged |
| Lockout | 10 consecutive failures locks for 30 minutes; admin can unlock; always audited |
| Password reset | Single-use, 30-minute token; constant-time response; all sessions revoked on use |
| Disable | Immediate: sessions revoked, permission cache purged, offline bundle invalidated at next sync |
| Deletion | Never. Users are disabled and retained — audit history must remain attributable |

---

## 7. Key management

| Key | Storage | Rotation |
|---|---|---|
| JWT Ed25519 private key | Environment/secret manager, never in the repo | 90 days, overlapping `kid` |
| JWT public keys | Served at `/.well-known/jwks.json` | Two active during rotation |
| Refresh-token pepper | Secret manager | 180 days, with re-hash on next use |
| Database field-encryption key | Secret manager, envelope-encrypted | 365 days, versioned per record |
| Object-storage credentials | Secret manager | 90 days |

Token verification accepts any key in the JWKS, so rotation never causes a mass logout.

---

## 8. What is audited

Every one of these writes an `audit_log` row with actor, IP, device, user agent and outcome:
login success, login failure (with reason category, never the attempted password), MFA challenge
issued/passed/failed, refresh, refresh reuse detection, logout, session revocation, password change,
password reset request and completion, MFA enrolment and removal, role assignment change, account
lock/unlock/disable, offline bundle issuance, and offline grace expiry.
