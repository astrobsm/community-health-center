# 09 — Offline-First Architecture

Designed for the real condition: an assessor spends a day in Ikem with no usable data connection,
and a nurse continues consulting when the facility link drops mid-morning.

---

## 1. Scope — what works offline

Offline capability is expensive and increases conflict surface, so it is granted deliberately.

| Workflow | Offline | Rationale |
|---|---|---|
| Field assessment (all sections, evidence, photos) | **Full** | The primary field use case |
| Patient registration | **Full** | Cannot turn a patient away |
| Triage / vitals | **Full** | Time-critical, low conflict |
| Clinical consultation and notes | **Full** | Care must not stop |
| Prescription writing | **Full** | Part of consultation |
| Dispensing | **Constrained** | Allowed; stock is provisional and reconciled on sync (§4) |
| Attendance clock-in/out | **Full** | Append-only events, trivially mergeable |
| Lab sample collection | **Partial** | Collection yes; result entry requires connectivity |
| Payment receipt | **Constrained** | Cash only, with an offline receipt number range |
| Inventory adjustments | **No** | Requires approval and live stock truth |
| Finance posting, period close | **No** | Ledger integrity requires the server |
| Procurement approvals | **No** | Approval chains need current authority |
| Contracts, partnership, financial models | **No** | High-value, low-urgency, must not fork |
| Reports and dashboards | **Read-only cached** | Shown with an explicit "as of" timestamp |

The rule: **offline is granted where the alternative is refusing care or losing field data, and
withheld where a fork would corrupt money, stock authority, or a legal document.**

---

## 2. Storage layers on the device

```
┌───────────────────────────────────────────────────────────────┐
│  Service Worker (Workbox)                                     │
│   • Precache: app shell, fonts, icons                         │
│   • Runtime cache: reference data (stale-while-revalidate)     │
│   • Navigation fallback → offline shell                        │
│   • NEVER caches API responses containing patient data          │
├───────────────────────────────────────────────────────────────┤
│  IndexedDB via Dexie                                          │
│   Encrypted stores  (AES-256-GCM, per-record IV)              │
│     patients · encounters · notes · responses · evidenceBlobs │
│     dispensings · payments · attendance                       │
│   Plaintext stores (queryable metadata, no PHI)               │
│     outbox · syncState · formDefinitions · referenceData      │
│     conflicts · deviceMeta                                    │
├───────────────────────────────────────────────────────────────┤
│  In-memory only                                               │
│   dataEncryptionKey · accessToken · resolved permissions      │
└───────────────────────────────────────────────────────────────┘
```

**Encryption.** A 256-bit data-encryption key (DEK) is generated per device. It is wrapped by a
key-encryption key derived from the user's password via PBKDF2-SHA256 (600,000 iterations, unique
salt) and stored wrapped. The unwrapped DEK lives only in a JavaScript variable for the session.
Lock, close, or idle timeout discards it and the local database is once again ciphertext.

Encrypted at rest on the device: names, identifiers, contact details, clinical content, evidence
images, payment references. Left plaintext: sync status, timestamps, entity types, counts — enough
to render "12 records pending" on a locked screen without exposing anything about whom.

---

## 3. The outbox

Every offline write appends an immutable entry:

```ts
interface OutboxEntry {
  id: string;                 // UUID, also the server-side entity id
  idempotencyKey: string;     // equals id for creates
  entity: string;             // 'assessment_response' | 'encounter' | ...
  op: 'create' | 'update' | 'delete';
  payload: unknown;           // validated with the SAME Zod schema the server uses
  baseVersion: number | null; // version the edit was made against
  dependsOn: string[];        // ordering: an encounter before its note
  deviceId: string;
  userId: string;
  createdAt: string;          // device clock
  monotonicSeq: number;       // device-local, immune to clock changes
  attempts: number;
  lastError?: string;
  status: 'PENDING' | 'SENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';
}
```

**Design points that matter in the field:**

- **Client-generated UUIDs.** The record has its final identity before it ever reaches the server,
  so a retry is provably the same record and references between offline records resolve immediately.
- **`dependsOn` ordering.** The outbox is a dependency graph, not a queue. A note cannot be applied
  before its encounter, and a topological sort is applied before sending.
