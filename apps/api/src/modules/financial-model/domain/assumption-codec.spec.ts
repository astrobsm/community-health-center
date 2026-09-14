import type { ModelAssumptions } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import {
  AssumptionDecodeError,
  capexCode,
  decodeAssumptions,
  dependencyKeyFor,
  encodeAssumptions,
  isKnownAssumptionCode,
  SCALAR_ASSUMPTIONS,
  serviceLineCodes,
  withAssumption,
  type AssumptionRow,
} from './assumption-codec';

const base: ModelAssumptions = {
  patientsPerDay: 10,
  operatingDaysPerMonth: 20,
  serviceLines: [
    { code: 'CONS', name: 'Consultation', share: 0.7, tariffMinor: 200_000, variableCostRatio: 0.05 },
    { code: 'PHARM', name: 'Pharmacy', share: 0.3, tariffMinor: 400_000, variableCostRatio: 0.6 },
  ],
  annualGrowthRate: 0.1,
  annualInflationRate: 0.15,
  fixedMonthlyCostMinor: 10_000_000,
  staffMonthlyCostMinor: 20_000_000,
  incentivePoolRate: 0.1,
  collectionRate: 0.9,
  collectionLagDays: 30,
  capexSchedule: [
    { periodIndex: 0, amountMinor: 50_000_000, label: 'Theatre refurbishment' },
    { periodIndex: 6, amountMinor: 20_000_000, label: 'Laboratory equipment' },
  ],
  workingCapitalMinor: 15_000_000,
  openingCashMinor: 0,
  depreciationYears: 10,
};

const rowsFor = (assumptions: ModelAssumptions): AssumptionRow[] => encodeAssumptions(assumptions);

