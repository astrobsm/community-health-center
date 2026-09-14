import { describe, expect, it } from 'vitest';

import { benchmark, DEFAULT_BENCHMARK_RULES, type BenchmarkEntry } from './benchmark';
import { compare, type ComparisonInput } from './comparison';
import { qualityBand, scoreDataQuality, type DimensionInput } from './data-quality';
import { assessBalance, assessProjectHealth, type ProjectHealthInput } from './project-health';

const NOW = new Date('2026-09-14T12:00:00.000Z');

// -----------------------------------------------------------------------------
// Baseline versus current (criterion B)
// -----------------------------------------------------------------------------

const comparisonInput = (overrides: Partial<ComparisonInput> = {}): ComparisonInput => ({
  kpiCode: 'PATIENTS_PER_DAY',
  kpiName: 'Patients per day',
  unit: 'patients/day',
  direction: 'HIGHER_BETTER',
  baseline: {
    value: 8,
    classification: 'VERIFIED',
    sealedAt: new Date('2026-01-15T00:00:00.000Z'),
    label: 'Day 0',
  },
  current: { value: 31, classification: 'ACTUAL', computedAt: NOW, sampleSize: 2790 },
  target: { value: 40, date: new Date('2027-01-15') },
  ...overrides,
});

describe('comparing a sealed baseline with a computed current value', () => {
  const result = compare(comparisonInput());

  it('reports both numbers and the change between them', () => {
    expect(result.baselineValue).toBe(8);
    expect(result.currentValue).toBe(31);
    expect(result.change).toBe(23);
    expect(result.changePercent).toBe(287.5);
    expect(result.direction).toBe('IMPROVED');
  });

  it('reports progress towards the target as a fraction of the journey', () => {
    // 8 -> 40 is a journey of 32; 23 of it is done.
    expect(result.progressToTarget).toBeCloseTo(0.7188, 4);
    expect(result.varianceToTarget).toBe(-9);
  });

  it('carries the weakest classification of the two inputs', () => {
    // The baseline was VERIFIED by a named assessor; the current value is
    // ACTUAL. A comparison is only as strong as its weaker half.
    expect(result.classification).toBe('VERIFIED');
  });

  it('says where each number came from, on the row rather than in a footnote', () => {
    expect(result.provenance).toContain('sealed on 2026-01-15');
    expect(result.provenance).toContain('recomputed from transactions');
    expect(result.provenance).toContain('2790 record(s)');
  });
});

describe('a comparison missing half of itself', () => {
  it('claims no change when there is no baseline', () => {
    const result = compare(comparisonInput({ baseline: null }));

    expect(result.comparable).toBe(false);
    expect(result.change).toBeNull();
    expect(result.direction).toBe('UNKNOWN');
    expect(result.note).toContain('no sealed baseline');
  });

  it('does not read a missing current value as a fall to zero', () => {
    const result = compare(comparisonInput({ current: null }));

    expect(result.currentValue).toBeNull();
    expect(result.change).toBeNull();
    expect(result.direction).toBe('UNKNOWN');
    expect(result.note).toContain('absence of measurement');
  });

  it('is ESTIMATED when it rests on nothing, never ACTUAL', () => {
    const result = compare(comparisonInput({ baseline: null, current: null }));

    expect(result.classification).toBe('ESTIMATED');
  });
});