- **`monotonicSeq`.** Device clocks in the field are wrong — sometimes by years after a battery
  change. A monotonic counter gives reliable local ordering; `createdAt` is retained only as a hint
  and the server records `received_at` as the authoritative time.
- **Validation before queueing.** The shared Zod schema rejects a bad record at capture time, when
  the assessor is standing in front of the thing being assessed — not two weeks later at sync.

---

## 4. Constrained offline dispensing

Dispensing offline is permitted because a patient with a prescription should not be sent home. It is
constrained because stock is a shared resource and two devices can dispense the last box.

1. The device holds a **cached stock position** with its `computedAt` timestamp, always visible.
2. It applies FEFO locally and records the chosen batch as a **preference**, not a decision.
3. The dispensing is written locally with `stockStatus: 'PROVISIONAL'` and the UI says so plainly.
4. On sync, the **server re-runs FEFO authoritatively** against real stock:
   - sufficient stock, same batch → applied, `ACTUAL`;
   - sufficient stock, different batch → applied with the server's batch, `ACTUAL`, and the device
     is informed;
   - insufficient stock → **conflict**, never a negative balance. The pharmacist is presented with
     the discrepancy and must resolve it as a wastage, a correction, or a retrospective adjustment.
5. A configurable ceiling (default: 48 hours or 50 provisional dispensings) blocks further offline
   dispensing until sync, bounding how far stock truth can drift.

Offline cash payments use a **pre-allocated receipt number range** issued to the device at sync, so
receipt numbers never collide and gaps are detectable.

---

## 5. Evidence and photographs offline

Photographs dominate field storage. A single assessment can produce 200+ images.

- Captured at up to 1920 px on the long edge, re-encoded to WebP at quality 0.75, typically
  150–400 KB. Originals are discarded — the image is evidence of condition, not forensic material.
- EXIF is stripped except timestamp; GPS is attached only with explicit consent, as a separate
  field.
- Stored as encrypted blobs in IndexedDB with a content hash, so a duplicate upload is detectable.
- Uploaded **separately from the metadata record**, in the background, resumable, smallest first so
  progress is visible. The evidence row syncs immediately with `mediaStatus: 'PENDING_UPLOAD'`;
  the assessment is complete and usable before the images have finished transferring.
- A storage-pressure monitor warns at 80% of the origin quota and refuses new capture at 95%,
  with a clear instruction to sync — rather than failing silently and losing a day's work.

---

## 6. Reference data on the device

Pulled and refreshed on every sync, versioned so the client can detect staleness:

assessment template + items, services and current tariffs, medication catalogue, lab test catalogue
with reference ranges, ICD-10 subset with local synonyms, communities, departments, staff roster
(for attribution), the user's permission snapshot, and the stock position.

Total budget: **under 5 MB**. Anything larger is fetched on demand and cached opportunistically.

---

## 7. What the user always sees

Offline state is never hidden. The application shell carries a persistent status strip:

```
● Online · synced 2 min ago
◐ Offline · 14 records pending · last sync 3 h ago
▲ Offline · 62 records pending · last sync 6 d ago · sync soon
⚠ 3 conflicts need your attention
```

Every cached figure is rendered with its "as of" time. A stock number that is six hours old says
so. A dashboard viewed offline is explicitly labelled as a snapshot. The product never presents
stale data as current — that is the same non-fabrication principle applied to time.

---

## 8. Failure modes considered

| Failure | Handling |
|---|---|
| Storage quota exhausted | Warn at 80%, block capture at 95%, prioritise sync of oldest records |
| Device clock badly wrong | `monotonicSeq` for ordering; server stamps authoritative time |
| App updated mid-queue | Outbox schema is versioned; migrations run before any send |
| User forgets password offline | Local data is unrecoverable by design; synced data is safe — stated up front |
| Device lost or stolen | Encrypted at rest; offline grace expires in 7 days; server-side revocation on next contact |
| Two devices, same user | Both sync independently; conflicts detected by `version`, never last-write-wins |
| Sync interrupted mid-batch | Per-record transactions plus idempotency keys make resumption safe |
| Corrupt local database | Detected on open; unsynced entries exported to a downloadable file before reset |
