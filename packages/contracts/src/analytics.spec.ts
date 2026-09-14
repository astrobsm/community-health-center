import { describe, expect, it } from 'vitest';

import { dashboardSchema, figureSchema, type Figure } from './analytics.js';

/**
 * The figure schema is the mechanism behind "no dashboard renders a number
 * without its classification and timestamp" (criterion M).
 *
 * These tests are the mechanism's own test. If the schema stops refusing these
 * payloads, the rule quietly becomes a convention again, and a convention is
 * what everybody follows until the week they are busy.
 */

const figure = (overrides: Partial<Figure> = {}): unknown => ({
  key: 'revenue_collected',
  label: 'Revenue collected',
  value: 48200,
  unit: 'NGN',
  classification: 'ACTUAL',
  computedAt: '2026-09-14T06:15:00.000Z',
  sourceQueryId: 'dash/revenue_collected@v1',
  definition: 'Inbound payments received in the period.',
  reads: ['fin.payment'],
  sampleSize: 1284,
  drillDown: {
    href: '/api/v1/analytics/drill-down?figure=revenue_collected',
    level: 'TRANSACTION',
    label: 'The payments behind this total',
  },
  noDrillDownReason: null,
  ...overrides,
});

describe('a dashboard figure', () => {
  it('is accepted when it carries everything a reader needs', () => {
    expect(figureSchema.safeParse(figure()).success).toBe(true);
  });

  it('is refused without a classification', () => {
    const { classification, ...rest } = figure() as Record<string, unknown>;
    void classification;
    expect(figureSchema.safeParse(rest).success).toBe(false);
  });

  it('is refused without the moment it was computed', () => {
    const { computedAt, ...rest } = figure() as Record<string, unknown>;
    void computedAt;
    expect(figureSchema.safeParse(rest).success).toBe(false);
  });

  it('is refused without the named query behind it', () => {
    expect(figureSchema.safeParse(figure({ sourceQueryId: '' })).success).toBe(false);
  });

  it('is refused without naming the tables it read', () => {
    expect(figureSchema.safeParse(figure({ reads: [] })).success).toBe(false);
  });

  it('is refused when it is neither clickable nor explains why not', () => {
    const result = figureSchema.safeParse(figure({ drillDown: null, noDrillDownReason: null }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('clickable down to its rows');
  });

  it('is accepted when it says why it has no rows beneath it', () => {
    const result = figureSchema.safeParse(
      figure({
        drillDown: null,
        noDrillDownReason: 'This is a single sealed snapshot, not an aggregate over records.',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('is refused when it both offers a drill-down and explains its absence', () => {
    expect(
      figureSchema.safeParse(figure({ noDrillDownReason: 'It has no rows, but also here they are.' }))
        .success,
    ).toBe(false);
  });

  it('is refused when a suppressed figure still carries its value', () => {
    // Suppression that leaves the number in the payload is not suppression; it
    // is a value one curl away from being published.
    const result = figureSchema.safeParse(
      figure({ suppressed: true, value: 42, suppressionReason: 'Fewer than five observations.' }),
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('is not withheld');
  });

  it('accepts a suppressed figure with its value withheld', () => {
    expect(
      figureSchema.safeParse(
        figure({ suppressed: true, value: null, suppressionReason: 'Fewer than five observations.' }),
      ).success,
    ).toBe(true);
  });

  it('accepts a null value, because absent and zero are different', () => {
    expect(figureSchema.safeParse(figure({ value: null })).success).toBe(true);
  });

  it('refuses a definition too short to mean anything', () => {
    expect(figureSchema.safeParse(figure({ definition: 'money' })).success).toBe(false);
  });
});

describe('a dashboard', () => {
  const dashboard = (figures: unknown[]) => ({
    role: 'FACILITY_MANAGER',
    facilityId: '11111111-1111-1111-1111-111111111111',
    facilityName: 'Community Health Centre, Ikem',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    generatedAt: '2026-09-14T06:15:00.000Z',
    sections: [{ title: 'Money', figures }],
    caveats: [],
  });

  it('is accepted with well-formed figures', () => {
    expect(dashboardSchema.safeParse(dashboard([figure()])).success).toBe(true);
  });

  it('fails as a whole if any single figure is bare', () => {
    // The property that matters: one careless figure fails the request rather
    // than rendering beside well-formed ones, where nobody would notice it.
    const bare = { key: 'total', label: 'Total', value: 100 };

    expect(dashboardSchema.safeParse(dashboard([figure(), bare])).success).toBe(false);
  });

  it('requires at least one section, so an empty page cannot pass for a dashboard', () => {
    expect(
      dashboardSchema.safeParse({ ...dashboard([figure()]), sections: [] }).success,
    ).toBe(false);
  });

  it('allows a section with no figures, for a reader whose access reaches none', () => {
    expect(dashboardSchema.safeParse(dashboard([])).success).toBe(true);
  });
});
