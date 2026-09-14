import { seal } from './crypto';
import { db, nextSequence, deviceId, type OutboxEntry } from './db';
import { orderForSend } from './ordering';

/**
 * The outbox (doc 09 §3).
 *
 * Every offline write lands here first, whether or not the device is online.
 * That is deliberate: a single code path means the online and offline
 * behaviours cannot drift apart, and "it worked at the desk but not in the
 * field" stops being possible.
 */

export interface EnqueueInput {
  /** Client-generated UUID. The record has its identity before it is ever sent. */
  id: string;
  entity: string;
  op: 'create' | 'update';
  path: string;
  method?: 'POST' | 'PATCH';
  payload: unknown;
  /** Entries that must be applied first — e.g. an assessment before its answers. */
  dependsOn?: string[];
}

/**
 * Broadcast that the outbox changed.
 *
 * An event rather than a direct call into the sync module: that would be a
 * cycle, and more importantly it would mean every future feature that enqueues
 * has to remember to announce it. Forgetting would leave the status strip
 * claiming everything is saved while work piles up — the exact failure the
 * strip exists to prevent.
 */
export const OUTBOX_CHANGED = 'chc:outbox-changed';

function announce(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED));
  }
}

export async function enqueue(input: EnqueueInput): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: input.id,
    idempotencyKey: input.id,
    entity: input.entity,
    op: input.op,
    path: input.path,
    method: input.method ?? 'POST',
    payload: await seal(input.payload),
    dependsOn: input.dependsOn ?? [],
    monotonicSeq: await nextSequence(),
    createdAt: new Date().toISOString(),
    status: 'PENDING',
    attempts: 0,
  };

  await db.outbox.put(entry);
  announce();
  return entry;
}

export interface OutboxSummary {
  pending: number;
  sending: number;
  conflicts: number;
  rejected: number;
  oldestPendingAt: string | null;
  /** Unsynced work older than this is worth warning about (doc 10 §8). */
  staleHours: number | null;
}

/** Plaintext counts, readable while the store is locked. */
export async function summarise(): Promise<OutboxSummary> {
  const entries = await db.outbox.toArray();

  const pending = entries.filter((e) => e.status === 'PENDING');
  const oldest = pending.reduce<string | null>(
    (min, e) => (min === null || e.createdAt < min ? e.createdAt : min),
    null,
  );

  return {
    pending: pending.length,
    sending: entries.filter((e) => e.status === 'SENDING').length,
    conflicts: entries.filter((e) => e.status === 'CONFLICT').length,
    rejected: entries.filter((e) => e.status === 'REJECTED').length,
    oldestPendingAt: oldest,
    staleHours: oldest ? (Date.now() - new Date(oldest).getTime()) / 3_600_000 : null,
  };
}

/**
 * Entries ready to send, in dependency order.
 *
 * The scheduling rule is in `ordering.ts`; this function only supplies it with
 * what is in the database.
 */
export async function readyToSend(limit = 50): Promise<OutboxEntry[]> {
  const now = Date.now();

  const candidates = (await db.outbox.where('status').equals('PENDING').toArray()).filter(
    (entry) => !entry.nextAttemptAt || entry.nextAttemptAt <= now,
  );

  const synced = new Set(
    (await db.outbox.where('status').equals('SYNCED').primaryKeys()) as string[],
  );

  // The ordering rule itself lives in ordering.ts, pure and exhaustively
  // tested — including the cases that are hard to reach through IndexedDB,
  // like a dependency cycle or a parent cut off by the batch limit.
  return orderForSend({ candidates, synced, limit });
}

/** Exponential backoff with a ceiling, so a device offline for a week is not hammering. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 5 * 60_000);
}

export async function markSending(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'SENDING' });
}

export async function markSynced(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'SYNCED', lastError: undefined });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const entry = await db.outbox.get(id);
  if (!entry) return;

  const attempts = entry.attempts + 1;
  await db.outbox.update(id, {
    status: 'PENDING',
    attempts,
    lastError: error,
    nextAttemptAt: Date.now() + backoffMs(attempts),
  });
}

/**
 * A conflict, or a rejection the server considers permanent.
 *
 * Neither deletes anything. Even a rejected record keeps its full payload, so a
 * supervisor can see exactly what the device attempted and why it failed
 * (doc 10 §5).
 */
export async function markConflict(id: string, reason: string): Promise<void> {
  const entry = await db.outbox.get(id);
  if (!entry) return;

  await db.outbox.update(id, { status: 'CONFLICT', lastError: reason });
  await db.conflicts.put({
    id: `${id}:${Date.now()}`,
    entity: entry.entity,
    entityId: entry.id,
    reason,
    localPayload: entry.payload,
    detectedAt: new Date().toISOString(),
    resolved: false,
  });
}

export async function markRejected(id: string, reason: string): Promise<void> {
  await db.outbox.update(id, { status: 'REJECTED', lastError: reason });
}

/**
 * Discard entries that synced long ago.
 *
 * Only SYNCED entries are ever removed, and only after a week — long enough
 * that a support question about "what did this device send?" is still
 * answerable.
 */
export async function pruneSynced(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const stale = await db.outbox.where('status').equals('SYNCED').toArray();
  const removable = stale.filter((entry) => entry.createdAt < cutoff).map((entry) => entry.id);

  await db.outbox.bulkDelete(removable);
  return removable.length;
}

export async function currentDeviceId(): Promise<string> {
  return deviceId();
}
