import Dexie, { type Table } from 'dexie';

import { open, seal, type Sealed, type WrappedKey } from './crypto';

/**
 * The offline store (doc 09 §2).
 *
 * Two classes of table, deliberately separated:
 *
 *   ENCRYPTED  anything identifying or clinical. Stored as ciphertext, opaque
 *              until the user unlocks the store with their password.
 *
 *   PLAINTEXT  sync status, counts, timestamps, form definitions, device
 *              metadata. Queryable while locked, so the app can say "14 records
 *              pending" without revealing anything about whom.
 */

export type OutboxStatus = 'PENDING' | 'SENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';

/**
 * An offline write, waiting to be sent.
 *
 * The payload is ENCRYPTED; everything the sync engine needs to schedule and
 * order the send is plaintext.
 */
export interface OutboxEntry {
  /** UUID, generated on the device. Also the server-side entity id. */
  id: string;
  /** Equals `id` for creates, so a retry is provably the same record. */
  idempotencyKey: string;
  entity: string;
  op: 'create' | 'update';
  /** HTTP path, relative to the API root. */
  path: string;
  method: 'POST' | 'PATCH';
  payload: Sealed;
  /**
   * Ordering dependencies. The outbox is a dependency GRAPH, not a queue: a
   * response cannot be applied before the assessment it belongs to.
   */
  dependsOn: string[];
  /**
   * Device-local, strictly increasing. Field device clocks are routinely wrong
   * — sometimes by years after a battery change — so ordering never relies on
   * `createdAt`.
   */
  monotonicSeq: number;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: number;
}

/** Evidence bytes, held until the upload is confirmed. */
export interface PendingMedia {
  evidenceId: string;
  facilityId: string;
  blob: Blob;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
  status: 'PENDING_UPLOAD' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  attempts: number;
  lastError?: string;
  createdAt: string;
}

/** Cached server data. Always carries its age so it can never read as current. */
export interface CachedDocument {
  key: string;
  scope: string;
  payload: Sealed;
  /** When the server computed this. Rendered beside every cached figure. */
  fetchedAt: string;
}

export interface DeviceMeta {
  key: string;
  value: unknown;
}

export interface LocalConflict {
  id: string;
  entity: string;
  entityId: string;
  reason: string;
  localPayload: Sealed;
  serverPayload?: Sealed;
  detectedAt: string;
  resolved: boolean;
}

class OfflineDatabase extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  media!: Table<PendingMedia, string>;
  cache!: Table<CachedDocument, string>;
  meta!: Table<DeviceMeta, string>;
  conflicts!: Table<LocalConflict, string>;

  constructor() {
    super('chc-offline');

    this.version(1).stores({
      outbox: 'id, status, monotonicSeq, entity, nextAttemptAt',
      media: 'evidenceId, status, facilityId',
      cache: 'key, scope, fetchedAt',
      meta: 'key',
      conflicts: 'id, entity, resolved',
    });
  }
}

export const db = new OfflineDatabase();

// -----------------------------------------------------------------------------
// Device metadata — plaintext, readable while locked
// -----------------------------------------------------------------------------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/**
 * A stable per-installation identifier.
 *
 * Used to bind refresh tokens and to attribute offline records. Generated once
 * and kept; it identifies the installation, not the person.
 */
export async function deviceId(): Promise<string> {
  const existing = await getMeta<string>('deviceId');
  if (existing) return existing;

  const generated = globalThis.crypto.randomUUID();
  await setMeta('deviceId', generated);
  return generated;
}

/**
 * Monotonic sequence for outbox ordering.
 *
 * Strictly increasing and independent of the clock, so a device whose time
 * jumps backwards still produces correctly ordered writes.
 */
export async function nextSequence(): Promise<number> {
  const current = (await getMeta<number>('monotonicSeq')) ?? 0;
  const next = current + 1;
  await setMeta('monotonicSeq', next);
  return next;
}

export async function getWrappedKey(): Promise<WrappedKey | undefined> {
  const stored = await getMeta<{ salt: number[]; iv: number[]; wrapped: number[] }>('wrappedKey');
  if (!stored) return undefined;

  return {
    salt: new Uint8Array(stored.salt),
    iv: new Uint8Array(stored.iv),
    wrapped: new Uint8Array(stored.wrapped).buffer,
  };
}

export async function storeWrappedKey(key: WrappedKey): Promise<void> {
  await setMeta('wrappedKey', {
    salt: [...key.salt],
    iv: [...key.iv],
    wrapped: [...new Uint8Array(key.wrapped)],
  });
}

// -----------------------------------------------------------------------------
// Cache — every read reports its age
// -----------------------------------------------------------------------------

export async function putCached(key: string, scope: string, value: unknown): Promise<void> {
  await db.cache.put({ key, scope, payload: await seal(value), fetchedAt: new Date().toISOString() });
}

/**
 * Read a cached document along with WHEN it was fetched.
 *
 * The timestamp is returned, not optional, because a cached figure rendered
 * without its age is indistinguishable from a live one — and that is how a
 * stale stock count gets acted on.
 */
export async function getCached<T>(key: string): Promise<{ value: T; fetchedAt: string } | undefined> {
  const row = await db.cache.get(key);
  if (!row) return undefined;

  try {
    return { value: await open<T>(row.payload), fetchedAt: row.fetchedAt };
  } catch {
    // Locked, or written under a previous key. Treat as a miss rather than
    // surfacing a decryption error to a clinician.
    return undefined;
  }
}

export async function clearScope(scope: string): Promise<void> {
  await db.cache.where('scope').equals(scope).delete();
}

// -----------------------------------------------------------------------------
// Storage pressure (doc 09 §5)
// -----------------------------------------------------------------------------

export interface StoragePressure {
  usageBytes: number;
  quotaBytes: number;
  ratio: number;
  /** Warn the user; capture still permitted. */
  warn: boolean;
  /** Refuse new capture. Better than failing silently and losing a day's work. */
  blockCapture: boolean;
}

export async function storagePressure(): Promise<StoragePressure | null> {
  if (!navigator.storage?.estimate) return null;

  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const ratio = quota > 0 ? usage / quota : 0;

  return {
    usageBytes: usage,
    quotaBytes: quota,
    ratio,
    warn: ratio >= 0.8,
    blockCapture: ratio >= 0.95,
  };
}

/**
 * Ask the browser not to evict this origin's data.
 *
 * iOS in particular will clear IndexedDB under pressure, which would discard a
 * day of unsynced fieldwork. Requesting persistence is not a guarantee — it is
 * the strongest thing a web app can do, and the residual risk is the main one
 * documented in ADR 0004.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

/**
 * Export unsynced work as a file.
 *
 * The escape hatch for a failing device (doc 19 §6): the payloads stay
 * encrypted, so the export is only useful to someone who knows the password.
 */
export async function exportOutbox(): Promise<Blob> {
  const entries = await db.outbox.where('status').notEqual('SYNCED').toArray();
  const media = await db.media.where('status').notEqual('UPLOADED').count();

  const manifest = {
    exportedAt: new Date().toISOString(),
    deviceId: await deviceId(),
    pendingRecords: entries.length,
    pendingMedia: media,
    note: 'Payloads remain encrypted with this device key. Recovering them requires the account password.',
    entries: entries.map((entry) => ({
      ...entry,
      payload: {
        iv: [...entry.payload.iv],
        data: [...new Uint8Array(entry.payload.data)],
      },
    })),
  };

  return new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
}
