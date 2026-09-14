import { describe, expect, it } from 'vitest';

import {
  summariseAttendance,
  type AttendanceEvent,
  type ScheduledShift,
} from './attendance';
import { assessCredential, assessPractice, type Credential } from './credentials';
import {
  assertScorable,
  computeIncentive,
  DEFAULT_INCENTIVE_RULES,
  IncentiveConfigurationError,
  normalise,
  splitPool,
  type MetricDefinition,
} from './incentive';

const NOW = new Date('2026-09-14T18:00:00.000Z');

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------

const shift = (overrides: Partial<ScheduledShift> = {}): ScheduledShift => ({
  id: 's1',
  shiftType: 'MORNING',
  startsAt: new Date('2026-09-14T08:00:00.000Z'),
  endsAt: new Date('2026-09-14T16:00:00.000Z'),
  ...overrides,
});

const event = (overrides: Partial<AttendanceEvent> = {}): AttendanceEvent => ({
  id: 'e1',
  eventType: 'CLOCK_IN',
  occurredAt: new Date('2026-09-14T08:00:00.000Z'),
  shiftId: 's1',
  method: 'QR',
  manualReason: null,
  ...overrides,
});

describe('a shift worked', () => {
  const summary = summariseAttendance(
    [shift()],
    [
      event(),
      event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:05:00.000Z') }),
    ],
    NOW,
  );

  it('counts the hours actually worked', () => {
    expect(summary.shifts[0].workedHours).toBeCloseTo(8.08, 2);
    expect(summary.workedHours).toBeCloseTo(8.08, 2);
  });

  it('counts it attended', () => {
    expect(summary.shifts[0].status).toBe('ATTENDED');
    expect(summary.attendanceRate).toBe(1);
  });

  it('needs no review', () => {
    expect(summary.needsReview).toBe(false);
  });
});

describe('lateness', () => {
  it('is tolerated inside the grace period', () => {
    const summary = summariseAttendance(
      [shift()],
      [
        event({ occurredAt: new Date('2026-09-14T08:10:00.000Z') }),
        event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:00:00.000Z') }),
      ],
      NOW,
    );

    expect(summary.shifts[0].status).toBe('ATTENDED');
    expect(summary.shifts[0].minutesLate).toBe(10);
  });

  it('is recorded beyond it, but the shift still counts as attended', () => {
    // Somebody an hour late did the rest of the day. Scoring that as absent
    // would be a lie about whether the patients were seen.
    const summary = summariseAttendance(
      [shift()],
      [
        event({ occurredAt: new Date('2026-09-14T09:00:00.000Z') }),
        event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:00:00.000Z') }),
      ],
      NOW,
    );

    expect(summary.shifts[0].status).toBe('LATE');
    expect(summary.shifts[0].minutesLate).toBe(60);
    expect(summary.lateShifts).toBe(1);
    expect(summary.attendedShifts).toBe(1);
  });

  it('takes its grace period from configuration', () => {
    const summary = summariseAttendance(
      [shift()],
      [
        event({ occurredAt: new Date('2026-09-14T08:10:00.000Z') }),
        event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:00:00.000Z') }),
      ],
      NOW,
      { graceMinutes: 5 },
    );

    expect(summary.shifts[0].status).toBe('LATE');
  });
});

describe('a shift nobody clocked into', () => {
  it('is an absence once it has started', () => {
    const summary = summariseAttendance([shift()], [], NOW);

    expect(summary.shifts[0].status).toBe('ABSENT');
    expect(summary.absentShifts).toBe(1);
    expect(summary.attendanceRate).toBe(0);
  });

  it('is not an absence before it starts', () => {
    // Counting tomorrow's roster as absence would make every schedule look
    // half-abandoned.
    const summary = summariseAttendance(
      [shift({ startsAt: new Date('2026-09-20T08:00:00.000Z'), endsAt: new Date('2026-09-20T16:00:00.000Z') })],
      [],
      NOW,
    );

    expect(summary.shifts[0].status).toBe('NOT_YET_DUE');
    expect(summary.scheduledShifts).toBe(0);
    expect(summary.attendanceRate).toBeNull();
  });
});

