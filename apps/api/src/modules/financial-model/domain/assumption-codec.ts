import type { ModelAssumptions, ServiceLine } from '@chc/contracts';

/**
 * Between stored assumption rows and the model's input set.
 *
 * Every input the projection reads is ONE `model_assumption` row — including
 * each service line's tariff and share. That is deliberate: an assumption row
 * is the unit that carries a rationale, can be locked when the model is
 * approved, and produces an impact preview when changed (spec §72). A tariff
 * bundled inside a JSON blob would have none of those properties, and tariffs
 * are exactly what gets renegotiated.
 *
 * Pure, and it fails loudly. A missing assumption is never defaulted to zero:
 * a model silently projecting no staff costs because a row was lost would be a
 * fabrication of the worst kind (spec §82).
 */

export const SCALAR_ASSUMPTIONS = [
  'patientsPerDay',
  'operatingDaysPerMonth',
  'annualGrowthRate',
  'annualInflationRate',
  'fixedMonthlyCostMinor',
  'staffMonthlyCostMinor',
  'incentivePoolRate',
  'collectionRate',
  'collectionLagDays',
  'workingCapitalMinor',
  'openingCashMinor',
  'depreciationYears',
] as const;

export type ScalarAssumption = (typeof SCALAR_ASSUMPTIONS)[number];

/** Inputs that must be whole minor units or whole counts. */
const INTEGER_ASSUMPTIONS = new Set<ScalarAssumption>([
  'fixedMonthlyCostMinor',
  'staffMonthlyCostMinor',
  'workingCapitalMinor',
  'openingCashMinor',
]);

export const SCALAR_LABELS: Record<ScalarAssumption, { label: string; unit: string }> = {
  patientsPerDay: { label: 'Patients per day', unit: 'patients/day' },
  operatingDaysPerMonth: { label: 'Operating days per month', unit: 'days/month' },
  annualGrowthRate: { label: 'Annual growth in patient volume', unit: 'proportion/year' },
  annualInflationRate: { label: 'Annual cost inflation', unit: 'proportion/year' },
  fixedMonthlyCostMinor: { label: 'Fixed monthly operating costs', unit: 'kobo/month' },
  staffMonthlyCostMinor: { label: 'Monthly staff costs', unit: 'kobo/month' },
  incentivePoolRate: { label: 'Staff incentive pool', unit: 'proportion of surplus' },
  collectionRate: { label: 'Proportion of billed revenue collected', unit: 'proportion' },
  collectionLagDays: { label: 'Average collection lag', unit: 'days' },
  workingCapitalMinor: { label: 'Working capital provided at start', unit: 'kobo' },
  openingCashMinor: { label: 'Opening cash balance', unit: 'kobo' },
  depreciationYears: { label: 'Depreciation period', unit: 'years' },
};

export interface AssumptionRow {
  code: string;
  label: string;
  numericValue: number;
  unit?: string | null;
  rationale?: string | null;
  isLocked?: boolean;
}

const SERVICE_LINE_PATTERN = /^serviceLine\.([A-Za-z0-9_-]+)\.(share|tariffMinor|variableCostRatio)$/;
const CAPEX_PATTERN = /^capex\.(\d+)\.amountMinor$/;

export class AssumptionDecodeError extends Error {
  constructor(
    message: string,
    readonly missingCodes: string[] = [],
  ) {
    super(message);
    this.name = 'AssumptionDecodeError';
  }
}

/** Row codes for one service line, so callers do not build strings by hand. */
export function serviceLineCodes(lineCode: string): {
  share: string;
  tariffMinor: string;
  variableCostRatio: string;
} {
  return {
    share: `serviceLine.${lineCode}.share`,
    tariffMinor: `serviceLine.${lineCode}.tariffMinor`,
    variableCostRatio: `serviceLine.${lineCode}.variableCostRatio`,
  };
}

export function capexCode(periodIndex: number): string {
  return `capex.${periodIndex}.amountMinor`;
}

/** Flatten an input set into rows, one per number the projection reads. */
export function encodeAssumptions(assumptions: ModelAssumptions): AssumptionRow[] {
  const rows: AssumptionRow[] = SCALAR_ASSUMPTIONS.map((code) => ({
    code,
    label: SCALAR_LABELS[code].label,
    unit: SCALAR_LABELS[code].unit,
    numericValue: assumptions[code],
  }));

  for (const line of assumptions.serviceLines) {
    const codes = serviceLineCodes(line.code);
    rows.push(
      { code: codes.share, label: `${line.name} — share of encounters`, unit: 'proportion', numericValue: line.share },
      { code: codes.tariffMinor, label: `${line.name} — tariff`, unit: 'kobo', numericValue: line.tariffMinor },
      {
        code: codes.variableCostRatio,
        label: `${line.name} — direct cost ratio`,
        unit: 'proportion of tariff',
        numericValue: line.variableCostRatio,
      },
    );
  }

  for (const entry of assumptions.capexSchedule) {
    rows.push({
      code: capexCode(entry.periodIndex),
      label: entry.label ?? `Capital spend in month ${entry.periodIndex}`,
      unit: 'kobo',
      numericValue: entry.amountMinor,
    });
  }

  return rows;
}

