import type { ModelAssumptions } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import {
  project,
  requiredWorkingCapitalMinor,
  revenuePerPatientMinor,
  variableCostPerPatientMinor,
} from './projection';

/**
 * A deliberately simple base case, so hand-computed expectations are checkable:
 *   10 patients/day x 20 days = 200 encounters a month
 *   revenue per encounter = 200000 kobo (₦2,000)
 *   -> 40,000,000 kobo (₦400,000) revenue a month
 */
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

describe('revenue per patient', () => {
  it('is the weighted average of the service mix', () => {
    const assumptions = with_({
      serviceLines: [
        { code: 'A', name: 'A', share: 0.7, tariffMinor: 200_000, variableCostRatio: 0 },
        { code: 'B', name: 'B', share: 0.3, tariffMinor: 500_000, variableCostRatio: 0 },
      ],
    });

    // 0.7*200000 + 0.3*500000 = 140000 + 150000
    expect(revenuePerPatientMinor(assumptions)).toBe(290_000);
  });

  it('computes direct cost from each line own ratio, not an average', () => {
    // Pharmacy has a high cost ratio, consultation almost none. Applying one
    // blended ratio would misstate both.
    const assumptions = with_({
      serviceLines: [
        { code: 'CONS', name: 'Consultation', share: 0.5, tariffMinor: 200_000, variableCostRatio: 0.05 },
        { code: 'PHARM', name: 'Pharmacy', share: 0.5, tariffMinor: 400_000, variableCostRatio: 0.6 },
      ],
    });

    // 0.5*200000*0.05 + 0.5*400000*0.6 = 5000 + 120000
    expect(variableCostPerPatientMinor(assumptions)).toBe(125_000);
  });
});

describe('the base projection', () => {
  it('produces one period per month of the horizon', () => {
    expect(project(base).periods).toHaveLength(60);
    expect(project(base, { horizonMonths: 12 }).periods).toHaveLength(12);
  });

  it('computes revenue from patients and the mix', () => {
    const [first] = project(base).periods;
    expect(first?.patients).toBe(200);
    expect(first?.revenueMinor).toBe(40_000_000);
  });

  it('subtracts costs to reach a surplus', () => {
    const [first] = project(base).periods;
    // 40,000,000 - 0 direct - 10,000,000 opex - 20,000,000 staff
    expect(first?.ebitdaMinor).toBe(10_000_000);
    expect(first?.surplusMinor).toBe(10_000_000);
  });

  it('refuses a non-positive horizon rather than returning nothing', () => {
    expect(() => project(base, { horizonMonths: 0 })).toThrow(RangeError);
  });
});

describe('growth and inflation compound annually', () => {
  it('applies growth so that twelve months on equals the annual rate', () => {
    const result = project(with_({ annualGrowthRate: 0.2 }), { horizonMonths: 13 });

    expect(result.periods[0]?.patients).toBeCloseTo(200, 1);
    // Period 12 is exactly one year in: 200 * 1.2
    expect(result.periods[12]?.patients).toBeCloseTo(240, 1);
  });

  it('does NOT treat the annual rate as a monthly one', () => {
    // The error this guards against: 20% a month compounds to 792% a year.
    const result = project(with_({ annualGrowthRate: 0.2 }), { horizonMonths: 13 });
    expect(result.periods[12]?.patients).toBeLessThan(300);
  });

  it('inflates costs but not tariffs', () => {
    // Tariffs are a negotiated decision, not something that drifts with the
    // price level. Inflating them silently would flatter every projection.
    const result = project(with_({ annualInflationRate: 0.15 }), { horizonMonths: 13 });

    expect(result.periods[12]?.revenueMinor).toBe(result.periods[0]?.revenueMinor);
    expect(result.periods[12]?.opexMinor).toBeGreaterThan(result.periods[0]?.opexMinor ?? 0);
    expect(result.periods[12]?.opexMinor).toBeCloseTo(11_500_000, -3);
  });

  it('can make a profitable facility unprofitable over five years', () => {
    // The single most useful thing this model does: show that a margin which
    // looks fine today does not survive inflation.
    const result = project(with_({ annualInflationRate: 0.25 }));
    const last = result.periods.at(-1);

    expect(result.periods[0]?.surplusMinor).toBeGreaterThan(0);
    expect(last?.surplusMinor).toBeLessThan(0);
  });
});

