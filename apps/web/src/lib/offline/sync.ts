import { ApiError, OfflineError, api } from '../api-client';

import { open } from './crypto';
import { db, type PendingMedia } from './db';
import {
  OUTBOX_CHANGED,
  markConflict,
  markFailed,
  markRejected,
  markSending,
  markSynced,
  pruneSynced,
  readyToSend,
  summarise,
  type OutboxSummary,
} from './outbox';

/**
 * The sync engine (doc 10).
 *
 * Governing rule: never silently overwrite, never silently discard. Every
 * record ends in a state a human can see and act on.
 *
 * Media syncs on a SEPARATE pass from metadata, smallest first, so an
 * assessment becomes complete and reportable before its photographs have
 * finished uploading over a weak link.
 */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncReport {
  applied: number;
  conflicted: number;
  rejected: number;
  failed: number;
  mediaUploaded: number;
  mediaFailed: number;
  finishedAt: string;
}

export interface SyncStatus extends OutboxSummary {
  state: SyncState;
  online: boolean;
  lastSyncAt: string | null;
  lastReport: SyncReport | null;
  mediaPending: number;
  /** Uploads that failed and are awaiting retry. Never hidden. */
  mediaFailed: number;
}

type StatusListener = (status: SyncStatus) => void;

let state: SyncState = 'idle';
let lastSyncAt: string | null = null;
let lastReport: SyncReport | null = null;
let running = false;
const listeners = new Set<StatusListener>();

export function onSyncStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  void publish();
  return () => listeners.delete(listener);
}

async function publish(): Promise<void> {
  const summary = await summarise();
  const mediaPending = await db.media.where('status').notEqual('UPLOADED').count();
  const mediaFailed = await db.media.where('status').equals('FAILED').count();

  const status: SyncStatus = {
    ...summary,
    state,
    online: navigator.onLine,
    lastSyncAt,
    lastReport,
    mediaPending,
    mediaFailed,
  };

  for (const listener of listeners) listener(status);
}

export async function currentStatus(): Promise<SyncStatus> {
  const summary = await summarise();
  return {
    ...summary,
    state,
    online: navigator.onLine,
    lastSyncAt,
    lastReport,
    mediaPending: await db.media.where('status').notEqual('UPLOADED').count(),
    mediaFailed: await db.media.where('status').equals('FAILED').count(),
  };
}

/**
 * Drain the outbox.
 *
 * Records are sent ONE AT A TIME rather than as a single batch. That is a
 * deliberate trade of round trips for isolation: one malformed record cannot
 * strand the other forty-nine, and each outcome is attributable.
 */
export async function sync(): Promise<SyncReport> {
  if (running) return lastReport ?? emptyReport();

  if (!navigator.onLine) {
    state = 'offline';
    await publish();
    return emptyReport();
  }

  running = true;
  state = 'syncing';
  await publish();

  const report = emptyReport();

  try {
    const entries = await readyToSend(50);

    for (const entry of entries) {
      await markSending(entry.id);

      try {
        const payload = await open<unknown>(entry.payload);

        await api.post(entry.path, payload, { idempotencyKey: entry.idempotencyKey });

        await markSynced(entry.id);
        report.applied += 1;
      } catch (error) {
        if (error instanceof OfflineError) {
          // Signal dropped mid-drain. Leave the entry PENDING and stop; the
          // rest will go on the next attempt.
          await markFailed(entry.id, 'Connection lost during sync.');
          state = 'offline';
          break;
        }

        if (error instanceof ApiError) {
          if (error.status === 409) {
            await markConflict(entry.id, error.problem.detail ?? 'Conflict');
            report.conflicted += 1;
            continue;
          }

          // 4xx other than 409 will not succeed on retry: the record itself is
          // unacceptable. Retrying forever would hide it.
          if (error.status >= 400 && error.status < 500) {
            await markRejected(entry.id, error.problem.detail ?? error.problem.title);
            report.rejected += 1;
            continue;
          }
        }

        await markFailed(entry.id, error instanceof Error ? error.message : 'Unknown error');
        report.failed += 1;
      }
    }

    const media = await syncMedia();
    report.mediaUploaded = media.uploaded;
    report.mediaFailed = media.failed;

    await pruneSynced();

    lastSyncAt = new Date().toISOString();
    if (state !== 'offline') state = report.failed > 0 ? 'error' : 'idle';
  } catch {
    state = 'error';
  } finally {
    running = false;
    report.finishedAt = new Date().toISOString();
    lastReport = report;
    await publish();
  }

  return report;
}

