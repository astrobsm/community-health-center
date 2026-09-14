import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { api } from '@/lib/api-client';
import { getCached, putCached } from '@/lib/offline/db';
import { useAuth } from '@/lib/auth/auth-store';

interface Facility {
  id: string;
  name: string;
  code: string;
  lifecycleStage: string;
  baselineDate: string | null;
  facilityType: { code: string; name: string } | null;
  location: { state: string; lga: string; ward: string | null; town: string | null } | null;
}

const STAGE_LABEL: Record<string, string> = {
  PRE_ASSESSMENT: 'Not yet assessed',
  DUE_DILIGENCE: 'Due diligence',
  FIELD_ASSESSMENT: 'Field assessment',
  BASELINE_ESTABLISHED: 'Baseline established',
  PLANNING: 'Planning',
  PROPOSAL: 'Proposal',
  GOVERNMENT_REVIEW: 'Government review',
  AGREEMENT: 'Agreement',
  IMPLEMENTATION: 'Implementation',
  COMMISSIONING: 'Commissioning',
  LIVE_OPERATIONS: 'Live operations',
  CONTINUOUS_IMPROVEMENT: 'Continuous improvement',
  SUSPENDED: 'Suspended',
  EXITED: 'Exited',
};

export function FacilityListPage(): JSX.Element {
  const { user, can } = useAuth();
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const cached = await getCached<Facility[]>('facilities');
      if (cached) {
        setFacilities(cached.value);
        setCachedAt(cached.fetchedAt);
      }

      try {
        const fresh = await api.get<Facility[]>('/facilities');
        await putCached('facilities', 'facilities', fresh);
        setFacilities(fresh);
        setCachedAt(new Date().toISOString());
      } catch {
        // Offline: the cached list, clearly labelled with its age, is correct
        // behaviour — not an error state.
      }
    };

    void load();
  }, []);

  return (
    <div className="page stack">
      <header>
        <h1>Facilities</h1>
        {user && <p className="muted small">Signed in as {user.fullName}</p>}
      </header>

      {cachedAt && (
        <p className="tiny muted">
          {/* Every cached figure carries its age. A list rendered without one is
              indistinguishable from a live one. */}
          As of {new Date(cachedAt).toLocaleString()}
        </p>
      )}

      {facilities === null && <p className="muted">Loading…</p>}

      {facilities?.length === 0 && (
        <div className="notice notice-info">
          You do not have access to any facility yet. An administrator can grant it.
        </div>
      )}

      <div className="stack">
        {facilities?.map((facility) => (
          <article key={facility.id} className="card stack" style={{ '--gap': 'var(--s2)' } as React.CSSProperties}>
            <div className="row-between wrap">
              <div className="grow">
                <h2>{facility.name}</h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {facility.code}
                  {facility.location && ` · ${facility.location.lga}, ${facility.location.state}`}
                  {facility.facilityType && ` · ${facility.facilityType.name}`}
                </p>
              </div>
              <span className="badge badge-verified">{STAGE_LABEL[facility.lifecycleStage] ?? facility.lifecycleStage}</span>
            </div>

            <p className="small muted" style={{ margin: 0 }}>
              {facility.baselineDate
                ? `Baseline sealed ${facility.baselineDate} — comparisons run from this date`
                : 'No baseline yet. Complete a field assessment to establish Day 0.'}
            </p>

            <div className="row wrap">
              {can('assessment.write') && (
                <Link className="btn btn-primary" to={`/facilities/${facility.id}/assess`}>
                  Start assessment
                </Link>
              )}
              {can('baseline.read') && facility.baselineDate && (
                <Link className="btn" to={`/facilities/${facility.id}/baseline`}>
                  View baseline
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
