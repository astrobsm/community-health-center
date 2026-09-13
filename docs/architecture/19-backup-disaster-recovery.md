# 19 — Backup and Disaster Recovery

A rural facility cannot absorb the loss of its clinical or financial history. This is the part of
the architecture that must work on the worst day, not the average one.

---

## 1. Objectives

| Class | RPO (data loss) | RTO (time to restore) |
|---|---|---|
| Clinical and financial data | **≤ 5 minutes** | ≤ 4 hours |
| Evidence media | ≤ 1 hour | ≤ 24 hours |
| Application service | n/a | ≤ 1 hour |
| Full-site disaster | ≤ 1 hour | ≤ 24 hours |

The 5-minute RPO is achieved by continuous WAL archiving, not by nightly dumps alone.

---

## 2. Layers

```
1  CONTINUOUS WAL ARCHIVING     → object storage, every 60 s or 16 MB
   point-in-time recovery to any moment within the retention window

2  NIGHTLY LOGICAL BACKUP       → pg_dump -Fc, encrypted, 02:00 WAT
   fast selective restore; guards against logical corruption, not just hardware loss

3  WEEKLY BASE BACKUP           → pg_basebackup, encrypted
   the anchor for PITR replay

4  OBJECT STORAGE               → bucket versioning + cross-region replication
   evidence and documents; versioning defeats ransomware overwrite

5  CONFIGURATION & SECRETS      → infrastructure-as-code in git; secrets in the secret
                                   manager with its own backup
6  OFF-SITE COPY                → weekly encrypted copy to a separate provider/region
   survives the loss of the primary provider account
```

Retention: WAL 30 days · nightly 30 days · weekly 12 weeks · monthly 24 months · annual 7 years.

---

## 3. Encryption and key separation

Backups are encrypted with age/AES-256 **before** leaving the host. The encryption keys live in the
secret manager, **not** alongside the backups, and the backup storage credentials are write-and-list
only — they cannot delete or read existing objects.

The consequence is deliberate: an attacker who compromises the application host can neither read
historical backups nor destroy them.

---

## 4. Verification — the part most systems skip

A backup that has never been restored is a hypothesis.

**Nightly (automated).** Restore the latest dump into a throwaway container and assert:
schema matches the expected migration version; row counts for ten key tables are within tolerance of
production; the journal balances (`Σ debits = Σ credits`); every stock batch balance equals its
ledger sum; the audit hash chain verifies; a sample patient record resolves end to end.

**Monthly (automated).** Full PITR drill: restore a base backup, replay WAL to a random timestamp,
verify consistency, record the elapsed time.

**Quarterly (human).** A documented restore exercise performed by a person following
`docs/runbooks/disaster-recovery.md`, timed, with any friction in the runbook corrected afterwards.

Results are written to `backup_verification` and surfaced in the admin UI per spec §86:

```
Last successful backup            13 Sep 2026 02:04 WAT   (4 h ago)   ✓ verified
Last verified restore             13 Sep 2026 02:41 WAT               ✓ 11 min
Last full PITR drill              01 Sep 2026                         ✓ 38 min
WAL archiving                     current — last segment 47 s ago     ✓
Off-site copy                     08 Sep 2026                         ✓
Oldest recoverable point          14 Aug 2026 02:00 WAT
```

**If a backup has not verified in 48 hours, this becomes a `CRITICAL` alert** — visible to the
facility manager, not only to an engineer.

---

## 5. Recovery scenarios

| Scenario | Procedure | Target |
|---|---|---|
| Accidental deletion of a record | Not a restore — records are soft-deleted or append-only; recover in-app | minutes |
| Bad migration | Roll forward with a corrective migration; PITR to just before if unavoidable | ≤ 2 h |
| Table corruption | PITR to the last good point; replay the gap from sync queues and audit log | ≤ 4 h |
| Host loss | Provision from IaC, restore base + WAL, re-point DNS | ≤ 4 h |
| Ransomware | Rebuild clean host; restore from versioned, immutable off-site copy | ≤ 24 h |
| Provider loss | Restore from the off-site copy at a second provider | ≤ 24 h |
| Object storage loss | Restore from the replicated bucket; documents regenerate from data | ≤ 24 h |

**A property worth stating:** because documents are renderings of queries (see
`16-document-generation.md`), losing generated PDFs is recoverable — they can be regenerated. Losing
the database is not. Recovery priority is ordered accordingly.

---

## 6. Field-device resilience

Devices hold unsynced field data, so they are part of the backup story.

- The sync dashboard flags any device with unsynced records older than 48 hours.
- The app prompts to sync whenever connectivity returns and the queue is non-empty.
- **Manual export**: a user can export the encrypted outbox to a file, to be recovered on another
  device — the escape hatch for a failing phone.
- A device silent for 7 days raises an alert: usually a lost phone or a departed staff member, and
  in either case someone should act.

---

## 7. Business continuity

Technology fails; care continues.

- **Downtime forms.** Printable triage, consultation, dispensing and receipt forms are generated by
  the system and kept at the facility, with a documented back-entry procedure that marks records as
  `entered_retrospectively` with the true clinical time preserved.
- **Read-only mode.** If writes must be suspended, the app degrades to read-only rather than going
  dark, so clinicians can still see histories.
- **Offline capability is itself continuity.** A server outage does not stop field assessment,
  triage, consultation, or prescribing.

---

## 8. Runbooks

Living documents in `docs/runbooks/`, each with prerequisites, exact commands, verification steps,
and a rollback path:

`disaster-recovery.md` · `restore-pitr.md` · `restore-logical.md` · `failover.md` ·
`ransomware-response.md` · `data-breach-response.md` · `device-loss.md` ·
`downtime-procedure.md` · `partitioning.md`

Each is validated in the quarterly exercise. A runbook that has not been executed by a human is
treated as untested, and marked as such at the top of the file.