describe('revenue that will never be collected', () => {
  it('charges the uncollectable share as a cost in the period it is billed', () => {
    // 92% collection on 40,000,000 kobo leaves 3,200,000 that never arrives.
    const result = project(with_({ collectionRate: 0.92 }), { horizonMonths: 3 });

    expect(result.periods[0]?.badDebtMinor).toBe(3_200_000);
  });

  it('charges nothing when everything is collected', () => {
    expect(project(base, { horizonMonths: 3 }).periods[0]?.badDebtMinor).toBe(0);
  });

  it('keeps it out of surplus, so surplus is not money that never arrives', () => {
    // Without this, a facility collecting 92% would report five years of
    // surplus containing 8% of revenue it never saw — and a partnership that
    // shares surplus would distribute against uncollected billings.
    const full = project(base, { horizonMonths: 12 });
    const partial = project(with_({ collectionRate: 0.92 }), { horizonMonths: 12 });

    const uncollected = full.totalRevenueMinor - Math.round(full.totalRevenueMinor * 0.92);

    expect(partial.totalSurplusMinor).toBe(full.totalSurplusMinor - uncollected);
  });

  it('does not reduce reported revenue, which is what was actually billed', () => {
    // Netting it into revenue would hide the loss instead of stating it.
    const full = project(base, { horizonMonths: 12 });
    const partial = project(with_({ collectionRate: 0.92 }), { horizonMonths: 12 });

    expect(partial.totalRevenueMinor).toBe(full.totalRevenueMinor);
  });

  it('pays no incentive on revenue that will never arrive', () => {
    // 40,000,000 billed, 4,000,000 never collected, 30,000,000 of costs
    // leaves 6,000,000 to share — not 7,000,000.
    const result = project(
      with_({ collectionRate: 0.9, incentivePoolRate: 0.2 }),
      { horizonMonths: 3 },
    );

    const period = result.periods[0]!;

    expect(period.badDebtMinor).toBe(4_000_000);
    expect(period.incentiveMinor).toBe(1_200_000);
  });

  it('moves break-even later, not earlier', () => {
    // The direction matters: a model that collects less must not look better.
    const full = project(base);
    const partial = project(with_({ collectionRate: 0.6 }));

    expect(full.breakEvenPeriod).not.toBeNull();
    expect(partial.breakEvenPeriod === null || partial.breakEvenPeriod > full.breakEvenPeriod!).toBe(true);
  });

  it('leaves the collection LAG a timing difference, not a loss', () => {
    // A ninety-day lag with full collection loses nothing; it only delays cash.
    const lagged = project(with_({ collectionLagDays: 90 }), { horizonMonths: 12 });

    expect(lagged.periods.every((period) => period.badDebtMinor === 0)).toBe(true);
    expect(lagged.totalSurplusMinor).toBe(project(base, { horizonMonths: 12 }).totalSurplusMinor);
  });

  it('keeps it an integer number of kobo', () => {
    const result = project(with_({ collectionRate: 0.923 }), { horizonMonths: 12 });

    for (const period of result.periods) {
      expect(Number.isInteger(period.badDebtMinor)).toBe(true);
    }
  });
});

