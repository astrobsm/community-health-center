# 10 — Synchronisation Architecture

The governing rule from the specification: **never silently overwrite a conflict.** Every
synchronisation decision in this design follows from that sentence.

---

## 1. Record identity and versioning

Every synchronisable record carries:

| Field | Purpose |
|---|---|
| `id` (UUID) | Generated on the device; the permanent identity |
| `created_at` / `updated_at` | UTC; server-stamped on arrival, device value kept as `device_created_at` |
| `device_id` | Which device produced it |
| `user_id` | Who produced it |
| `version` | Integer, incremented by database trigger on every server-side write |
| `sync_status` | `LOCAL_ONLY \| PENDING \| SYNCED \| CONFLICT` (device-side) |
| `server_received_at` | Authoritative arrival time |

`version` is the concurrency token. A device sends the `baseVersion` it edited against; if the
server's current version differs, that is a conflict — detected deterministically, with no reliance
on clocks.

---

## 2. Sync cycle

```
        ┌─────────────── PULL ───────────────┐
        │ GET /sync/pull?since=<cursor>       │
        │   &scopes=assessment,patient,...    │
        │ → changed rows since cursor         │
        │ → new cursor (opaque, monotonic)    │
        │ → reference-data versions           │
        └──────────────┬──────────────────────┘
                       ▼
        ┌─────────────── MERGE ──────────────┐
        │ apply server rows to local store    │
        │ if a local PENDING edit exists      │
        │   on the same record → CONFLICT     │
        └──────────────┬──────────────────────┘
                       ▼
        ┌─────────────── PUSH ───────────────┐
        │ topological sort by dependsOn       │
        │ batch ≤ 50 records                  │
        │ POST /sync/push with Idempotency    │
        │ per-record outcome returned         │
        └──────────────┬──────────────────────┘
                       ▼
        ┌────────────── SETTLE ──────────────┐
        │ applied  → mark SYNCED, store version│
        │ conflict → move to conflict store    │
        │ rejected → surface with the reason   │
        │ media upload queue continues async   │
        └─────────────────────────────────────┘
```

**Pull before push.** Pulling first means many would-be conflicts are detected on the device, where
the user who made the edit is present to resolve them, rather than on the server.

**Cursor, not timestamp.** The pull cursor is derived from a monotonic server sequence, not
`updated_at`. Timestamp-based cursors lose records committed out of order under concurrency —
a silent data-loss bug that is very hard to detect later.

---

## 3. Push semantics

```http
POST /api/v1/sync/push
{
  "deviceId": "dev_...",
  "batch": [
    { "entity": "encounter", "op": "create", "id": "...", "baseVersion": null, "payload": {...} },
    { "entity": "clinical_note", "op": "create", "id": "...", "dependsOn": ["..."], "payload": {...} }
  ]
}
```

Response — **one outcome per record**:

```json
{
  "results": [
    { "id": "...", "status": "applied",  "version": 1 },
    { "id": "...", "status": "conflict", "conflictId": "...", "serverVersion": 3,
      "reason": "CONCURRENT_EDIT", "serverValue": { ... } },
    { "id": "...", "status": "rejected", "reason": "INSUFFICIENT_STOCK",
      "detail": "Batch AMX-2411 exhausted" }
  ],
  "cursor": "..."
}
```

Each record is applied in **its own transaction**. One bad record never blocks the other
forty-nine — a batch-level failure would strand a whole day's field work behind one invalid row.

Idempotency is by `id` + `idempotencyKey`. A record already applied returns `applied` with the
existing version. Re-sending after a dropped connection is therefore always safe.

---

## 4. Conflict detection

A conflict exists when the device's `baseVersion` is not the server's current version, or when a
business invariant makes the write impossible.

| Conflict type | Example |
|---|---|
| `CONCURRENT_EDIT` | Two clinicians amended the same note on two devices |
| `STALE_UPDATE` | The device edited a record superseded on the server |
| `DELETED_REMOTELY` | Edit to a record voided on the server |
| `BUSINESS_RULE` | Dispensing exceeds real stock; posting into a closed period |
| `SEALED_ENTITY` | Edit to a sealed baseline or an executed contract |
| `DUPLICATE_CANDIDATE` | A registered patient closely matches an existing record |

