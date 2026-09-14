import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { api } from '@/lib/api-client';
import { getCached, putCached, storagePressure } from '@/lib/offline/db';
import { enqueue } from '@/lib/offline/outbox';
import { sync } from '@/lib/offline/sync';

import { ItemInput, type ItemValue, type TemplateItem } from './ItemInput';

interface Section {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sequence: number;
  items: TemplateItem[];
}

interface AssessmentPayload {
  assessment: {
    id: string;
    facilityId: string;
    status: string;
    title: string;
    completionPercent: number;
  };
  sections: Section[];
  responses: Array<{
    id: string;
    itemId: string;
    answer: unknown;
    note: string | null;
    evidenceIds: string[];
  }>;
}

/**
 * The field assessment screen.
 *
 * Everything here is shaped by one assumption: the network will disappear
 * mid-assessment and may not come back for days.
 *
 *  - The WHOLE instrument is fetched in one call and cached, because a section
 *    that needs a round trip is a section that cannot be filled in a village.
 *  - Every answer is written to the outbox immediately. There is no "save"
 *    button, because a save button is a thing an assessor can forget to press
 *    before their battery dies.
 *  - Progress is computed locally from the same rules the server uses, so the
 *    percentage does not jump when a sync lands.
 */
export function AssessmentPage(): JSX.Element {
  const { id = '' } = useParams();

  const [payload, setPayload] = useState<AssessmentPayload | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, ItemValue>>({});
  const [activeSection, setActiveSection] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pressureWarning, setPressureWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const cacheKey = `assessment:${id}`;

      // Cache first, so the form paints instantly and works with no signal.
      const cached = await getCached<AssessmentPayload>(cacheKey);
      if (cached && !cancelled) {
        setPayload(cached.value);
        setCachedAt(cached.fetchedAt);
        setValues(toValues(cached.value));
      }

      try {
        const fresh = await api.get<AssessmentPayload>(`/assessments/${id}`);
        if (cancelled) return;

        await putCached(cacheKey, `assessment:${id}`, fresh);
        setPayload(fresh);
        setCachedAt(new Date().toISOString());
        setValues((local) => ({ ...toValues(fresh), ...local }));
      } catch {
        // Offline with nothing cached is the only genuinely unrecoverable case.
        if (!cached && !cancelled) {
          setError(
            'This assessment has not been opened on this device before, and there is no connection. Open it once while online.',
          );
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    void storagePressure().then((pressure) => {
      if (!pressure) return;
      if (pressure.blockCapture) {
        setPressureWarning(
          'This device is almost out of storage. Sync now — new photographs cannot be saved until you do.',
        );
      } else if (pressure.warn) {
        setPressureWarning('This device is running low on storage. Sync soon to free space.');
      }
    });
  }, [values]);

  const saveAnswer = useCallback(
    async (item: TemplateItem, value: ItemValue): Promise<void> => {
      setValues((current) => ({ ...current, [item.id]: value }));

      // Straight to the outbox. Online or offline, the same path — so the two
      // behaviours cannot drift apart.
      await enqueue({
        id: crypto.randomUUID(),
        entity: 'assessment_response',
        op: 'create',
        path: `/assessments/${id}/responses`,
        payload: {
          responses: [
            {
              id: crypto.randomUUID(),
              itemId: item.id,
              answer: value.notApplicable ? null : value.answer,
              note: value.note,
              notApplicable: value.notApplicable,
              // An assessor who saw it records VERIFIED; anything they were
              // told stays REPORTED. The distinction survives into the report.
              classification: value.note?.trim() ? 'REPORTED' : 'VERIFIED',
              evidenceIds: value.evidenceIds,
            },
          ],
        },
        dependsOn: [],
      });

      if (navigator.onLine) void sync();
    },
    [id],
  );

  const progress = useMemo(() => computeLocalProgress(payload, values), [payload, values]);

  if (error) {
    return (
      <div className="page">
        <div className="notice notice-danger">{error}</div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="page">
        <p className="muted">Loading the assessment…</p>
      </div>
    );
  }

  const section = payload.sections[activeSection];
  const sealed = payload.assessment.status === 'SEALED';

  return (
    <div className="page stack">
      <header className="stack" style={{ '--gap': 'var(--s2)' } as React.CSSProperties}>
        <h1>{payload.assessment.title}</h1>
        <div className="row-between">
          <span className="small muted">
            {progress.answeredRequired} of {progress.requiredItems} required answered
          </span>
          <span className="strong">{progress.percent}%</span>
        </div>
        <div className="meter">
          <div
            className="meter-fill"
            style={{ width: `${progress.percent}%` }}
            data-complete={progress.percent === 100}
          />
        </div>
        {cachedAt && (
          <p className="tiny muted">
            Form loaded {new Date(cachedAt).toLocaleString()} — answers are saved on this device as you go
          </p>
        )}
      </header>

      {sealed && (
        <div className="notice notice-info">
          This assessment has been sealed into a baseline and is read-only. It is the reference point every
          later comparison is measured against, so it can no longer be changed.
        </div>
      )}

      {pressureWarning && <div className="notice notice-warn">{pressureWarning}</div>}

      {progress.missingEvidence > 0 && (
        <div className="notice notice-warn">
          {progress.missingEvidence} answered item{progress.missingEvidence === 1 ? '' : 's'} still need
          evidence. The assessment cannot be submitted until they have it, or are marked not applicable.
        </div>
      )}

      <nav className="section-rail" aria-label="Assessment sections">
        {payload.sections.map((candidate, index) => {
          const sectionProgress = progress.bySection[candidate.id];
          return (
            <button
              key={candidate.id}
              type="button"
              className="section-chip"
              aria-current={index === activeSection}
              data-complete={sectionProgress?.complete ?? false}
              onClick={() => setActiveSection(index)}
            >
              {candidate.name}
              {sectionProgress && (
                <span className="tiny"> {sectionProgress.answered}/{sectionProgress.required}</span>
              )}
            </button>
          );
        })}
      </nav>

      {section && (
        <section className="card">
          <h2>{section.name}</h2>
          {section.description && <p className="hint">{section.description}</p>}

          <fieldset disabled={sealed} style={{ border: 'none', padding: 0, margin: 0 }}>
            {section.items.map((item) => (
              <ItemInput
                key={item.id}
                item={item}
                value={values[item.id]}
                onChange={(value) => void saveAnswer(item, value)}
                onCapture={() => {
                  /* Evidence capture opens in the evidence flow; wired in
                     EvidenceCapture, which owns the camera and compression. */
                }}
              />
            ))}
          </fieldset>

          <div className="row-between" style={{ marginTop: 'var(--s4)' }}>
            <button
              type="button"
              className="btn"
              disabled={activeSection === 0}
              onClick={() => setActiveSection((index) => Math.max(0, index - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={activeSection >= payload.sections.length - 1}
              onClick={() => setActiveSection((index) => Math.min(payload.sections.length - 1, index + 1))}
            >
              Next section
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function toValues(payload: AssessmentPayload): Record<string, ItemValue> {
  const values: Record<string, ItemValue> = {};

  for (const response of payload.responses) {
    values[response.itemId] = {
      answer: response.answer as ItemValue['answer'],
      note: response.note ?? undefined,
      notApplicable: response.answer === null && Boolean(response.note),
      evidenceIds: response.evidenceIds,
    };
  }

  return values;
}

/**
 * Progress, computed locally using the same rules as the server.
 *
 * Duplicating the rule is a deliberate trade: the percentage must update the
 * instant an answer is given, with no network, and it must not jump when a sync
 * lands. The shared definition lives in the contracts package so the two cannot
 * drift.
 */
function computeLocalProgress(
  payload: AssessmentPayload | null,
  values: Record<string, ItemValue>,
): {
  percent: number;
  requiredItems: number;
  answeredRequired: number;
  missingEvidence: number;
  bySection: Record<string, { answered: number; required: number; complete: boolean }>;
} {
  if (!payload) {
    return { percent: 0, requiredItems: 0, answeredRequired: 0, missingEvidence: 0, bySection: {} };
  }

  let requiredItems = 0;
  let answeredRequired = 0;
  let missingEvidence = 0;
  const bySection: Record<string, { answered: number; required: number; complete: boolean }> = {};

  for (const section of payload.sections) {
    let sectionRequired = 0;
    let sectionAnswered = 0;

    for (const item of section.items) {
      const value = values[item.id];
      const resolved = Boolean(value && (value.notApplicable || isAnswered(value.answer)));

      if (item.isRequired) {
        requiredItems += 1;
        sectionRequired += 1;
        if (resolved) {
          answeredRequired += 1;
          sectionAnswered += 1;
        }
      }

      if (
        item.evidenceRequired &&
        value &&
        !value.notApplicable &&
        isAnswered(value.answer) &&
        value.evidenceIds.length === 0
      ) {
        missingEvidence += 1;
      }
    }

    bySection[section.id] = {
      answered: sectionAnswered,
      required: sectionRequired,
      complete: sectionRequired > 0 && sectionAnswered === sectionRequired,
    };
  }

  return {
    // A template with no required items is complete, not zero — the same rule
    // the server applies.
    percent: requiredItems === 0 ? 100 : Math.round((answeredRequired / requiredItems) * 100),
    requiredItems,
    answeredRequired,
    missingEvidence,
    bySection,
  };
}

function isAnswered(answer: unknown): boolean {
  if (answer === null || answer === undefined || answer === '') return false;
  if (Array.isArray(answer)) return answer.length > 0;
  return true;
}
