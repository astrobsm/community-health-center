import type { ModelAssumptions } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import { project } from './projection';
import {
  analyseSensitivity,
  ASSUMPTION_DEPENDENCIES,
  previewChange,
  SENSITIVITY_DRIVERS,
  varyDriver,
} from './sensitivity';

/** Same base case as the projection tests, so figures stay hand-checkable. */
const base: ModelAssumptions = {
  patientsPerDay: 10,
  operatingDaysPerMonth: 20,
  serviceLines: [{ code: 'CONS', name: 'Consultation', share: 1, tariffMinor: 200_000, variableCostRatio: 0 }],
  annualGrowthRate: 0,
  annualInflationRate: 0,
  fixedMonthlyCostMinor: 10_000_000,
  staffMonthlyCostMinor: 20_000_000,
  incentivePoolRate: 0,
  collectionRate: 1,
  collectionLagDays: 0,
  capexSchedule: [],
  workingCapitalMinor: 0,
  openingCashMinor: 0,
  depreciationYears: 10,
};

const with_ = (overrides: Partial<ModelAssumptions>): ModelAssumptions => ({ ...base, ...overrides });

const NOW = new Date('2026-09-14T10:00:00.000Z');

describe('varyDriver', () => {
  it('scales patient volume proportionally', () => {
    expect(varyDriver(base, 'patientsPerDay', 0.2).patientsPerDay).toBeCloseTo(12, 10);
    expect(varyDriver(base, 'patientsPerDay', -0.3).patientsPerDay).toBeCloseTo(7, 10);
  });

  it('scales every tariff, leaving the mix shares alone', () => {
    const assumptions = with_({
      serviceLines: [
        { code: 'A', name: 'A', share: 0.6, tariffMinor: 100_000, variableCostRatio: 0.1 },
        { code: 'B', name: 'B', share: 0.4, tariffMinor: 300_000, variableCostRatio: 0.5 },
      ],
    });

    const varied = varyDriver(assumptions, 'tariffs', 0.1);

    expect(varied.serviceLines.map((line) => line.tariffMinor)).toEqual([110_000, 330_000]);
    expect(varied.serviceLines.map((line) => line.share)).toEqual([0.6, 0.4]);
    expect(varied.serviceLines.map((line) => line.variableCostRatio)).toEqual([0.1, 0.5]);
  });

  it('never lets the collection rate exceed 1', () => {
    // A facility cannot collect 117% of what it billed. Allowing it would make
    // the optimistic case fictional rather than merely optimistic.
    const assumptions = with_({ collectionRate: 0.9 });

    expect(varyDriver(assumptions, 'collectionRate', 0.3).collectionRate).toBe(1);
  });

  it('still varies a collection rate that stays below 1', () => {
    const assumptions = with_({ collectionRate: 0.5 });

    expect(varyDriver(assumptions, 'collectionRate', 0.2).collectionRate).toBeCloseTo(0.6, 10);
    expect(varyDriver(assumptions, 'collectionRate', -0.2).collectionRate).toBeCloseTo(0.4, 10);
  });

  it('keeps money in integer minor units', () => {
    // 10,000,003 * 1.13 would be fractional kobo without rounding.
    const varied = varyDriver(with_({ fixedMonthlyCostMinor: 10_000_003 }), 'fixedMonthlyCostMinor', 0.13);

    expect(Number.isInteger(varied.fixedMonthlyCostMinor)).toBe(true);
  });

  it('does not mutate the assumptions it is given', () => {
    const assumptions = with_({});
    const snapshot = JSON.stringify(assumptions);

    varyDriver(assumptions, 'tariffs', 0.3);
    varyDriver(assumptions, 'patientsPerDay', -0.3);

    expect(JSON.stringify(assumptions)).toBe(snapshot);
  });

  it('varies each declared driver to a different result', () => {
    // Guards against a driver being declared but silently unhandled — the
    // switch would fall through and return the assumptions unchanged.
    for (const driver of SENSITIVITY_DRIVERS) {
      const assumptions = with_({
        annualGrowthRate: 0.1,
        annualInflationRate: 0.1,
        collectionRate: 0.8,
      });

      expect(varyDriver(assumptions, driver, 0.2), driver).not.toEqual(assumptions);
    }
  });
});