describe('encodeAssumptions', () => {
  it('emits one row per scalar input', () => {
    const codes = rowsFor(base).map((row) => row.code);

    for (const code of SCALAR_ASSUMPTIONS) {
      expect(codes, code).toContain(code);
    }
  });

  it('emits a separate lockable row for every service line number', () => {
    const codes = rowsFor(base).map((row) => row.code);

    expect(codes).toContain('serviceLine.CONS.share');
    expect(codes).toContain('serviceLine.CONS.tariffMinor');
    expect(codes).toContain('serviceLine.CONS.variableCostRatio');
    expect(codes).toContain('serviceLine.PHARM.tariffMinor');
  });

  it('emits a row per capital spend, keyed by the month it falls in', () => {
    const codes = rowsFor(base).map((row) => row.code);

    expect(codes).toContain('capex.0.amountMinor');
    expect(codes).toContain('capex.6.amountMinor');
  });

  it('gives every row a unit, so a stored number is never dimensionless', () => {
    // "0.15" means nothing without "proportion per year" next to it, and a
    // proposal that prints it as a percentage of something else is wrong.
    for (const row of rowsFor(base)) {
      expect(row.unit, row.code).toBeTruthy();
    }
  });

  it('produces unique codes', () => {
    const codes = rowsFor(base).map((row) => row.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('decodeAssumptions', () => {
  it('round-trips an input set unchanged', () => {
    expect(decodeAssumptions(rowsFor(base))).toEqual(base);
  });

  it('round-trips a model with no capital spend at all', () => {
    const noCapex = { ...base, capexSchedule: [] };

    expect(decodeAssumptions(rowsFor(noCapex))).toEqual(noCapex);
  });

  it('refuses to project when an assumption is missing', () => {
    // The alternative — defaulting to zero — would produce a five-year
    // projection with no staff costs that looked entirely plausible.
    const rows = rowsFor(base).filter((row) => row.code !== 'staffMonthlyCostMinor');

    expect(() => decodeAssumptions(rows)).toThrow(AssumptionDecodeError);
    expect(() => decodeAssumptions(rows)).toThrow(/staffMonthlyCostMinor/);
  });

  it('names every missing assumption at once, not just the first', () => {
    const rows = rowsFor(base).filter(
      (row) => row.code !== 'collectionRate' && row.code !== 'depreciationYears',
    );

    try {
      decodeAssumptions(rows);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AssumptionDecodeError).missingCodes).toEqual(['collectionRate', 'depreciationYears']);
    }
  });

  it('refuses a model with no service lines', () => {
    const rows = rowsFor(base).filter((row) => !row.code.startsWith('serviceLine.'));

    expect(() => decodeAssumptions(rows)).toThrow(/no service lines/);
  });

  it('refuses a service line missing its tariff', () => {
    const rows = rowsFor(base).filter((row) => row.code !== 'serviceLine.PHARM.tariffMinor');

    expect(() => decodeAssumptions(rows)).toThrow(/PHARM.*tariffMinor/);
  });

  it('treats an absent cost ratio as a line that costs nothing to deliver', () => {
    // A consultation by salaried staff genuinely has no marginal cost. This is
    // a real position rather than a missing value, so it does not throw.
    const rows = rowsFor(base).filter((row) => row.code !== 'serviceLine.CONS.variableCostRatio');

    const decoded = decodeAssumptions(rows);

    expect(decoded.serviceLines.find((line) => line.code === 'CONS')!.variableCostRatio).toBe(0);
  });

  it('rejects fractional kobo', () => {
    const rows = rowsFor(base).map((row) =>
      row.code === 'fixedMonthlyCostMinor' ? { ...row, numericValue: 10_000_000.5 } : row,
    );

    expect(() => decodeAssumptions(rows)).toThrow(/whole number of minor units/);
  });

  it('rejects a non-finite value rather than projecting NaN through 60 periods', () => {
    const rows = rowsFor(base).map((row) =>
      row.code === 'patientsPerDay' ? { ...row, numericValue: Number.NaN } : row,
    );

    expect(() => decodeAssumptions(rows)).toThrow(/not a finite number/);
  });

  it('allows a fractional rate', () => {
    const rows = rowsFor(base).map((row) =>
      row.code === 'collectionRate' ? { ...row, numericValue: 0.875 } : row,
    );

    expect(decodeAssumptions(rows).collectionRate).toBe(0.875);
  });

  it('recovers the service name from the row label', () => {
    expect(decodeAssumptions(rowsFor(base)).serviceLines.map((line) => line.name)).toEqual([
      'Consultation',
      'Pharmacy',
    ]);
  });

  it('orders service lines deterministically regardless of row order', () => {
    const shuffled = [...rowsFor(base)].reverse();

    expect(decodeAssumptions(shuffled).serviceLines.map((line) => line.code)).toEqual(['CONS', 'PHARM']);
  });

  it('orders capital spend by the month it falls in', () => {
    const shuffled = [...rowsFor(base)].reverse();

    expect(decodeAssumptions(shuffled).capexSchedule.map((entry) => entry.periodIndex)).toEqual([0, 6]);
  });

  it('ignores rows it does not recognise rather than failing the whole model', () => {
    // A code left behind by an older release must not stop a facility
    // producing a projection today.
    const rows = [...rowsFor(base), { code: 'legacy.something', label: 'Legacy', numericValue: 42 }];

    expect(decodeAssumptions(rows)).toEqual(base);
  });
});

describe('withAssumption', () => {
  it('replaces exactly one value and leaves the rest alone', () => {
    const changed = withAssumption(rowsFor(base), 'serviceLine.CONS.tariffMinor', 250_000);

    expect(changed.serviceLines.find((line) => line.code === 'CONS')!.tariffMinor).toBe(250_000);
    expect(changed.serviceLines.find((line) => line.code === 'PHARM')!.tariffMinor).toBe(400_000);
    expect(changed.patientsPerDay).toBe(base.patientsPerDay);
  });

  it('does not mutate the rows it is given', () => {
    const rows = rowsFor(base);
    const snapshot = JSON.stringify(rows);

    withAssumption(rows, 'patientsPerDay', 99);

    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('leaves the set unchanged for a code that is not present', () => {
    expect(withAssumption(rowsFor(base), 'nonexistent', 1)).toEqual(base);
  });
});

describe('code helpers', () => {
  it('recognises the codes it produces', () => {
    for (const row of rowsFor(base)) {
      expect(isKnownAssumptionCode(row.code), row.code).toBe(true);
    }
  });

  it('rejects a code that is not one of ours', () => {
    expect(isKnownAssumptionCode('serviceLine..share')).toBe(false);
    expect(isKnownAssumptionCode('capex.abc.amountMinor')).toBe(false);
    expect(isKnownAssumptionCode('patientsPerWeek')).toBe(false);
  });

  it('maps structured codes onto the dependency key they behave like', () => {
    expect(dependencyKeyFor(serviceLineCodes('CONS').tariffMinor)).toBe('serviceLines');
    expect(dependencyKeyFor(capexCode(3))).toBe('capexSchedule');
    expect(dependencyKeyFor('collectionRate')).toBe('collectionRate');
  });
});