/**
 * Rebuild the input set from stored rows.
 *
 * Throws when anything the projection needs is absent. The alternative —
 * substituting a default — produces a plausible-looking five-year projection
 * built on a number nobody chose.
 */
export function decodeAssumptions(rows: readonly AssumptionRow[]): ModelAssumptions {
  const byCode = new Map(rows.map((row) => [row.code, row]));

  const missing = SCALAR_ASSUMPTIONS.filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw new AssumptionDecodeError(
      `This model cannot be projected: ${missing.length} assumption(s) are missing — ${missing.join(', ')}. ` +
        'Supply them before computing a scenario.',
      [...missing],
    );
  }

  const scalar = (code: ScalarAssumption): number => {
    const value = byCode.get(code)!.numericValue;
    if (!Number.isFinite(value)) {
      throw new AssumptionDecodeError(`Assumption "${code}" is not a finite number.`, [code]);
    }
    if (INTEGER_ASSUMPTIONS.has(code) && !Number.isInteger(value)) {
      // Money is integer minor units everywhere (ADR 0003). A fractional kobo
      // here would round differently in every period it touched.
      throw new AssumptionDecodeError(`Assumption "${code}" must be a whole number of minor units.`, [code]);
    }
    return value;
  };

  // Service lines, assembled from whichever line codes appear.
  const lineParts = new Map<string, { name: string; share?: number; tariffMinor?: number; variableCostRatio?: number }>();

  for (const row of rows) {
    const match = SERVICE_LINE_PATTERN.exec(row.code);
    if (!match) continue;

    const [, lineCode, field] = match;
    const part = lineParts.get(lineCode) ?? { name: lineCode };
    // The label carries the human name: "Consultation — share of encounters".
    if (field === 'share') part.name = row.label.split('—')[0].trim() || lineCode;
    part[field as 'share' | 'tariffMinor' | 'variableCostRatio'] = row.numericValue;
    lineParts.set(lineCode, part);
  }

  if (lineParts.size === 0) {
    throw new AssumptionDecodeError(
      'This model has no service lines, so there is nothing to project revenue from. ' +
        'Add at least one service line with a share and a tariff.',
    );
  }

  const serviceLines: ServiceLine[] = [];
  for (const [code, part] of [...lineParts].sort(([a], [b]) => a.localeCompare(b))) {
    const incomplete = (['share', 'tariffMinor'] as const).filter((field) => part[field] === undefined);
    if (incomplete.length > 0) {
      throw new AssumptionDecodeError(
        `Service line "${code}" is incomplete: ${incomplete.join(' and ')} not set.`,
        incomplete.map((field) => serviceLineCodes(code)[field]),
      );
    }

    serviceLines.push({
      code,
      name: part.name,
      share: part.share!,
      tariffMinor: part.tariffMinor!,
      // A line with no stated direct cost costs nothing to deliver — which is
      // a real position (a consultation by salaried staff), not a missing value.
      variableCostRatio: part.variableCostRatio ?? 0,
    });
  }

  const capexSchedule = rows
    .flatMap((row) => {
      const match = CAPEX_PATTERN.exec(row.code);
      return match ? [{ periodIndex: Number(match[1]), amountMinor: row.numericValue, label: row.label }] : [];
    })
    .sort((a, b) => a.periodIndex - b.periodIndex);

  return {
    patientsPerDay: scalar('patientsPerDay'),
    operatingDaysPerMonth: scalar('operatingDaysPerMonth'),
    serviceLines,
    annualGrowthRate: scalar('annualGrowthRate'),
    annualInflationRate: scalar('annualInflationRate'),
    fixedMonthlyCostMinor: scalar('fixedMonthlyCostMinor'),
    staffMonthlyCostMinor: scalar('staffMonthlyCostMinor'),
    incentivePoolRate: scalar('incentivePoolRate'),
    collectionRate: scalar('collectionRate'),
    collectionLagDays: scalar('collectionLagDays'),
    capexSchedule,
    workingCapitalMinor: scalar('workingCapitalMinor'),
    openingCashMinor: scalar('openingCashMinor'),
    depreciationYears: scalar('depreciationYears'),
  };
}

/**
 * Produce the input set with one assumption replaced.
 *
 * Used by the change-impact preview, which must answer "what would this do?"
 * without writing anything.
 */
export function withAssumption(
  rows: readonly AssumptionRow[],
  code: string,
  value: number,
): ModelAssumptions {
  return decodeAssumptions(rows.map((row) => (row.code === code ? { ...row, numericValue: value } : row)));
}

/** Whether a code is one this model recognises — checked before any write. */
export function isKnownAssumptionCode(code: string): boolean {
  return (
    (SCALAR_ASSUMPTIONS as readonly string[]).includes(code) ||
    SERVICE_LINE_PATTERN.test(code) ||
    CAPEX_PATTERN.test(code)
  );
}

/**
 * The dependency key for an assumption code, for the impact preview.
 *
 * Service-line and capex rows map onto the structural keys the dependency map
 * declares, so `serviceLine.CONS.tariffMinor` reports the same consequences as
 * the service mix as a whole.
 */
export function dependencyKeyFor(code: string): string {
  if (SERVICE_LINE_PATTERN.test(code)) return 'serviceLines';
  if (CAPEX_PATTERN.test(code)) return 'capexSchedule';
  return code;
}