describe('the direction of a change', () => {
  it('reads a fall as an improvement for a lower-is-better metric', () => {
    const result = compare(
      comparisonInput({
        kpiCode: 'AVG_WAITING_TIME',
        direction: 'LOWER_BETTER',
        baseline: { value: 120, classification: 'REPORTED', sealedAt: NOW, label: 'Day 0' },
        current: { value: 45, classification: 'ACTUAL', computedAt: NOW, sampleSize: 400 },
        target: { value: 30, date: null },
      }),
    );

    expect(result.change).toBe(-75);
    expect(result.direction).toBe('IMPROVED');
  });

  it('refuses to call a move good or bad for a target range', () => {
    // Being nearer the middle of a range is not "up" or "down", and labelling
    // it either way would be a claim the metric does not support.
    const result = compare(comparisonInput({ direction: 'TARGET_RANGE' }));

    expect(result.direction).toBe('UNKNOWN');
  });

  it('handles a baseline of zero without dividing by it', () => {
    const result = compare(
      comparisonInput({
        baseline: { value: 0, classification: 'VERIFIED', sealedAt: NOW, label: 'Day 0' },
        current: { value: 12, classification: 'ACTUAL', computedAt: NOW, sampleSize: 12 },
      }),
    );

    expect(result.change).toBe(12);
    expect(result.changePercent).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Data quality (spec §47)
// -----------------------------------------------------------------------------

const dimension = (overrides: Partial<DimensionInput> = {}): DimensionInput => ({
  dimension: 'COMPLETENESS',
  good: 90,
  outOf: 100,
  weight: 1,
  issues: [],
  ...overrides,
});

describe('the data quality score', () => {
  it('weights by denominator, so a handful of records cannot swing it', () => {
    const result = scoreDataQuality([
      dimension({ dimension: 'COMPLETENESS', good: 100, outOf: 200 }),
      dimension({ dimension: 'VALIDITY', good: 0, outOf: 4 }),
    ]);

    // Averaging the two rates would give 25%. The truth is 100 good out of 204.
    expect(result.overallScore).toBeCloseTo(49.02, 2);
  });

  it('reports an unmeasurable dimension as unmeasured, not as a zero', () => {
    const result = scoreDataQuality([
      dimension({ dimension: 'COMPLETENESS', good: 95, outOf: 100 }),
      dimension({ dimension: 'RECONCILIATION', good: 0, outOf: 0 }),
    ]);

    expect(result.overallScore).toBe(95);
    expect(result.unmeasured).toEqual(['RECONCILIATION']);
    expect(result.dimensions.find((d) => d.dimension === 'RECONCILIATION')?.score).toBeNull();
    expect(result.explanation).toContain('excluded rather than counted as failures');
  });

  it('scores nothing rather than zero when there is no data at all', () => {
    const result = scoreDataQuality([dimension({ good: 0, outOf: 0 })]);

    expect(result.overallScore).toBeNull();
    expect(result.explanation).toContain('there is no data');
    expect(qualityBand(result.overallScore)).toBe('NOT_ASSESSED');
  });

  it('refuses arithmetic that cannot be true', () => {
    expect(() => scoreDataQuality([dimension({ good: 120, outOf: 100 })])).toThrow(RangeError);
  });

  it('bands a score without rounding a failure up into a pass', () => {
    expect(qualityBand(89.9)).toBe('ADEQUATE');
    expect(qualityBand(90)).toBe('GOOD');
    expect(qualityBand(74.99)).toBe('POOR');
  });

  it('carries every issue through to the result', () => {
    const result = scoreDataQuality([
      dimension({
        issues: [
          {
            dimension: 'COMPLETENESS',
            code: 'missing-diagnosis',
            description: '10 closed encounters have neither a diagnosis nor a reason for having none.',
            affectedCount: 10,
            outOf: 100,
            severity: 'HIGH',
            href: '/api/v1/analytics/drill-down?figure=undocumented_encounters',
          },
        ],
      }),
    ]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].outOf).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// Benchmarking (spec §§40-41)
// -----------------------------------------------------------------------------

const entry = (overrides: Partial<BenchmarkEntry> = {}): BenchmarkEntry => ({
  facilityId: 'f1',
  facilityName: 'CHC Ikem',
  value: 50,
  sampleSize: 100,
  ...overrides,
});

describe('benchmarking facilities', () => {
  it('will not publish a league table of two', () => {
    const result = benchmark(
      [entry({ facilityId: 'a', value: 80 }), entry({ facilityId: 'b', value: 20 })],
      'HIGHER_BETTER',
    );

    expect(result.published).toBe(false);
    expect(result.ranked).toEqual([]);
    expect(result.caveat).toContain('wearing the clothes of a league table');
  });

  it('ranks by the metric direction and reports the spread, not just the mean', () => {
    const result = benchmark(
      [
        entry({ facilityId: 'a', facilityName: 'A', value: 90 }),
        entry({ facilityId: 'b', facilityName: 'B', value: 50 }),
        entry({ facilityId: 'c', facilityName: 'C', value: 10 }),
        entry({ facilityId: 'd', facilityName: 'D', value: 70 }),
      ],
      'HIGHER_BETTER',
    );

    expect(result.published).toBe(true);
    expect(result.ranked.map((r) => r.facilityId)).toEqual(['a', 'd', 'b', 'c']);
    expect(result.ranked[0].rank).toBe(1);
    expect(result.ranked[0].percentile).toBe(100);
    expect(result.statistics?.median).toBe(60);
    expect(result.statistics?.lowerQuartile).toBe(40);
    expect(result.statistics?.upperQuartile).toBe(75);
  });

  it('ranks the lowest first for a lower-is-better metric', () => {
    const result = benchmark(
      [
        entry({ facilityId: 'a', value: 120 }),
        entry({ facilityId: 'b', value: 30 }),
        entry({ facilityId: 'c', value: 60 }),
      ],
      'LOWER_BETTER',
    );

    expect(result.ranked.map((r) => r.facilityId)).toEqual(['b', 'c', 'a']);
    expect(result.statistics?.best).toBe(30);
    expect(result.statistics?.worst).toBe(120);
  });

  it('gives tied facilities the same rank', () => {
    const result = benchmark(
      [
        entry({ facilityId: 'a', value: 70 }),
        entry({ facilityId: 'b', value: 70 }),
        entry({ facilityId: 'c', value: 10 }),
      ],
      'HIGHER_BETTER',
    );

    expect(result.ranked[0].rank).toBe(1);
    expect(result.ranked[1].rank).toBe(1);
    expect(result.ranked[2].rank).toBe(3);
  });

  it('withholds a facility whose denominator is too small, and names it', () => {
    const result = benchmark(
      [
        entry({ facilityId: 'a', value: 90, sampleSize: 400 }),
        entry({ facilityId: 'b', value: 80, sampleSize: 300 }),
        entry({ facilityId: 'c', value: 70, sampleSize: 250 }),
        entry({ facilityId: 'd', facilityName: 'Tiny', value: 100, sampleSize: 2 }),
      ],
      'HIGHER_BETTER',
    );

    expect(result.ranked.map((r) => r.facilityId)).toEqual(['a', 'b', 'c']);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].facilityName).toBe('Tiny');
    expect(result.excluded[0].reason).toContain('below the threshold');
  });

  it('excludes a facility with no value rather than ranking it last', () => {
    // Bottom of a table is a statement about performance. "We have no data"
    // is a statement about records, and the two must not look the same.
    const result = benchmark(
      [
        entry({ facilityId: 'a', value: 90 }),
        entry({ facilityId: 'b', value: 80 }),
        entry({ facilityId: 'c', value: 70 }),
        entry({ facilityId: 'd', facilityName: 'Unmeasured', value: null, sampleSize: null }),
      ],
      'HIGHER_BETTER',
    );

    expect(result.ranked).toHaveLength(3);
    expect(result.excluded[0].reason).toContain('No value could be computed');
  });

  it('takes its thresholds from configuration', () => {
    const result = benchmark(
      [entry({ facilityId: 'a', value: 5 }), entry({ facilityId: 'b', value: 9 })],
      'HIGHER_BETTER',
      { ...DEFAULT_BENCHMARK_RULES, minimumFacilities: 2 },
    );

    expect(result.published).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Project health (spec §22)
// -----------------------------------------------------------------------------

const project = (overrides: Partial<ProjectHealthInput> = {}): ProjectHealthInput => ({
  projectId: 'p1',
  reference: 'CP-0001',
  name: 'Theatre refurbishment',
  plannedStart: new Date('2026-06-01'),
  plannedEnd: new Date('2026-12-01'),
  actualStart: new Date('2026-06-03'),
  actualEnd: null,
  budgetMinor: 10_000_000,
  spentMinor: 4_000_000,
  physicalProgress: 0.5,
  openIssues: 0,
  ...overrides,
});

describe('project health', () => {
  it('is on track when progress matches the calendar and the money', () => {
    const health = assessProjectHealth(project(), NOW);

    expect(health.band).toBe('ON_TRACK');
    expect(health.burnRatio).toBe(0.8);
  });

  it('refuses to call an unmeasured project healthy', () => {
    // The most dangerous answer available: a project with nothing recorded
    // showing green.
    const health = assessProjectHealth(
      project({ physicalProgress: null, budgetMinor: 0, spentMinor: 0 }),
      NOW,
    );

    expect(health.band).toBe('NOT_ASSESSABLE');
    expect(health.score).toBeNull();
    expect(health.reasons.join(' ')).toContain('an unmeasured one');
  });

  it('notices money running ahead of work', () => {
    const health = assessProjectHealth(
      project({ spentMinor: 9_000_000, physicalProgress: 0.3 }),
      NOW,
    );

    expect(health.burnRatio).toBeCloseTo(3, 4);
    expect(health.band).toBe('OFF_TRACK');
    expect(health.reasons.join(' ')).toContain('Spending is running ahead of work');
  });

  it('notices a planned completion date that has quietly passed', () => {
    const health = assessProjectHealth(
      project({ plannedEnd: new Date('2026-08-01'), physicalProgress: 0.8 }),
      NOW,
    );

    expect(health.reasons.join(' ')).toContain('has passed');
  });

  it('explains every band it gives', () => {
    const health = assessProjectHealth(project({ physicalProgress: 0.1, openIssues: 3 }), NOW);

    expect(health.reasons.length).toBeGreaterThan(0);
    expect(health.reasons.join(' ')).toContain('open issue');
  });

  it('treats a completed project as complete', () => {
    const health = assessProjectHealth(project({ actualEnd: new Date('2026-09-01') }), NOW);

    expect(health.band).toBe('ON_TRACK');
    expect(health.score).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// The clinical-versus-financial balance (spec §42)
// -----------------------------------------------------------------------------

describe('the balance between care and money', () => {
  it('reports revenue per encounter and the waived share', () => {
    const balance = assessBalance({
      encounters: 100,
      revenueMinor: 500_000,
      waivedMinor: 100_000,
      refusedForPaymentCount: 0,
      consentRate: 0.98,
      incidentRate: 2,
    });

    expect(balance.revenuePerEncounterMinor).toBe(5000);
    expect(balance.waivedShare).toBeCloseTo(0.1667, 4);
    expect(balance.concerns).toEqual([]);
  });

  it('says when nobody recorded whether patients were turned away', () => {
    // The most important number on the page, and the one most likely to be
    // absent. Showing nought here would be inventing it.
    const balance = assessBalance({
      encounters: 100,
      revenueMinor: 500_000,
      waivedMinor: 50_000,
      refusedForPaymentCount: null,
      consentRate: 0.95,
      incidentRate: 1,
    });

    expect(balance.limits.join(' ')).toContain('inventing the most important number');
  });

  it('asks about a waiver rate of exactly zero', () => {
    const balance = assessBalance({
      encounters: 400,
      revenueMinor: 2_000_000,
      waivedMinor: 0,
      refusedForPaymentCount: 0,
      consentRate: 1,
      incidentRate: 0,
    });

    expect(balance.waivedShare).toBe(0);
    expect(balance.concerns.join(' ')).toContain('worth asking about');
  });

  it('raises documentation falling behind as a balance concern', () => {
    const balance = assessBalance({
      encounters: 400,
      revenueMinor: 2_000_000,
      waivedMinor: 100_000,
      refusedForPaymentCount: 0,
      consentRate: 0.62,
      incidentRate: 1,
    });

    expect(balance.concerns.join(' ')).toContain('62% of encounters');
  });

  it('always states what the figures cannot tell you', () => {
    const balance = assessBalance({
      encounters: 0,
      revenueMinor: 0,
      waivedMinor: 0,
      refusedForPaymentCount: 0,
      consentRate: null,
      incidentRate: null,
    });

    expect(balance.limits.join(' ')).toContain('a patient who should have come did not come');
  });
});
