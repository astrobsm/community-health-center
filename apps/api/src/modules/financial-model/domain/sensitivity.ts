import type { ChangeImpact, ModelAssumptions, SensitivityResult } from '@chc/contracts';

import { project, type ProjectionOptions } from './projection';

/**
 * Sensitivity and change impact (spec §§34, 72).
 *
 * Both answer the same underlying question — "if this number is wrong, how
 * wrong is the conclusion?" — which is the only honest way to present a
 * five-year projection built on estimates.
 *
 * Pure, like the projection itself: the clock is injected.
 */

/** Drivers worth varying. Each is a single scalar an arguable case rests on. */
export const SENSITIVITY_DRIVERS = [
  'patientsPerDay',
  'annualGrowthRate',
  'annualInflationRate',
  'collectionRate',
  'fixedMonthlyCostMinor',
  'staffMonthlyCostMinor',
  'tariffs',
] as const;

export type SensitivityDriver = (typeof SENSITIVITY_DRIVERS)[number];

const VARIATIONS = [-0.3, -0.2, -0.1, 0.1, 0.2, 0.3];

export const DRIVER_LABEL: Record<SensitivityDriver, string> = {
  patientsPerDay: 'Patients per day',
  annualGrowthRate: 'Annual growth',
  annualInflationRate: 'Annual inflation',
  collectionRate: 'Collection rate',
  fixedMonthlyCostMinor: 'Fixed monthly costs',
  staffMonthlyCostMinor: 'Staff costs',
  tariffs: 'Tariffs',
};

/**
 * Apply a proportional change to one driver.
 *
 * `collectionRate` is clamped to 1: a facility cannot collect 130% of what it
 * billed, and letting the sensitivity run produce that would make the upside
 * case fictional.
 */
export function varyDriver(
  assumptions: ModelAssumptions,
  driver: SensitivityDriver,
  variation: number,
): ModelAssumptions {
  const factor = 1 + variation;

  switch (driver) {
    case 'patientsPerDay':
      return { ...assumptions, patientsPerDay: assumptions.patientsPerDay * factor };

    case 'annualGrowthRate':
      return { ...assumptions, annualGrowthRate: assumptions.annualGrowthRate * factor };

    case 'annualInflationRate':
      return { ...assumptions, annualInflationRate: assumptions.annualInflationRate * factor };

    case 'collectionRate':
      return { ...assumptions, collectionRate: Math.min(1, assumptions.collectionRate * factor) };

    case 'fixedMonthlyCostMinor':
      return {
        ...assumptions,
        fixedMonthlyCostMinor: Math.round(assumptions.fixedMonthlyCostMinor * factor),
      };

    case 'staffMonthlyCostMinor':
      return {
        ...assumptions,
        staffMonthlyCostMinor: Math.round(assumptions.staffMonthlyCostMinor * factor),
      };

    case 'tariffs':
      return {
        ...assumptions,
        serviceLines: assumptions.serviceLines.map((line) => ({
          ...line,
          tariffMinor: Math.round(line.tariffMinor * factor),
        })),
      };
  }
}

/**
 * One-at-a-time sensitivity.
 *
 * Deliberately NOT a Monte Carlo simulation. A distribution over inputs nobody
 * has measured produces a confidence interval that looks authoritative and
 * means nothing. "If patient volume is 20% lower, break-even moves from month
 * 14 to month 31" is a sentence a facility manager can argue with.
 */
export function analyseSensitivity(
  assumptions: ModelAssumptions,
  now: Date,
  options: ProjectionOptions = {},
): SensitivityResult {
  const baseResult = project(assumptions, options);

  const entries = SENSITIVITY_DRIVERS.flatMap((driver) =>
    VARIATIONS.map((variation) => {
      const result = project(varyDriver(assumptions, driver, variation), options);

      return {
        driver,
        variation,
        breakEvenPeriod: result.breakEvenPeriod,
        paybackPeriod: result.paybackPeriod,
        totalSurplusMinor: result.totalSurplusMinor,
        surplusDelta:
          baseResult.totalSurplusMinor === 0
            ? null
            : (result.totalSurplusMinor - baseResult.totalSurplusMinor) /
              Math.abs(baseResult.totalSurplusMinor),
      };
    }),
  );

  // Rank by the widest swing in five-year surplus across the variations. These
  // are the assumptions worth negotiating hardest.
  const spreadByDriver = new Map<string, number>();
  for (const driver of SENSITIVITY_DRIVERS) {
    const forDriver = entries.filter((entry) => entry.driver === driver);
    const surpluses = forDriver.map((entry) => entry.totalSurplusMinor);
    spreadByDriver.set(driver, Math.max(...surpluses) - Math.min(...surpluses));
  }

  const mostSensitiveDrivers = [...spreadByDriver.entries()]
    .filter(([, spread]) => spread > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([driver]) => driver);

  return {
    base: {
      breakEvenPeriod: baseResult.breakEvenPeriod,
      paybackPeriod: baseResult.paybackPeriod,
      totalSurplusMinor: baseResult.totalSurplusMinor,
    },
    entries,
    mostSensitiveDrivers,
    computedAt: now.toISOString(),
  };
}

