import type { ModelAssumptions, ProjectionPeriod, ProjectionResult } from '@chc/contracts';

/**
 * The five-year financial model (spec §34, doc 12 §7).
 *
 * Pure: no I/O, no ambient clock, no randomness. The same assumptions always
 * produce the same 60 periods, which is what lets a partnership be negotiated
 * on these numbers and re-checked a year later.
 *
 * Every output is classified PROJECTED and can never be promoted. This is a
 * model of what might happen; the ledger records what did.
 *
 * All money is integer minor units throughout (ADR 0003). Rounding happens at
 * exactly one point per calculation, and never accumulates.
 */

export interface ProjectionOptions {
  /** Months to project. 60 = five years (assumption A3). */
  horizonMonths?: number;
}

const DEFAULT_HORIZON = 60;

export function project(
  assumptions: ModelAssumptions,
  options: ProjectionOptions = {},
): ProjectionResult {
  const horizon = options.horizonMonths ?? DEFAULT_HORIZON;

  if (horizon <= 0) {
    throw new RangeError('A projection horizon must be at least one month.');
  }

  const revenuePerPatient = revenuePerPatientMinor(assumptions);
  const variableCostPerPatient = variableCostPerPatientMinor(assumptions);

  const capexByPeriod = new Map<number, number>();
  for (const entry of assumptions.capexSchedule) {
    capexByPeriod.set(entry.periodIndex, (capexByPeriod.get(entry.periodIndex) ?? 0) + entry.amountMinor);
  }

  const totalInvestment =
    assumptions.capexSchedule.reduce((sum, entry) => sum + entry.amountMinor, 0) +
    assumptions.workingCapitalMinor;

  /**
   * Monthly depreciation of capitalised spend.
   *
   * Charged from the period AFTER the spend, because an asset bought on the
   * last day of a month has not been used in it. Straight line: anything more
   * sophisticated would imply a precision the inputs do not have.
   */
  const depreciationPerPeriod = (periodIndex: number): number => {
    const monthsOfLife = Math.round(assumptions.depreciationYears * 12);
    let charge = 0;

    for (const entry of assumptions.capexSchedule) {
      const elapsed = periodIndex - entry.periodIndex;
      if (elapsed > 0 && elapsed <= monthsOfLife) {
        charge += Math.round(entry.amountMinor / monthsOfLife);
      }
    }

    return charge;
  };

  /**
   * Revenue billed but not yet collected, released over the lag.
   *
   * Modelled as a simple shift rather than an ageing curve: the lag is itself
   * an estimate, and a curve fitted to it would be false precision. The
   * important behaviour — that cash arrives later than revenue is earned, and
   * that this is what drives the working capital requirement — is preserved.
   */
  const lagMonths = Math.round(assumptions.collectionLagDays / 30);

  const periods: ProjectionPeriod[] = [];
  const billed: number[] = [];

  let cumulativeSurplus = 0;
  let cash = assumptions.openingCashMinor + assumptions.workingCapitalMinor;
  let cumulativeNetCash = 0;

  let breakEvenPeriod: number | null = null;
  let paybackPeriod: number | null = null;
  let lowestCash = cash;
  let lowestCashPeriod = 0;

  let totalRevenue = 0;
  let totalSurplus = 0;

  for (let periodIndex = 0; periodIndex < horizon; periodIndex += 1) {
    // Growth and inflation compound ANNUALLY, applied monthly. Using the
    // twelfth root rather than dividing by twelve, because 1% a month is 12.7%
    // a year, not 12%, and over five years that error is 40%.
    const years = periodIndex / 12;
    const growthFactor = (1 + assumptions.annualGrowthRate) ** years;
    const inflationFactor = (1 + assumptions.annualInflationRate) ** years;

    const patients = assumptions.patientsPerDay * assumptions.operatingDaysPerMonth * growthFactor;

    const revenue = Math.round(patients * revenuePerPatient);
    const directCost = Math.round(patients * variableCostPerPatient * inflationFactor);
    const opex = Math.round(assumptions.fixedMonthlyCostMinor * inflationFactor);
    const staffCost = Math.round(assumptions.staffMonthlyCostMinor * inflationFactor);

    billed[periodIndex] = revenue;

    // Cash in this period is revenue billed `lagMonths` ago, net of what is
    // never collected at all.
    const billedForCollection = billed[periodIndex - lagMonths] ?? 0;
    const collections = Math.round(billedForCollection * assumptions.collectionRate);

    /**
     * Revenue this facility will never collect, recognised as a cost in the
     * period it is billed.
     *
     * Without this, surplus counts money that the collection rate itself says
     * will never arrive: a facility collecting 92% would show five years of
     * surplus containing 8% of revenue it never sees, break even earlier than
     * it truly does, and — once a partnership shares surplus — distribute
     * against uncollected billings. The collection rate is a loss, not merely
     * a delay; the LAG is the delay, and it is handled separately above.
     */
    const badDebt = revenue - Math.round(revenue * assumptions.collectionRate);

    const beforeIncentive = revenue - badDebt - directCost - opex - staffCost;
    // Incentives are a share of SURPLUS, so a loss-making month pays none —
    // which is the whole point of tying them to performance.
    const incentive = beforeIncentive > 0 ? Math.round(beforeIncentive * assumptions.incentivePoolRate) : 0;

    const ebitda = beforeIncentive - incentive;
    const depreciation = depreciationPerPeriod(periodIndex);
    const surplus = ebitda - depreciation;

    cumulativeSurplus += surplus;
    totalRevenue += revenue;
    totalSurplus += surplus;

    const capex = capexByPeriod.get(periodIndex) ?? 0;

    // Cash movement uses COLLECTIONS, not revenue, and excludes depreciation,
    // which is not a cash cost. Conflating the two is the most common error in
    // a spreadsheet model, and it hides exactly the month a facility runs out
    // of money.
    const cashCosts = directCost + opex + staffCost + incentive;
    cash += collections - cashCosts - capex;
    cumulativeNetCash += collections - cashCosts;

    if (cash < lowestCash) {
      lowestCash = cash;
      lowestCashPeriod = periodIndex;
    }

    if (breakEvenPeriod === null && cumulativeSurplus >= 0 && periodIndex > 0) {
      breakEvenPeriod = periodIndex;
    }

    if (paybackPeriod === null && totalInvestment > 0 && cumulativeNetCash >= totalInvestment) {
      paybackPeriod = periodIndex;
    }

    periods.push({
      periodIndex,
      patients: round(patients, 2),
      revenueMinor: revenue,
      collectionsMinor: collections,
      badDebtMinor: badDebt,
      directCostMinor: directCost,
      opexMinor: opex,
      staffCostMinor: staffCost,
      incentiveMinor: incentive,
      depreciationMinor: depreciation,
      ebitdaMinor: ebitda,
      surplusMinor: surplus,
      cumulativeSurplusMinor: cumulativeSurplus,
      capexMinor: capex,
      cashBalanceMinor: cash,
    });
  }

  return {
    periods,
    // Null, never a fabricated month. A model that never breaks even must say
    // so plainly — this is the single most misleading number the system could
    // invent.
    breakEvenPeriod,
    paybackPeriod,
    totalInvestmentMinor: totalInvestment,
    totalRevenueMinor: totalRevenue,
    totalSurplusMinor: totalSurplus,
    lowestCashMinor: lowestCash,
    lowestCashPeriod,
    classification: 'PROJECTED',
  };
}

/** Weighted average revenue per encounter, from the service mix. */
export function revenuePerPatientMinor(assumptions: ModelAssumptions): number {
  return assumptions.serviceLines.reduce((sum, line) => sum + line.share * line.tariffMinor, 0);
}

/** Weighted average direct cost per encounter. */
export function variableCostPerPatientMinor(assumptions: ModelAssumptions): number {
  return assumptions.serviceLines.reduce(
    (sum, line) => sum + line.share * line.tariffMinor * line.variableCostRatio,
    0,
  );
}

/**
 * The working capital a facility actually needs.
 *
 * Derived from the model rather than guessed: it is the deepest the cash
 * balance goes, which is the amount that must be available before opening for
 * the facility not to run out. Returns 0 when the balance never goes negative.
 */
export function requiredWorkingCapitalMinor(result: ProjectionResult): number {
  return result.lowestCashMinor < 0 ? Math.abs(result.lowestCashMinor) : 0;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