describe('collections and cash', () => {
  it('collects in the same period when there is no lag', () => {
    const [first] = project(base).periods;
    expect(first?.collectionsMinor).toBe(first?.revenueMinor);
  });

  it('delays cash by the collection lag', () => {
    const result = project(with_({ collectionLagDays: 60 }), { horizonMonths: 6 });

    // Two months of revenue earned before any cash arrives.
    expect(result.periods[0]?.collectionsMinor).toBe(0);
    expect(result.periods[1]?.collectionsMinor).toBe(0);
    expect(result.periods[2]?.collectionsMinor).toBe(40_000_000);
  });

  it('collects only what the collection rate allows', () => {
    const result = project(with_({ collectionRate: 0.8 }), { horizonMonths: 3 });
    expect(result.periods[0]?.collectionsMinor).toBe(32_000_000);
  });

  it('keeps revenue and cash distinct', () => {
    // Conflating them is the most common spreadsheet error, and it hides
    // exactly the month a facility runs out of money.
    const result = project(with_({ collectionRate: 0.7, collectionLagDays: 30 }), { horizonMonths: 6 });
    const period = result.periods[3];

    expect(period?.revenueMinor).toBe(40_000_000);
    expect(period?.collectionsMinor).toBe(28_000_000);
  });

  it('excludes depreciation from cash, because it is not a cash cost', () => {
    const withCapex = project(
      with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 120_000_000 }] }),
      { horizonMonths: 24 },
    );

    const period = withCapex.periods[12];
    expect(period?.depreciationMinor).toBeGreaterThan(0);

    // Cash moves by collections less cash costs only.
    const previous = withCapex.periods[11]!;
    const expectedCash =
      previous.cashBalanceMinor +
      period!.collectionsMinor -
      (period!.directCostMinor + period!.opexMinor + period!.staffCostMinor + period!.incentiveMinor) -
      period!.capexMinor;

    expect(period?.cashBalanceMinor).toBe(expectedCash);
  });

  it('reports the lowest cash point, which is what working capital must cover', () => {
    const result = project(
      with_({ collectionLagDays: 90, capexSchedule: [{ periodIndex: 0, amountMinor: 50_000_000 }] }),
      { horizonMonths: 12 },
    );

    expect(result.lowestCashMinor).toBeLessThan(0);
    expect(requiredWorkingCapitalMinor(result)).toBe(Math.abs(result.lowestCashMinor));
  });

  it('requires no working capital when cash never goes negative', () => {
    expect(requiredWorkingCapitalMinor(project(base))).toBe(0);
  });
});

describe('incentives', () => {
  it('pays a share of surplus', () => {
    const [first] = project(with_({ incentivePoolRate: 0.2 })).periods;
    // Surplus before incentive is 10,000,000
    expect(first?.incentiveMinor).toBe(2_000_000);
    expect(first?.ebitdaMinor).toBe(8_000_000);
  });

  it('pays NOTHING in a loss-making month', () => {
    // Tying incentives to surplus is the whole point; paying them out of a
    // loss would make the pool a fixed cost wearing a performance label.
    const result = project(with_({ incentivePoolRate: 0.2, staffMonthlyCostMinor: 60_000_000 }));

    expect(result.periods[0]?.surplusMinor).toBeLessThan(0);
    expect(result.periods[0]?.incentiveMinor).toBe(0);
  });
});