/**
 * Upload evidence bytes.
 *
 * Smallest first, so a user on a weak link sees steady progress rather than
 * one large file stalling everything behind it.
 */
async function syncMedia(): Promise<{ uploaded: number; failed: number }> {
  const pending = (await db.media.where('status').anyOf('PENDING_UPLOAD', 'FAILED').toArray()).sort(
    (a, b) => a.sizeBytes - b.sizeBytes,
  );

  let uploaded = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await uploadOne(item);
      uploaded += 1;
    } catch (error) {
      if (error instanceof OfflineError) break;
      await db.media.update(item.evidenceId, {
        status: 'FAILED',
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : 'Upload failed',
      });
      failed += 1;
    }
  }

  return { uploaded, failed };
}

async function uploadOne(item: PendingMedia): Promise<void> {
  await db.media.update(item.evidenceId, { status: 'UPLOADING' });

  // The registration response carries a short-lived pre-signed URL; it may have
  // expired while the device was offline, so it is re-fetched rather than cached.
  const evidence = await api.get<{
    upload?: { uploadUrl: string; headers: Record<string, string> };
  }>(`/evidence/${item.evidenceId}`);

  const intent =
    evidence.upload ??
    (
      await api.post<{ upload?: { uploadUrl: string; headers: Record<string, string> } }>(
        `/evidence/${item.evidenceId}/upload-intent`,
      )
    ).upload;

  if (!intent) {
    // Nothing to upload against — most likely already uploaded on another
    // device. Treat as done rather than retrying forever.
    await db.media.update(item.evidenceId, { status: 'UPLOADED' });
    return;
  }

  const response = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: item.blob,
  });

  if (!response.ok) {
    throw new Error(`Storage rejected the upload (${response.status}).`);
  }

  // The server verifies size and hash before marking the evidence available,
  // so a truncated upload cannot masquerade as a complete one.
  await api.post(`/evidence/${item.evidenceId}/confirm-upload`);
  await db.media.update(item.evidenceId, { status: 'UPLOADED' });
}

function emptyReport(): SyncReport {
  return {
    applied: 0,
    conflicted: 0,
    rejected: 0,
    failed: 0,
    mediaUploaded: 0,
    mediaFailed: 0,
    finishedAt: new Date().toISOString(),
  };
}

let intervalHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Sync on reconnect, on return to the foreground, and periodically.
 *
 * A PWA cannot sync while closed (ADR 0004), so the app is deliberately eager
 * whenever it IS open — and the pending count stays visible so the user knows
 * work is still waiting.
 */
export function startAutoSync(intervalMs = 60_000): () => void {
  const trigger = () => {
    void sync();
  };

  const onOnline = () => {
    state = 'idle';
    trigger();
  };
  const onOffline = () => {
    state = 'offline';
    void publish();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) trigger();
  };

  // A new outbox entry must update the strip immediately, even with no network
  // — otherwise offline work is invisible until the next sync attempt.
  const onOutboxChanged = () => {
    void publish();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener(OUTBOX_CHANGED, onOutboxChanged);
  document.addEventListener('visibilitychange', onVisible);
  intervalHandle = setInterval(trigger, intervalMs);

  if (navigator.onLine) trigger();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener(OUTBOX_CHANGED, onOutboxChanged);
    document.removeEventListener('visibilitychange', onVisible);
    if (intervalHandle) clearInterval(intervalHandle);
  };
}
