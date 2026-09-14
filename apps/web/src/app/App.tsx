import { lazy, Suspense, useEffect } from 'react';
import type { JSX } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';

import { useAuth } from '@/lib/auth/auth-store';
import { startAutoSync } from '@/lib/offline/sync';
import { requestPersistence } from '@/lib/offline/db';

import { SyncStrip } from './SyncStrip';

/**
 * Route-level code splitting is mandatory (doc 05 §5).
 *
 * A CHEW on a 3G link must never download the finance or analytics bundles to
 * fill in an assessment.
 */
const LoginPage = lazy(() =>
  import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const UnlockPage = lazy(() =>
  import('@/features/auth/UnlockPage').then((m) => ({ default: m.UnlockPage })),
);
const FacilityListPage = lazy(() =>
  import('@/features/facility/FacilityListPage').then((m) => ({ default: m.FacilityListPage })),
);
const AssessmentPage = lazy(() =>
  import('@/features/assessment/AssessmentPage').then((m) => ({ default: m.AssessmentPage })),
);
const StartAssessmentPage = lazy(() =>
  import('@/features/assessment/StartAssessmentPage').then((m) => ({ default: m.StartAssessmentPage })),
);

export function App(): JSX.Element {
  const { user, locked, initialising, initialise, signOut, offlineSession, offlineGraceRemaining } =
    useAuth();

  useEffect(() => {
    void initialise();
    // Ask the browser not to evict our data. On iOS this is the main defence
    // against losing a day of unsynced fieldwork (ADR 0004).
    void requestPersistence();
    return startAutoSync();
  }, [initialise]);

  if (initialising) {
    return (
      <div className="page">
        <p className="muted">Starting…</p>
      </div>
    );
  }

  if (!user) {
    // A device that has been used before asks only for the password. Requiring
    // a full sign-in after every reload would be unusable in the field, and
    // impossible offline.
    return (
      <Suspense fallback={<div className="page"><p className="muted">Loading…</p></div>}>
        <Routes>
          <Route path="*" element={locked ? <UnlockPage /> : <LoginPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <header className="appbar">
        <Link to="/" className="strong" style={{ textDecoration: 'none' }}>
          Community Health Centre
        </Link>
        <button type="button" className="btn btn-quiet" style={{ color: 'inherit' }} onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <SyncStrip />

      {offlineSession && (
        <div className="notice notice-warn" style={{ borderRadius: 0 }}>
          Working offline from this device.
          {offlineGraceRemaining !== null &&
            ` You can continue for ${offlineGraceRemaining} more day${offlineGraceRemaining === 1 ? '' : 's'} before signing in online again.`}
        </div>
      )}

      <main>
        <Suspense fallback={<div className="page"><p className="muted">Loading…</p></div>}>
          <Routes>
            <Route path="/" element={<FacilityListPage />} />
            <Route path="/facilities/:facilityId/assess" element={<StartAssessmentPage />} />
            <Route path="/assessments/:id" element={<AssessmentPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}
