import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ESCALATION,
  flagResult,
  isCritical,
  nextEscalation,
  selfVerificationNote,
  type EscalationState,
  type ReferenceRange,
} from './critical-result';

// -----------------------------------------------------------------------------
// Critical results
// -----------------------------------------------------------------------------

const range: ReferenceRange = { lowNormal: 3.5, highNormal: 5.1, lowCritical: 2.5, highCritical: 6.5 };

describe('flagging a result', () => {
  it('calls a normal value normal', () => {
    expect(flagResult(4.2, range)).toBe('NORMAL');
  });

  it('flags high and low', () => {
    expect(flagResult(5.5, range)).toBe('HIGH');
    expect(flagResult(3.0, range)).toBe('LOW');
  });

  it('flags critical before anything else', () => {
    expect(flagResult(7.2, range)).toBe('CRITICAL_HIGH');
    expect(flagResult(2.1, range)).toBe('CRITICAL_LOW');
    expect(isCritical(flagResult(7.2, range))).toBe(true);
  });

  it('treats the critical bound itself as critical', () => {
    expect(flagResult(6.5, range)).toBe('CRITICAL_HIGH');
    expect(flagResult(2.5, range)).toBe('CRITICAL_LOW');
  });

  it('refuses to call anything normal with no range configured', () => {
    // Saying "normal" would invent a clinical judgement nobody made.
    expect(
      flagResult(4.2, { lowNormal: null, highNormal: null, lowCritical: null, highCritical: null }),
    ).toBe('ABNORMAL');
  });
});

describe('escalating a critical result', () => {
  const state = (overrides: Partial<EscalationState> = {}): EscalationState => ({
    startedAt: new Date('2026-09-14T10:00:00.000Z'),
    acknowledgedAt: null,
    acknowledgedBy: null,
    deliveredSteps: [],
    ...overrides,
  });

  it('tells the ordering clinician at once', () => {
    const decision = nextEscalation(state(), new Date('2026-09-14T10:00:00.000Z'));

    expect(decision.due.map((step) => step.notify)).toEqual(['ORDERING_CLINICIAN']);
  });

  it('widens when nobody answers', () => {
    const decision = nextEscalation(
      state({ deliveredSteps: [0] }),
      new Date('2026-09-14T10:16:00.000Z'),
    );

    expect(decision.due.map((step) => step.notify)).toEqual(['CLINICAL_LEAD']);
  });

  it('reaches the whole ladder after an hour', () => {
    const decision = nextEscalation(state(), new Date('2026-09-14T11:00:00.000Z'));

    expect(decision.due.map((step) => step.notify)).toEqual([
      'ORDERING_CLINICIAN',
      'CLINICAL_LEAD',
      'FACILITY_MANAGER',
      'ON_CALL',
    ]);
  });

  it('keeps firing the last step forever until somebody answers', () => {
    // There is nobody left to escalate to, and silence is not an acceptable
    // resting state for a potassium of 7.2.
    const decision = nextEscalation(
      state({ deliveredSteps: [0, 1, 2, 3] }),
      new Date('2026-09-14T14:00:00.000Z'),
    );

    expect(decision.continues).toBe(true);
    expect(decision.due.map((step) => step.notify)).toEqual(['ON_CALL']);
  });

  it('stops the moment it is acknowledged', () => {
    const decision = nextEscalation(
      state({
        deliveredSteps: [0, 1, 2, 3],
        acknowledgedAt: new Date('2026-09-14T10:20:00.000Z'),
        acknowledgedBy: 'Dr Okafor',
      }),
      new Date('2026-09-14T14:00:00.000Z'),
    );

    expect(decision.continues).toBe(false);
    expect(decision.due).toEqual([]);
    expect(decision.summary).toContain('Dr Okafor');
    expect(decision.summary).toContain('20 minute(s)');
  });

  it('does not repeat a step already delivered', () => {
    const decision = nextEscalation(state({ deliveredSteps: [0] }), new Date('2026-09-14T10:05:00.000Z'));

    expect(decision.due).toEqual([]);
    expect(decision.continues).toBe(true);
  });

  it('gives every step a stated rationale', () => {
    // Whoever configures this must understand what each delay costs.
    for (const step of DEFAULT_ESCALATION) {
      expect(step.rationale.length, step.notify).toBeGreaterThan(30);
    }
  });

  it('takes its ladder from configuration', () => {
    const decision = nextEscalation(state(), new Date('2026-09-14T10:05:00.000Z'), [
      { afterMinutes: 0, notify: 'WHOEVER', rationale: 'A short ladder for a small facility with one clinician.' },
    ]);

    expect(decision.due.map((step) => step.notify)).toEqual(['WHOEVER']);
  });
});

describe('who verified a result', () => {
  it('notes when one person both entered and verified it', () => {
    // Permitted and recorded rather than forbidden and worked around: a
    // laboratory with one scientist on shift would otherwise release nothing.
    expect(selfVerificationNote('s1', 's1')).toContain('one scientist on shift');
  });

  it('says nothing when two people were involved', () => {
    expect(selfVerificationNote('s1', 's2')).toBeNull();
  });
});