describe('a shift clocked into but never closed', () => {
  const summary = summariseAttendance([shift()], [event()], NOW);

  it('is neither absence nor a full day', () => {
    // A nurse who worked the night and forgot to clock out has done the work.
    // Recording zero hours takes money off somebody who was there; recording
    // the full shift pays for hours nobody can evidence.
    expect(summary.shifts[0].status).toBe('UNCLOSED');
    expect(summary.shifts[0].workedHours).toBeNull();
  });

  it('counts as attended, because somebody was there', () => {
    expect(summary.attendedShifts).toBe(1);
  });

  it('flags the period for review before it feeds an incentive', () => {
    expect(summary.needsReview).toBe(true);
    expect(summary.reviewReasons[0]).toContain('never closed');
  });

  it('is left out of the hours figures rather than counted as zero hours', () => {
    // The whole point: an unknown must not arrive at the incentive engine
    // wearing the face of a zero.
    expect(summary.hoursUnknownShifts).toBe(1);
    expect(summary.workedHours).toBe(0);
    expect(summary.scheduledHours).toBe(0);
    expect(summary.hoursRate).toBeNull();
  });
});

describe('an unclosed shift beside a worked one', () => {
  const summary = summariseAttendance(
    [
      shift({ id: 'a', startsAt: new Date('2026-09-12T08:00:00.000Z'), endsAt: new Date('2026-09-12T16:00:00.000Z') }),
      shift({ id: 'b', startsAt: new Date('2026-09-13T08:00:00.000Z'), endsAt: new Date('2026-09-13T16:00:00.000Z') }),
    ],
    [
      event({ id: '1', shiftId: 'a', occurredAt: new Date('2026-09-12T08:00:00.000Z') }),
      event({ id: '2', shiftId: 'a', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-12T16:00:00.000Z') }),
      event({ id: '3', shiftId: 'b', occurredAt: new Date('2026-09-13T08:00:00.000Z') }),
    ],
    NOW,
  );

  it('does not halve the hours rate of somebody who worked both', () => {
    expect(summary.hoursUnknownShifts).toBe(1);
    expect(summary.scheduledHours).toBe(8);
    expect(summary.workedHours).toBe(8);
    expect(summary.hoursRate).toBe(1);
    expect(summary.attendanceRate).toBe(1);
    expect(summary.needsReview).toBe(true);
  });
});

describe('manual attendance entries', () => {
  it('are flagged, because each is somebody vouching for somebody else', () => {
    const summary = summariseAttendance(
      [shift()],
      [
        event({ method: 'MANUAL', manualReason: 'Scanner broken' }),
        event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:00:00.000Z'), method: 'MANUAL' }),
      ],
      NOW,
    );

    expect(summary.needsReview).toBe(true);
    expect(summary.reviewReasons.join(' ')).toContain('vouching for somebody else');
  });
});

describe('several shifts', () => {
  it('rates attendance across the period', () => {
    const summary = summariseAttendance(
      [
        shift({ id: 'a', startsAt: new Date('2026-09-10T08:00:00.000Z'), endsAt: new Date('2026-09-10T16:00:00.000Z') }),
        shift({ id: 'b', startsAt: new Date('2026-09-11T08:00:00.000Z'), endsAt: new Date('2026-09-11T16:00:00.000Z') }),
        shift({ id: 'c', startsAt: new Date('2026-09-12T08:00:00.000Z'), endsAt: new Date('2026-09-12T16:00:00.000Z') }),
        shift({ id: 'd', startsAt: new Date('2026-09-13T08:00:00.000Z'), endsAt: new Date('2026-09-13T16:00:00.000Z') }),
      ],
      [
        event({ id: '1', shiftId: 'a', occurredAt: new Date('2026-09-10T08:00:00.000Z') }),
        event({ id: '2', shiftId: 'a', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-10T16:00:00.000Z') }),
        event({ id: '3', shiftId: 'b', occurredAt: new Date('2026-09-11T08:00:00.000Z') }),
        event({ id: '4', shiftId: 'b', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-11T16:00:00.000Z') }),
        event({ id: '5', shiftId: 'c', occurredAt: new Date('2026-09-12T08:00:00.000Z') }),
        event({ id: '6', shiftId: 'c', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-12T16:00:00.000Z') }),
      ],
      NOW,
    );

    expect(summary.scheduledShifts).toBe(4);
    expect(summary.attendedShifts).toBe(3);
    expect(summary.attendanceRate).toBe(0.75);
    expect(summary.hoursRate).toBe(0.75);
  });

  it('takes the last clock-out, not the first', () => {
    // Somebody who stepped out and came back did not finish at the first exit.
    const summary = summariseAttendance(
      [shift()],
      [
        event(),
        event({ id: 'e2', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T12:00:00.000Z') }),
        event({ id: 'e3', eventType: 'CLOCK_OUT', occurredAt: new Date('2026-09-14T16:00:00.000Z') }),
      ],
      NOW,
    );

    expect(summary.shifts[0].workedHours).toBe(8);
  });
});

// -----------------------------------------------------------------------------
// Incentive — acceptance criterion J
// -----------------------------------------------------------------------------

const metric = (overrides: Partial<MetricDefinition> = {}): MetricDefinition => ({
  id: 'm1',
  code: 'ATTENDANCE',
  name: 'Attendance rate',
  unit: null,
  direction: 'HIGHER_BETTER',
  weight: 1,
  targetValue: 1,
  sourceQueryId: 'q.attendance',
  isVolumeMetric: false,
  ...overrides,
});

const volumeMetric = metric({
  id: 'm-vol',
  code: 'PATIENTS_SEEN',
  name: 'Patients seen',
  targetValue: 400,
  isVolumeMetric: true,
});

describe('patient volume alone cannot determine an incentive', () => {
  it('is refused outright when volume is the only weighted metric', () => {
    // The acceptance criterion. Refused rather than warned about, because a
    // warning is something a busy administrator clicks past.
    expect(() => assertScorable([volumeMetric])).toThrow(IncentiveConfigurationError);
  });

  it('says why, in terms that make the reason obvious', () => {
    try {
      assertScorable([volumeMetric]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as IncentiveConfigurationError).code).toBe('volume-only');
      expect((error as Error).message).toContain('spend less time with each');
    }
  });

  it('is refused when volume merely dominates', () => {
    const decision = () =>
      assertScorable([
        { ...volumeMetric, weight: 8 },
        metric({ id: 'm2', code: 'QUALITY', weight: 2 }),
      ]);

    expect(decision).toThrow(/above the ceiling/);
  });

  it('is permitted as one contribution among others', () => {
    expect(() =>
      assertScorable([
        { ...volumeMetric, weight: 2 },
        metric({ id: 'm2', code: 'QUALITY', weight: 3 }),
        metric({ id: 'm3', code: 'ATTENDANCE', weight: 5 }),
      ]),
    ).not.toThrow();
  });

  it('refuses a ceiling of 100%, which is the forbidden configuration renamed', () => {
    expect(() =>
      assertScorable([volumeMetric, metric({ id: 'm2' })], { maxVolumeWeightShare: 1 }),
    ).toThrow(/forbids/);
  });

  it('refuses a metric with no query behind it', () => {
    // A metric nobody can compute is an opinion with a currency symbol.
    expect(() =>
      assertScorable([metric({ sourceQueryId: null }), metric({ id: 'm2', code: 'OTHER' })]),
    ).toThrow(/opinion/);
  });

  it('refuses a metric set that weighs nothing', () => {
    expect(() => assertScorable([metric({ weight: 0 })])).toThrow(/nothing to compute/);
  });
});

describe('normalising a metric', () => {
  it('scores against the target, higher being better', () => {
    expect(normalise(0.9, metric({ targetValue: 1 }))).toBe(0.9);
  });

  it('inverts when lower is better', () => {
    // Two stockouts against a target of one scores 0.5.
    expect(normalise(2, metric({ direction: 'LOWER_BETTER', targetValue: 1 }))).toBe(0.5);
  });

  it('caps at 1, so a target does not become a race', () => {
    expect(normalise(500, metric({ targetValue: 400 }))).toBe(1);
  });

  it('never goes below 0', () => {
    expect(normalise(-5, metric({ targetValue: 10 }))).toBe(0);
  });

  it('handles a target of zero as met or not met', () => {
    const zeroTarget = metric({ direction: 'LOWER_BETTER', targetValue: 0 });

    expect(normalise(0, zeroTarget)).toBe(1);
    expect(normalise(3, zeroTarget)).toBe(0);
  });

  it('returns null with no value or no target, rather than guessing', () => {
    expect(normalise(null, metric())).toBeNull();
    expect(normalise(5, metric({ targetValue: null }))).toBeNull();
  });
});

describe('computing an incentive', () => {
  const metrics = [
    metric({ id: 'm-att', code: 'ATTENDANCE', name: 'Attendance rate', weight: 4, targetValue: 1 }),
    metric({ id: 'm-qual', code: 'NOTES_SIGNED', name: 'Notes signed same day', weight: 4, targetValue: 1 }),
    { ...volumeMetric, weight: 2 },
  ];

  const result = computeIncentive({
    metrics,
    observations: [
      { metricId: 'm-att', value: 0.9 },
      { metricId: 'm-qual', value: 0.8 },
      { metricId: 'm-vol', value: 380 },
    ],
    poolMinor: 1_000_000,
  });

  it('weights the metrics and scores the person', () => {
    // (0.9*4 + 0.8*4 + 0.95*2) / 10
    expect(result.overallScore).toBeCloseTo(0.87, 4);
  });

  it('awards that share of the pool', () => {
    expect(result.totalAmountMinor).toBe(870_000);
  });

  it('gives every component its own arithmetic in words', () => {
    // Nobody has to trust the number: they can read how it was made.
    for (const component of result.components) {
      expect(component.formulaText).toContain('against a target of');
      expect(component.formulaText).toContain('Share of the');
      expect(component.formulaText.length).toBeGreaterThan(60);
    }
  });

  it('makes the components sum exactly to the award', () => {
    // A missing kobo would be noticed, and the person would be right to notice.
    const sum = result.components.reduce((total, component) => total + component.amountMinor, 0);

    expect(sum).toBe(result.totalAmountMinor);
  });

  it('states the whole calculation in one readable line', () => {
    expect(result.explanation).toContain('metric(s) scored');
    expect(result.explanation).toContain('pool');
  });

  it('keeps every amount a whole number of kobo', () => {
    for (const component of result.components) {
      expect(Number.isInteger(component.amountMinor)).toBe(true);
    }
  });
});

describe('a metric that could not be scored', () => {
  it('is excluded and reported, never counted as zero', () => {
    // A query that returned nothing is not evidence that somebody did badly.
    const result = computeIncentive({
      metrics: [
        metric({ id: 'm-att', code: 'ATTENDANCE', weight: 5 }),
        metric({ id: 'm-qual', code: 'QUALITY', weight: 5 }),
      ],
      observations: [{ metricId: 'm-att', value: 1 }, { metricId: 'm-qual', value: null }],
      poolMinor: 1_000_000,
    });

    expect(result.overallScore).toBe(1);
    expect(result.totalAmountMinor).toBe(1_000_000);
    expect(result.unscored).toEqual([
      { code: 'QUALITY', reason: 'The query returned no value for this person in this period.' },
    ]);
  });

  it('refuses to pay when only the volume metric survived', () => {
    // If the quality metrics all failed to compute, what is left is volume
    // alone — which is exactly what the rule forbids, however it came about.
    expect(() =>
      computeIncentive({
        metrics: [metric({ id: 'm-qual', code: 'QUALITY', weight: 5 }), { ...volumeMetric, weight: 2 }],
        observations: [{ metricId: 'm-qual', value: null }, { metricId: 'm-vol', value: 400 }],
        poolMinor: 1_000_000,
      }),
    ).toThrow(IncentiveConfigurationError);
  });

  it('pays nothing and says why when nothing at all could be scored', () => {
    const result = computeIncentive({
      metrics: [metric({ id: 'm-att', weight: 5 }), metric({ id: 'm2', code: 'QUALITY', weight: 5 })],
      observations: [],
      poolMinor: 1_000_000,
    });

    expect(result.totalAmountMinor).toBe(0);
    expect(result.explanation).toContain('not a score of zero');
    expect(result.explanation).toContain('absence of evidence');
  });
});

describe('the pool', () => {
  it('splits equally by default', () => {
    expect(splitPool(1_000_000, ['a', 'b', 'c', 'd'])).toEqual([
      { staffId: 'a', shareMinor: 250_000 },
      { staffId: 'b', shareMinor: 250_000 },
      { staffId: 'c', shareMinor: 250_000 },
      { staffId: 'd', shareMinor: 250_000 },
    ]);
  });

  it('loses nothing to rounding', () => {
    const shares = splitPool(100, ['a', 'b', 'c']);

    expect(shares.reduce((sum, share) => sum + share.shareMinor, 0)).toBe(100);
  });

  it('splits by weight when one is given', () => {
    expect(splitPool(1_000_000, ['a', 'b'], [3, 1])).toEqual([
      { staffId: 'a', shareMinor: 750_000 },
      { staffId: 'b', shareMinor: 250_000 },
    ]);
  });

  it('refuses a partial set of weights', () => {
    expect(() => splitPool(100, ['a', 'b'], [1])).toThrow(RangeError);
  });

  it('handles an empty facility without dividing by zero', () => {
    expect(splitPool(1_000_000, [])).toEqual([]);
  });

  it('refuses a negative pool', () => {
    expect(() =>
      computeIncentive({
        metrics: [metric(), metric({ id: 'm2', code: 'OTHER' })],
        observations: [{ metricId: 'm1', value: 1 }],
        poolMinor: -1,
      }),
    ).toThrow(RangeError);
  });

  it('states a default ceiling rather than hiding one', () => {
    expect(DEFAULT_INCENTIVE_RULES.maxVolumeWeightShare).toBeGreaterThan(0);
    expect(DEFAULT_INCENTIVE_RULES.maxVolumeWeightShare).toBeLessThan(1);
  });
});

// -----------------------------------------------------------------------------
// Credentials
// -----------------------------------------------------------------------------

const credential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'c1',
  credentialType: 'Nursing licence',
  credentialNumber: 'RN-12345',
  issuingBody: 'Nursing and Midwifery Council',
  expiresOn: new Date('2027-06-30'),
  status: 'VALID',
  verifiedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('a credential', () => {
  it('is valid well before its expiry', () => {
    expect(assessCredential(credential(), NOW).effectiveStatus).toBe('VALID');
  });

  it('expires because the date passed, not because a job ran', () => {
    const assessment = assessCredential(credential({ expiresOn: new Date('2026-08-01') }), NOW);

    expect(assessment.effectiveStatus).toBe('EXPIRED');
    expect(assessment.storedStatus).toBe('VALID');
    expect(assessment.blocksPractice).toBe(true);
  });

  it('warns before it expires, with time to act', () => {
    const assessment = assessCredential(credential({ expiresOn: new Date('2026-10-15') }), NOW);

    expect(assessment.effectiveStatus).toBe('EXPIRING');
    expect(assessment.blocksPractice).toBe(false);
    expect(assessment.message).toContain('Renewal takes time');
  });

  it('lets a suspension outrank the calendar', () => {
    const assessment = assessCredential(credential({ status: 'SUSPENDED' }), NOW);

    expect(assessment.effectiveStatus).toBe('SUSPENDED');
    expect(assessment.blocksPractice).toBe(true);
  });

  it('distinguishes unverified from invalid', () => {
    // A new starter's licence may be genuine and simply unchecked.
    const assessment = assessCredential(credential({ verifiedAt: null }), NOW);

    expect(assessment.effectiveStatus).toBe('UNVERIFIED');
    expect(assessment.blocksPractice).toBe(false);
    expect(assessment.message).toContain('not yet evidence');
  });

  it('calls a lapsed unverified licence lapsed, not merely unverified', () => {
    // Both are true; only one of them stops somebody seeing patients. Reporting
    // UNVERIFIED here would hide an expiry behind an administrative label.
    const assessment = assessCredential(
      credential({ verifiedAt: null, status: 'UNVERIFIED', expiresOn: new Date('2026-08-01') }),
      NOW,
    );

    expect(assessment.effectiveStatus).toBe('EXPIRED');
    expect(assessment.blocksPractice).toBe(true);
  });

  it('handles a credential with no expiry date', () => {
    expect(assessCredential(credential({ expiresOn: null }), NOW).effectiveStatus).toBe('VALID');
  });
});

describe('whether somebody may practise', () => {
  it('is blocked by a lapsed licence', () => {
    const decision = assessPractice([credential({ expiresOn: new Date('2026-08-01') })], NOW);

    expect(decision.mayPractise).toBe(false);
    expect(decision.summary).toContain('Practice is blocked');
  });

  it('is permitted with a valid licence, and says what is coming', () => {
    const decision = assessPractice(
      [credential(), credential({ id: 'c2', credentialType: 'BLS', expiresOn: new Date('2026-10-01') })],
      NOW,
    );

    expect(decision.mayPractise).toBe(true);
    expect(decision.summary).toContain('need renewing soon');
  });

  it('does not block somebody who holds no credentials', () => {
    // A cleaner and a records clerk need none. Blocking everybody without a
    // licence would stop the facility working.
    const decision = assessPractice([], NOW);

    expect(decision.mayPractise).toBe(true);
    expect(decision.summary).toContain('nothing evidences them either');
  });

  it('blocks on one lapsed credential even when others are current', () => {
    const decision = assessPractice(
      [credential(), credential({ id: 'c2', credentialType: 'Controlled drugs', expiresOn: new Date('2026-01-01') })],
      NOW,
    );

    expect(decision.mayPractise).toBe(false);
    expect(decision.blocking).toHaveLength(1);
  });
});
