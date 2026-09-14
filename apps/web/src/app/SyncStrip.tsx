import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { currentStatus, onSyncStatus, sync, type SyncStatus } from '@/lib/offline/sync';

/**
 * The persistent sync status strip (doc 09 §7).
 *
 * Never hidden, never collapsed. Someone capturing data in a village must be
 * able to tell at a glance whether their work has reached the server, and how
 * long it has been waiting. Hiding this is how a phone ends up carrying two
 * weeks of unsynced fieldwork that nobody knew about.
 */
export function SyncStrip(): JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void currentStatus().then(setStatus);
    return onSyncStatus(setStatus);
  }, []);

  if (!status) return <div className="sync-strip" aria-hidden="true" />;

  const stale = status.staleHours !== null && status.staleHours > 48;
  const state = stale ? 'stale' : status.state;

  return (
    <div className="sync-strip" data-state={state} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span className="grow">{describe(status, stale)}</span>

      {status.conflicts > 0 && (
        <a href="/conflicts" className="strong">
          {status.conflicts} to resolve
        </a>
      )}

      {status.online && status.pending > 0 && status.state !== 'syncing' && (
        <button type="button" className="btn btn-quiet small" onClick={() => void sync()}>
          Sync now
        </button>
      )}
    </div>
  );
}

function describe(status: SyncStatus, stale: boolean): string {
  const waiting = status.pending + status.sending;

  if (!status.online) {
    if (waiting === 0) return 'Offline — everything is saved';
    return `Offline — ${waiting} record${waiting === 1 ? '' : 's'} waiting${
      stale ? `, oldest ${formatAge(status.staleHours)}` : ''
    }`;
  }

  if (status.state === 'syncing') return 'Syncing…';

  if (stale) {
    // The most important message this strip ever shows.
    return `${waiting} record${waiting === 1 ? '' : 's'} have been waiting ${formatAge(status.staleHours)} — sync soon`;
  }

  // Failures come FIRST. A photograph that failed to upload was previously
  // invisible behind the pending count, which meant evidence could silently
  // never arrive — and a baseline referencing it could never be sealed.
  if (status.mediaFailed > 0) {
    return `${status.mediaFailed} photo${status.mediaFailed === 1 ? '' : 's'} failed to upload — retrying`;
  }
  if (status.rejected > 0) return `${status.rejected} record${status.rejected === 1 ? '' : 's'} were rejected`;
  if (waiting > 0) return `${waiting} record${waiting === 1 ? '' : 's'} waiting to sync`;
  if (status.mediaPending > 0) return `Uploading ${status.mediaPending} photo${status.mediaPending === 1 ? '' : 's'}…`;

  return status.lastSyncAt ? `Synced ${formatRelative(status.lastSyncAt)}` : 'Online';
}

function formatAge(hours: number | null): string {
  if (hours === null) return '';
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function formatRelative(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}