/**
 * Which outputs an assumption affects.
 *
 * Declared rather than inferred, so a new output cannot be added without
 * stating what it depends on — that is what keeps the impact preview from
 * quietly going out of date (doc 12 §8).
 */
export const ASSUMPTION_DEPENDENCIES: Record<string, string[]> = {
  patientsPerDay: ['revenue', 'surplus', 'breakEven', 'payback', 'cash'],
  operatingDaysPerMonth: ['revenue', 'surplus', 'breakEven', 'payback', 'cash'],
  serviceLines: ['revenue', 'directCost', 'surplus', 'breakEven', 'payback', 'cash'],
  annualGrowthRate: ['revenue', 'surplus', 'breakEven', 'payback', 'cash'],
  annualInflationRate: ['opex', 'surplus', 'breakEven', 'payback', 'cash'],
  fixedMonthlyCostMinor: ['opex', 'surplus', 'breakEven', 'payback', 'cash'],
  staffMonthlyCostMinor: ['opex', 'surplus', 'breakEven', 'payback', 'cash'],
  incentivePoolRate: ['surplus', 'breakEven', 'cash'],
  collectionRate: ['cash', 'payback', 'workingCapital'],
  collectionLagDays: ['cash', 'payback', 'workingCapital'],
  capexSchedule: ['payback', 'cash', 'depreciation', 'surplus'],
  workingCapitalMinor: ['payback', 'cash'],
  openingCashMinor: ['cash', 'workingCapital'],
  depreciationYears: ['surplus', 'breakEven'],
};

interface OutputDefinition {
  key: string;
  label: string;
  unit: string;
  read: (result: ReturnType<typeof project>) => number | null;
}

const OUTPUTS: OutputDefinition[] = [
  { key: 'revenue', label: 'Five-year revenue', unit: 'NGN', read: (r) => r.totalRevenueMinor },
  { key: 'surplus', label: 'Five-year operating surplus', unit: 'NGN', read: (r) => r.totalSurplusMinor },
  { key: 'breakEven', label: 'Break-even month', unit: 'month', read: (r) => r.breakEvenPeriod },
  { key: 'payback', label: 'Payback month', unit: 'month', read: (r) => r.paybackPeriod },
  { key: 'cash', label: 'Lowest cash balance', unit: 'NGN', read: (r) => r.lowestCashMinor },
  {
    key: 'workingCapital',
    label: 'Working capital required',
    unit: 'NGN',
    read: (r) => (r.lowestCashMinor < 0 ? Math.abs(r.lowestCashMinor) : 0),
  },
];

/**
 * What changing one assumption would do, BEFORE it is applied (spec §72).
 *
 * The point is that nobody discovers the consequence afterwards. Changing a
 * consultation tariff moves the government's entitlement and the partner's
 * payback date, and the person making the change should see that first.
 */
export function previewChange(params: {
  assumptions: ModelAssumptions;
  assumptionCode: string;
  label: string;
  before: number;
  after: number;
  /** Produces the assumption set with the change applied. */
  apply: (assumptions: ModelAssumptions, value: number) => ModelAssumptions;
  isApproved: boolean;
  now: Date;
  options?: ProjectionOptions;
}): ChangeImpact {
  const baseResult = project(params.assumptions, params.options);
  const changedResult = project(params.apply(params.assumptions, params.after), params.options);

  const affected = new Set(ASSUMPTION_DEPENDENCIES[params.assumptionCode] ?? OUTPUTS.map((o) => o.key));

  const impacts = OUTPUTS.filter((output) => affected.has(output.key)).map((output) => {
    const before = output.read(baseResult);
    const after = output.read(changedResult);

    // A break-even that existed and no longer does is the most consequential
    // change this preview can show, so it is called out explicitly rather than
    // rendered as a null.
    let warning: string | undefined;
    if (before !== null && after === null) {
      warning = `${output.label} no longer occurs within the horizon.`;
    } else if (before === null && after !== null) {
      warning = `${output.label} now occurs, where previously it did not.`;
    } else if (output.key === 'cash' && (after ?? 0) < 0 && (before ?? 0) >= 0) {
      warning = 'The facility would run out of cash under this assumption.';
    }

    return {
      output: output.key,
      label: output.label,
      before,
      after,
      unit: output.unit,
      changeRatio:
        before === null || after === null || before === 0 ? null : (after - before) / Math.abs(before),
      ...(warning ? { warning } : {}),
    };
  });

  return {
    assumptionCode: params.assumptionCode,
    label: params.label,
    before: params.before,
    after: params.after,
    impacts,
    requiresUnlock: params.isApproved,
    computedAt: params.now.toISOString(),
  };
}
