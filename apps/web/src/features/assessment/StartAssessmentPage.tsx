import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';

import { api } from '@/lib/api-client';
import { getCached, putCached } from '@/lib/offline/db';

/**
 * Start (or resume) a field assessment for a facility.
 *
 * Resumes rather than duplicates: opening this screen twice for the same
 * facility must not produce two half-finished assessments, which is exactly
 * what happens when an assessor taps back and forward on a slow connection.
 *
 * Creating an assessment requires a connection. That is a deliberate boundary:
 * an assessment is pinned to a specific published template VERSION, and a
 * device cannot invent that pinning offline without risking answers that
 * cannot be interpreted later.
 */
export function StartAssessmentPage(): JSX.Element {
  const { facilityId = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // React 18+ runs effects twice in development. Without this guard that
    // would create two assessments on every visit.
    if (started.current) return;
    started.current = true;

    const run = async (): Promise<void> => {
      const cacheKey = `assessment-for:${facilityId}`;

      // An assessment already opened on this device, still in progress.
      const existing = await getCached<{ id: string; status: string }>(cacheKey);
      if (existing && existing.value.status !== 'SEALED') {
        void navigate(`/assessments/${existing.value.id}`, { replace: true });
        return;
      }

      try {
        const created = await api.post<{ id: string; status: string }>('/assessments', {
          facilityId,
          assessmentType: 'FIELD',
        });

        await putCached(cacheKey, `assessment:${created.id}`, created);
        void navigate(`/assessments/${created.id}`, { replace: true });
      } catch {
        setError(
          'A new assessment cannot be started without a connection, because it has to be pinned to the current version of the form. ' +
            'Start it once while online; after that it works offline.',
        );
      }
    };

    void run();
  }, [facilityId, navigate]);

  if (error) {
    return (
      <div className="page">
        <div className="notice notice-warn">{error}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="muted">Preparing the assessment…</p>
    </div>
  );
}