---

## 5. Conflict resolution policy — per entity, never global

There is no system-wide "last write wins". Policy is declared per entity and is part of the code
that the tests assert.

| Entity | Policy | Justification |
|---|---|---|
| `attendance` | **Append both** | Clock events are facts; two events are two events |
| `assessment_response` | **Manual** — assessor chooses | Field observation is judgement, not data |
| `evidence` / `photograph` | **Append both** | Never discard evidence |
| `clinical_note` | **Append as amendment** | Both clinicians wrote something true; nothing is deleted |
| `diagnosis` | **Append as amendment** | Same |
| `triage` | **Append both, latest is current** | Vitals legitimately repeat |
| `patient` demographics | **Manual** with a field-level merge UI | Names and DOBs need a human |
| `dispensing` | **Server authoritative**, device notified | Stock truth lives on the server |
| `payment` | **Server authoritative**, device notified | Money is never merged automatically |
| `stock_transaction` | **Reject and escalate** | Requires approval; never auto-resolved |
| `baseline_metric` | **Reject** | Sealed and immutable by definition |
| `contract_version` | **Reject** | Legal documents do not merge |

**Nothing is ever discarded.** Even a rejected record is retained in `sync_event` with its full
payload, so a supervisor can see precisely what the device attempted and why it failed.

---

## 6. The conflict inbox

Conflicts surface as work, not as an error toast. The application shows a conflict inbox with, for
each item: what was captured on the device, what the server holds, who made each version and when,
and the specific options available for that entity.

```
CONFLICT · Clinical note · Patient MRN IKM-0004182
  Your version   (Dr A. Okeke, device Pixel-7, 12 Mar 09:14 offline)
  Server version (Dr N. Eze,  web,             12 Mar 09:31)

  [ Keep both as amendments (recommended) ]
  [ Keep mine and amend ]  [ Keep server and discard mine ]  [ Open side-by-side ]

  Whatever you choose, both versions are retained in the record history.
```

Resolution requires a reason for anything other than the recommended action, writes an audit row,
and never removes data.

---

## 7. Media synchronisation

Evidence media syncs on a separate channel from metadata:

1. Metadata record syncs first; the assessment is immediately complete and reportable.
2. Client requests a pre-signed upload URL per object.
3. Upload direct to object storage — never through the API — with resumable multipart for anything
   over 5 MB.
4. Client confirms with the content hash; the server verifies size and hash and marks the evidence
   `mediaStatus: 'AVAILABLE'`.
5. Smallest-first ordering, so a user on a weak link sees steady progress.
6. Local blobs are retained until confirmation, then deleted to reclaim quota.

A report generated while media is still uploading renders the evidence slot with
"image pending upload" rather than a broken reference.

---

## 8. Observability

`sync_event` records every batch: device, user, counts applied/conflicted/rejected, duration, bytes,
and network conditions reported by the client. From it the admin dashboard shows, per spec §86:

- last successful synchronisation per device;
- outstanding queue depth per device;
- conflict rate by entity — a rising rate is a workflow problem, not a technical one;
- devices silent for more than 7 days, which usually means a lost phone or a staff member who left.

---

## 9. Testing

| Test | Asserts |
|---|---|
| `sync-idempotency.spec.ts` | Re-sending a batch creates nothing new |
| `sync-ordering.spec.ts` | `dependsOn` respected; a note never precedes its encounter |
| `sync-conflict-matrix.spec.ts` | Every entity resolves per its declared policy |
| `sync-partial-failure.spec.ts` | One invalid record does not block the batch |
| `sync-cursor.spec.ts` | No record is missed under concurrent commits |
| `offline-dispense.spec.ts` | Provisional dispensing never yields negative stock |
| `offline-sync.e2e.ts` | Playwright: go offline, capture a full assessment, reconnect, verify |
| `clock-skew.spec.ts` | A device clock two years wrong still orders and syncs correctly |