describe('break-even and payback', () => {
  it('finds break-even when cumulative surplus turns positive', () => {
    // Loses 5m a month for the first year, then the capex stops dragging.
    const result = project(
      with_({ staffMonthlyCostMinor: 25_000_000, capexSchedule: [{ periodIndex: 0, amountMinor: 60_000_000 }] }),
    );

    expect(result.breakEvenPeriod).not.toBeNull();
    expect(result.periods[result.breakEvenPeriod!]?.cumulativeSurplusMinor).toBeGreaterThanOrEqual(0);
  });

  it('returns NULL when a facility never breaks even, rather than inventing a month', () => {
    // The most important assertion in this file. A fabricated break-even month
    // would be the most misleading number this system could produce.
    const result = project(with_({ staffMonthlyCostMinor: 200_000_000 }));

    expect(result.breakEvenPeriod).toBeNull();
    expect(result.totalSurplusMinor).toBeLessThan(0);
  });

  it('returns NULL for payback when the investment is never recovered', () => {
    const result = project(
      with_({
        staffMonthlyCostMinor: 39_000_000,
        capexSchedule: [{ periodIndex: 0, amountMinor: 5_000_000_000 }],
      }),
    );

    expect(result.paybackPeriod).toBeNull();
  });

  it('finds payback once cumulative net cash covers the investment', () => {
    const result = project(with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 50_000_000 }] }));

    expect(result.paybackPeriod).not.toBeNull();
    // 50m investment, 10m surplus a month -> around month five.
    expect(result.paybackPeriod).toBeGreaterThanOrEqual(4);
    expect(result.paybackPeriod).toBeLessThanOrEqual(6);
  });

  it('counts working capital as part of the investment to be recovered', () => {
    const withoutWc = project(with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 50_000_000 }] }));
    const withWc = project(
      with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 50_000_000 }], workingCapitalMinor: 50_000_000 }),
    );

    expect(withWc.totalInvestmentMinor).toBe(100_000_000);
    expect(withWc.paybackPeriod).toBeGreaterThan(withoutWc.paybackPeriod!);
  });

  it('never reports break-even in period zero', () => {
    // A facility is not "already break-even" before it has traded a month.
    expect(project(base).breakEvenPeriod).not.toBe(0);
  });
});

describe('depreciation', () => {
  it('starts the period AFTER the spend, not in it', () => {
    const result = project(
      with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 120_000_000 }], depreciationYears: 10 }),
      { horizonMonths: 6 },
    );

    expect(result.periods[0]?.depreciationMinor).toBe(0);
    expect(result.periods[1]?.depreciationMinor).toBe(1_000_000);
  });

  it('stops once the asset is fully written down', () => {
    const result = project(
      with_({ capexSchedule: [{ periodIndex: 0, amountMinor: 12_000_000 }], depreciationYears: 1 }),
      { horizonMonths: 24 },
    );

    expect(result.periods[12]?.depreciationMinor).toBe(1_000_000);
    expect(result.periods[13]?.depreciationMinor).toBe(0);
  });

  it('accumulates across several purchases', () => {
    const result = project(
      with_({
        capexSchedule: [
          { periodIndex: 0, amountMinor: 120_000_000 },
          { periodIndex: 6, amountMinor: 120_000_000 },
        ],
        depreciationYears: 10,
      }),
      { horizonMonths: 12 },
    );

    expect(result.periods[3]?.depreciationMinor).toBe(1_000_000);
    expect(result.periods[9]?.depreciationMinor).toBe(2_000_000);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    expect(JSON.stringify(project(base))).toBe(JSON.stringify(project(base)));
  });

  it('classifies every projection as PROJECTED', () => {
    // It can never be promoted. This is a model of what might happen; the
    // ledger records what did.
    expect(project(base).classification).toBe('PROJECTED');
  });

  it('keeps every monetary figure an integer', () => {
    // Money is integer minor units end to end (ADR 0003). A float here would
    // drift and eventually fail to reconcile against the ledger.
    for (const period of project(base).periods) {
      expect(Number.isInteger(period.revenueMinor)).toBe(true);
      expect(Number.isInteger(period.surplusMinor)).toBe(true);
      expect(Number.isInteger(period.cashBalanceMinor)).toBe(true);
      expect(Number.isInteger(period.incentiveMinor)).toBe(true);
    }
  });

  it('keeps cumulative surplus equal to the sum of the periods', () => {
    const result = project(with_({ annualGrowthRate: 0.1, annualInflationRate: 0.12 }));
    const summed = result.periods.reduce((total, period) => total + period.surplusMinor, 0);

    expect(result.periods.at(-1)?.cumulativeSurplusMinor).toBe(summed);
    expect(result.totalSurplusMinor).toBe(summed);
  });
});