describe('analyseSensitivity', () => {
  it('runs six variations for every driver', () => {
    const result = analyseSensitivity(base, NOW);

    expect(result.entries).toHaveLength(SENSITIVITY_DRIVERS.length * 6);
    for (const driver of SENSITIVITY_DRIVERS) {
      expect(result.entries.filter((entry) => entry.driver === driver)).toHaveLength(6);
    }
  });

  it('varies one driver at a time and leaves the rest at base', () => {
    // The whole point of one-at-a-time: the -10% patients run must differ from
    // base on exactly that axis, so a -10% revenue result is attributable.
    const result = analyseSensitivity(base, NOW, { horizonMonths: 12 });
    const entry = result.entries.find((e) => e.driver === 'patientsPerDay' && e.variation === -0.1);

    const expected = project(varyDriver(base, 'patientsPerDay', -0.1), { horizonMonths: 12 });

    expect(entry?.totalSurplusMinor).toBe(expected.totalSurplusMinor);
  });

  it('reports the unchanged base case alongside the variations', () => {
    const result = analyseSensitivity(base, NOW);
    const baseResult = project(base);

    expect(result.base.totalSurplusMinor).toBe(baseResult.totalSurplusMinor);
    expect(result.base.breakEvenPeriod).toBe(baseResult.breakEvenPeriod);
    expect(result.base.paybackPeriod).toBe(baseResult.paybackPeriod);
  });

  it('shows fewer patients making a marginal facility lose money', () => {
    // Base: 200 encounters x 200,000 kobo = 40,000,000 revenue against
    // 30,000,000 of costs. At -30% volume the month runs at a loss.
    const result = analyseSensitivity(base, NOW, { horizonMonths: 12 });

    const down = result.entries.find((e) => e.driver === 'patientsPerDay' && e.variation === -0.3);
    const up = result.entries.find((e) => e.driver === 'patientsPerDay' && e.variation === 0.3);

    expect(down!.totalSurplusMinor).toBeLessThan(0);
    expect(up!.totalSurplusMinor).toBeGreaterThan(result.base.totalSurplusMinor);
  });

  it('reports break-even as null in a variation that never reaches it', () => {
    const result = analyseSensitivity(base, NOW, { horizonMonths: 12 });
    const down = result.entries.find((e) => e.driver === 'patientsPerDay' && e.variation === -0.3);

    expect(down!.breakEvenPeriod).toBeNull();
  });

  it('expresses each variation as a proportion of the base surplus', () => {
    const result = analyseSensitivity(base, NOW, { horizonMonths: 12 });
    const entry = result.entries.find((e) => e.driver === 'patientsPerDay' && e.variation === 0.3)!;

    const expectedDelta =
      (entry.totalSurplusMinor - result.base.totalSurplusMinor) / Math.abs(result.base.totalSurplusMinor);

    expect(entry.surplusDelta).toBeCloseTo(expectedDelta, 10);
  });

  it('leaves the delta null rather than dividing by a zero base', () => {
    // A facility exactly at break-even has no proportional change to report.
    // Infinity rendered as a percentage would be nonsense on a proposal.
    const breakEven = with_({ fixedMonthlyCostMinor: 20_000_000, staffMonthlyCostMinor: 20_000_000 });

    const result = analyseSensitivity(breakEven, NOW, { horizonMonths: 12 });

    expect(result.base.totalSurplusMinor).toBe(0);
    expect(result.entries.every((entry) => entry.surplusDelta === null)).toBe(true);
  });

  it('ranks drivers by how far they move the five-year surplus', () => {
    const result = analyseSensitivity(base, NOW);

    // With zero variable cost, revenue moves one-for-one with volume and with
    // tariffs, while inflation at 0% cannot move anything at all.
    expect(result.mostSensitiveDrivers[0]).toBe('patientsPerDay');
    expect(result.mostSensitiveDrivers).toContain('tariffs');
  });

  it('omits drivers that cannot move the result at all', () => {
    // Inflation of 0% scaled by 30% is still 0%. Listing it as a sensitivity
    // would invite someone to negotiate a number that changes nothing.
    const result = analyseSensitivity(base, NOW);

    expect(result.mostSensitiveDrivers).not.toContain('annualInflationRate');
    expect(result.mostSensitiveDrivers).not.toContain('annualGrowthRate');
  });

  it('does list inflation once there is inflation to vary', () => {
    const result = analyseSensitivity(with_({ annualInflationRate: 0.2 }), NOW);

    expect(result.mostSensitiveDrivers).toContain('annualInflationRate');
  });

  it('stamps the injected clock, not the wall clock', () => {
    expect(analyseSensitivity(base, NOW).computedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('is deterministic', () => {
    expect(analyseSensitivity(base, NOW)).toEqual(analyseSensitivity(base, NOW));
  });

  it('keeps every reported surplus an integer', () => {
    const result = analyseSensitivity(base, NOW);

    for (const entry of result.entries) {
      expect(Number.isInteger(entry.totalSurplusMinor), `${entry.driver} ${entry.variation}`).toBe(true);
    }
  });
});

describe('previewChange', () => {
  const setTariff = (assumptions: ModelAssumptions, value: number): ModelAssumptions => ({
    ...assumptions,
    serviceLines: assumptions.serviceLines.map((line) => ({ ...line, tariffMinor: value })),
  });

  const setFixedCost = (assumptions: ModelAssumptions, value: number): ModelAssumptions => ({
    ...assumptions,
    fixedMonthlyCostMinor: value,
  });

  it('shows before and after for every affected output', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'serviceLines',
      label: 'Consultation tariff',
      before: 200_000,
      after: 250_000,
      apply: setTariff,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 12 },
    });

    const revenue = impact.impacts.find((line) => line.output === 'revenue')!;

    // 200 encounters a month, twelve months.
    expect(revenue.before).toBe(200 * 200_000 * 12);
    expect(revenue.after).toBe(200 * 250_000 * 12);
    expect(revenue.changeRatio).toBeCloseTo(0.25, 10);
  });

  it('reports only the outputs the assumption can actually affect', () => {
    // A dependency map that over-reports would show a column of unchanged
    // numbers and teach people to ignore the preview.
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'depreciationYears',
      label: 'Depreciation period',
      before: 10,
      after: 5,
      apply: (assumptions, value) => ({ ...assumptions, depreciationYears: value }),
      isApproved: false,
      now: NOW,
    });

    const outputs = impact.impacts.map((line) => line.output);

    expect(outputs).toEqual(['surplus', 'breakEven']);
  });

  it('falls back to every output for an assumption it has no map for', () => {
    // Failing open here is the safe direction: showing too much is a nuisance,
    // hiding a consequence is the thing this feature exists to prevent.
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'somethingAddedLater',
      label: 'Unknown',
      before: 1,
      after: 2,
      apply: (assumptions) => assumptions,
      isApproved: false,
      now: NOW,
    });

    expect(impact.impacts).toHaveLength(6);
  });

  it('warns when a change destroys break-even entirely', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'fixedMonthlyCostMinor',
      label: 'Fixed monthly costs',
      before: 10_000_000,
      after: 40_000_000,
      apply: setFixedCost,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 24 },
    });

    const breakEven = impact.impacts.find((line) => line.output === 'breakEven')!;

    expect(breakEven.before).not.toBeNull();
    expect(breakEven.after).toBeNull();
    expect(breakEven.warning).toMatch(/no longer occurs/);
    expect(breakEven.changeRatio).toBeNull();
  });

  it('says so when a change creates a break-even that did not exist', () => {
    const lossMaking = with_({ fixedMonthlyCostMinor: 40_000_000 });

    const impact = previewChange({
      assumptions: lossMaking,
      assumptionCode: 'fixedMonthlyCostMinor',
      label: 'Fixed monthly costs',
      before: 40_000_000,
      after: 10_000_000,
      apply: setFixedCost,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 24 },
    });

    const breakEven = impact.impacts.find((line) => line.output === 'breakEven')!;

    expect(breakEven.before).toBeNull();
    expect(breakEven.after).not.toBeNull();
    expect(breakEven.warning).toMatch(/now occurs/);
  });

  it('warns when the facility would run out of cash', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'fixedMonthlyCostMinor',
      label: 'Fixed monthly costs',
      before: 10_000_000,
      after: 50_000_000,
      apply: setFixedCost,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 12 },
    });

    const cash = impact.impacts.find((line) => line.output === 'cash')!;

    expect(cash.after).toBeLessThan(0);
    expect(cash.warning).toBe('The facility would run out of cash under this assumption.');
  });

  it('does not warn when nothing crossed a threshold', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'serviceLines',
      label: 'Consultation tariff',
      before: 200_000,
      after: 210_000,
      apply: setTariff,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 12 },
    });

    expect(impact.impacts.every((line) => line.warning === undefined)).toBe(true);
  });

  it('flags an approved model as needing an unlock before the change applies', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'serviceLines',
      label: 'Consultation tariff',
      before: 200_000,
      after: 250_000,
      apply: setTariff,
      isApproved: true,
      now: NOW,
    });

    expect(impact.requiresUnlock).toBe(true);
  });

  it('does not require an unlock for a draft model', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'serviceLines',
      label: 'Consultation tariff',
      before: 200_000,
      after: 250_000,
      apply: setTariff,
      isApproved: false,
      now: NOW,
    });

    expect(impact.requiresUnlock).toBe(false);
  });

  it('previews without applying anything', () => {
    // The preview must be safe to run on every keystroke of a proposed edit.
    const assumptions = with_({});
    const snapshot = JSON.stringify(assumptions);

    previewChange({
      assumptions,
      assumptionCode: 'serviceLines',
      label: 'Consultation tariff',
      before: 200_000,
      after: 900_000,
      apply: setTariff,
      isApproved: true,
      now: NOW,
    });

    expect(JSON.stringify(assumptions)).toBe(snapshot);
  });

  it('carries the stated before and after through unchanged', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'fixedMonthlyCostMinor',
      label: 'Fixed monthly costs',
      before: 10_000_000,
      after: 12_000_000,
      apply: setFixedCost,
      isApproved: false,
      now: NOW,
    });

    expect(impact.assumptionCode).toBe('fixedMonthlyCostMinor');
    expect(impact.label).toBe('Fixed monthly costs');
    expect(impact.before).toBe(10_000_000);
    expect(impact.after).toBe(12_000_000);
    expect(impact.computedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('shows no change when the value is the same', () => {
    const impact = previewChange({
      assumptions: base,
      assumptionCode: 'fixedMonthlyCostMinor',
      label: 'Fixed monthly costs',
      before: 10_000_000,
      after: 10_000_000,
      apply: setFixedCost,
      isApproved: false,
      now: NOW,
      options: { horizonMonths: 12 },
    });

    expect(impact.impacts.every((line) => line.before === line.after)).toBe(true);
    expect(impact.impacts.every((line) => line.changeRatio === 0 || line.changeRatio === null)).toBe(true);
  });
});

describe('the assumption dependency map', () => {
  it('names only outputs the preview can actually render', () => {
    // A typo here would silently drop a consequence from the preview.
    const known = new Set([
      'revenue',
      'surplus',
      'breakEven',
      'payback',
      'cash',
      'workingCapital',
      'directCost',
      'opex',
      'depreciation',
    ]);

    for (const [assumption, outputs] of Object.entries(ASSUMPTION_DEPENDENCIES)) {
      for (const output of outputs) {
        expect(known.has(output), `${assumption} -> ${output}`).toBe(true);
      }
    }
  });

  it('covers every assumption the model reads', () => {
    // Every field of ModelAssumptions must declare its consequences, so a new
    // input cannot be added without saying what it affects.
    for (const field of Object.keys(base)) {
      expect(ASSUMPTION_DEPENDENCIES[field], field).toBeDefined();
    }
  });
});
