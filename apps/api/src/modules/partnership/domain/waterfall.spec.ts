import { describe, expect, it } from 'vitest';

import {
  capitalPosition,
  computeWaterfall,
  summariseByParty,
  WaterfallConfigurationError,
  type LedgerTotals,
  type WaterfallStepConfig,
} from './waterfall';

const NOW = new Date('2026-09-14T10:00:00.000Z');

/**
 * One month, chosen so every figure below can be checked by hand:
 *
 *   gross revenue      100,000,000 kobo   (₦1,000,000)
 *   direct costs        30,000,000
 *   operating expenses  40,000,000
 *   operating surplus   30,000,000
 */
const totals: LedgerTotals = {
  grossRevenueMinor: 100_000_000,
  directCostMinor: 30_000_000,
  operatingExpenseMinor: 40_000_000,
};

const GOV = '11111111-1111-1111-1111-111111111111';
const PARTNER = '22222222-2222-2222-2222-222222222222';
const COMMUNITY = '33333333-3333-3333-3333-333333333333';

const allocation = (result: ReturnType<typeof computeWaterfall>, sequence: number) =>
  result.allocations.find((entry) => entry.sequence === sequence)!;

// -----------------------------------------------------------------------------
// The three configurations the roadmap requires, against hand-computed figures
// -----------------------------------------------------------------------------

describe('a surplus-share waterfall', () => {
  /**
   *  1  staff incentives      10% of surplus, capped at 2,000,000
   *  2  maintenance reserve   10% of surplus, floor of 5,000,000
   *  3  government            40% of surplus
   *  4  capital recovery      sweep, capped at outstanding capital
   *  5  partner return        50% of what is left
   *  6  reinvestment          the remainder
   */
  const steps: WaterfallStepConfig[] = [
    { sequence: 1, label: 'Staff incentives', basis: 'OPERATING_SURPLUS', rate: 0.1, capMinor: 2_000_000 },
    { sequence: 2, label: 'Maintenance reserve', basis: 'OPERATING_SURPLUS', rate: 0.1, floorMinor: 5_000_000 },
    { sequence: 3, label: 'Government entitlement', basis: 'OPERATING_SURPLUS', rate: 0.4, beneficiaryPartyId: GOV },
    { sequence: 4, label: 'Partner capital recovery', basis: 'RESIDUAL', rate: null, isCapitalRecovery: true, beneficiaryPartyId: PARTNER },
    { sequence: 5, label: 'Partner return', basis: 'RESIDUAL', rate: 0.5, beneficiaryPartyId: PARTNER },
    { sequence: 6, label: 'Reinvestment', basis: 'RESIDUAL', rate: null },
  ];

  const result = computeWaterfall(totals, steps, NOW, { outstandingRecoveryMinor: 8_000_000 });

  it('derives the surplus from the ledger, not from a stored figure', () => {
    expect(result.operatingSurplusMinor).toBe(30_000_000);
    expect(result.distributableMinor).toBe(30_000_000);
    expect(result.isLoss).toBe(false);
  });

  it('applies the cap on staff incentives', () => {
    // 10% of 30,000,000 is 3,000,000; the cap holds it to 2,000,000.
    expect(allocation(result, 1).calculatedMinor).toBe(3_000_000);
    expect(allocation(result, 1).allocatedMinor).toBe(2_000_000);
    expect(allocation(result, 1).capApplied).toBe(true);
  });

  it('lifts the maintenance reserve to its floor', () => {
    // 10% of 30,000,000 is 3,000,000; the floor lifts it to 5,000,000.
    expect(allocation(result, 2).calculatedMinor).toBe(3_000_000);
    expect(allocation(result, 2).allocatedMinor).toBe(5_000_000);
    expect(allocation(result, 2).floorApplied).toBe(true);
  });

  it('computes the government entitlement from the surplus, not from what is left', () => {
    // 40% of the 30,000,000 SURPLUS, not of the 23,000,000 remaining — the
    // difference is 2,800,000 kobo of somebody else's money.
    expect(allocation(result, 3).allocatedMinor).toBe(12_000_000);
  });

  it('caps capital recovery at what the partner is still owed', () => {
    // 11,000,000 remains, but only 8,000,000 is outstanding.
    expect(allocation(result, 4).calculatedMinor).toBe(11_000_000);
    expect(allocation(result, 4).allocatedMinor).toBe(8_000_000);
    expect(allocation(result, 4).capApplied).toBe(true);
  });

  it('shares what is left after recovery', () => {
    expect(allocation(result, 5).allocatedMinor).toBe(1_500_000);
    expect(allocation(result, 6).allocatedMinor).toBe(1_500_000);
  });

  it('distributes the surplus exactly, to the kobo', () => {
    expect(result.totalAllocatedMinor).toBe(30_000_000);
    expect(result.residualMinor).toBe(0);
    expect(result.totalShortfallMinor).toBe(0);
  });
});

describe('a gross-revenue-share waterfall', () => {
  const steps: WaterfallStepConfig[] = [
    { sequence: 1, label: 'Government share of gross revenue', basis: 'GROSS_REVENUE', rate: 0.05, beneficiaryPartyId: GOV },
    { sequence: 2, label: 'Partner', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
  ];

  const result = computeWaterfall(totals, steps, NOW);

  it('pays the government a share of everything billed, not of the surplus', () => {
    // 5% of 100,000,000 gross = 5,000,000, which is more than 5% of the
    // 30,000,000 surplus would have been. That is the whole point of the
    // arrangement, and getting the basis wrong would quietly underpay.
    expect(allocation(result, 1).allocatedMinor).toBe(5_000_000);
  });

  it('still cannot pay out more than the facility actually made', () => {
    expect(result.totalAllocatedMinor).toBe(30_000_000);
    expect(result.residualMinor).toBe(0);
  });

  it('leaves the partner the remainder', () => {
    expect(allocation(result, 2).allocatedMinor).toBe(25_000_000);
  });

  it('reports a shortfall when a gross share exceeds the surplus', () => {
    // A thin month: 5% of gross is more than the whole surplus.
    const thin = computeWaterfall(
      { grossRevenueMinor: 100_000_000, directCostMinor: 45_000_000, operatingExpenseMinor: 52_000_000 },
      steps,
      NOW,
    );

    expect(thin.operatingSurplusMinor).toBe(3_000_000);
    expect(allocation(thin, 1).calculatedMinor).toBe(5_000_000);
    expect(allocation(thin, 1).allocatedMinor).toBe(3_000_000);
    expect(allocation(thin, 1).shortfallMinor).toBe(2_000_000);
    expect(thin.totalShortfallMinor).toBe(2_000_000);
  });
});

describe('a hybrid waterfall', () => {
  const steps: WaterfallStepConfig[] = [
    { sequence: 1, label: 'Management fee', basis: 'GROSS_REVENUE', rate: 0.03, beneficiaryPartyId: PARTNER },
    { sequence: 2, label: 'Government entitlement', basis: 'OPERATING_SURPLUS', rate: 0.35, beneficiaryPartyId: GOV },
    { sequence: 3, label: 'Community health fund', basis: 'FIXED', fixedAmountMinor: 1_000_000, beneficiaryPartyId: COMMUNITY },
    { sequence: 4, label: 'Partner', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
  ];

  const result = computeWaterfall(totals, steps, NOW);

  it('mixes bases within one agreement', () => {
    expect(allocation(result, 1).allocatedMinor).toBe(3_000_000); // 3% of gross
    expect(allocation(result, 2).allocatedMinor).toBe(10_500_000); // 35% of surplus
    expect(allocation(result, 3).allocatedMinor).toBe(1_000_000); // fixed
    expect(allocation(result, 4).allocatedMinor).toBe(15_500_000); // the rest
  });

  it('conserves the surplus exactly', () => {
    expect(result.totalAllocatedMinor + result.residualMinor).toBe(result.distributableMinor);
  });

  it('adds up per party across the steps that name them', () => {
    const byParty = summariseByParty(result);

    expect(byParty.find((p) => p.partyId === PARTNER)?.allocatedMinor).toBe(18_500_000);
    expect(byParty.find((p) => p.partyId === GOV)?.allocatedMinor).toBe(10_500_000);
    expect(byParty.find((p) => p.partyId === COMMUNITY)?.allocatedMinor).toBe(1_000_000);
  });
});

// -----------------------------------------------------------------------------
// The months nobody wants but every facility has
// -----------------------------------------------------------------------------

describe('a loss-making month', () => {
  const steps: WaterfallStepConfig[] = [
    { sequence: 1, label: 'Government entitlement', basis: 'OPERATING_SURPLUS', rate: 0.4, beneficiaryPartyId: GOV },
    { sequence: 2, label: 'Guaranteed community fund', basis: 'FIXED', fixedAmountMinor: 1_000_000, floorMinor: 1_000_000, beneficiaryPartyId: COMMUNITY },
    { sequence: 3, label: 'Partner', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
  ];

  const loss: LedgerTotals = {
    grossRevenueMinor: 50_000_000,
    directCostMinor: 30_000_000,
    operatingExpenseMinor: 50_000_000,
  };

  const result = computeWaterfall(loss, steps, NOW);

  it('says plainly that there was a loss', () => {
    expect(result.operatingSurplusMinor).toBe(-30_000_000);
    expect(result.isLoss).toBe(true);
  });

  it('distributes nothing, rather than distributing a negative', () => {
    // A negative allocation would read as though a party owed money back,
    // which is not what any of these agreements say.
    expect(result.distributableMinor).toBe(0);
    expect(result.totalAllocatedMinor).toBe(0);
    expect(result.allocations.every((entry) => entry.allocatedMinor === 0)).toBe(true);
  });

  it('does not turn a share of a loss into a negative entitlement', () => {
    expect(allocation(result, 1).calculatedMinor).toBe(0);
  });

  it('shows the guaranteed payment as unpaid rather than pretending it was made', () => {
    expect(allocation(result, 2).calculatedMinor).toBe(1_000_000);
    expect(allocation(result, 2).allocatedMinor).toBe(0);
    expect(allocation(result, 2).shortfallMinor).toBe(1_000_000);
  });
});

describe('a month with no revenue at all', () => {
  const result = computeWaterfall(
    { grossRevenueMinor: 0, directCostMinor: 0, operatingExpenseMinor: 0 },
    [
      { sequence: 1, label: 'Government', basis: 'OPERATING_SURPLUS', rate: 0.4, beneficiaryPartyId: GOV },
      { sequence: 2, label: 'Partner', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
    ],
    NOW,
  );

  it('is not a loss, and distributes nothing', () => {
    expect(result.isLoss).toBe(false);
    expect(result.distributableMinor).toBe(0);
    expect(result.totalAllocatedMinor).toBe(0);
    expect(result.residualMinor).toBe(0);
  });
});

describe('caps and floors', () => {
  it('refuses a floor above a cap instead of choosing one', () => {
    // There is no amount that satisfies both. Picking either silently would
    // hand one party money the other was promised.
    expect(() =>
      computeWaterfall(totals, [
        { sequence: 1, label: 'Impossible', basis: 'OPERATING_SURPLUS', rate: 0.1, capMinor: 1_000_000, floorMinor: 2_000_000 },
      ], NOW),
    ).toThrow(WaterfallConfigurationError);
  });

  it('allows a floor equal to its cap, which is simply a fixed entitlement', () => {
    const result = computeWaterfall(totals, [
      { sequence: 1, label: 'Exactly this much', basis: 'OPERATING_SURPLUS', rate: 0.01, capMinor: 2_000_000, floorMinor: 2_000_000 },
      { sequence: 2, label: 'Partner', basis: 'RESIDUAL', rate: null },
    ], NOW);

    expect(allocation(result, 1).allocatedMinor).toBe(2_000_000);
  });

  it('pays a floor only as far as the money goes, and reports the rest', () => {
    const result = computeWaterfall(
      { grossRevenueMinor: 100_000_000, directCostMinor: 60_000_000, operatingExpenseMinor: 39_000_000 },
      [{ sequence: 1, label: 'Guaranteed reserve', basis: 'OPERATING_SURPLUS', rate: 0.1, floorMinor: 5_000_000 }],
      NOW,
    );

    expect(result.distributableMinor).toBe(1_000_000);
    expect(allocation(result, 1).allocatedMinor).toBe(1_000_000);
    expect(allocation(result, 1).shortfallMinor).toBe(4_000_000);
  });

  it('applies a cap of zero as a real cap, not as an absent one', () => {
    // A suspended entitlement is configured as a zero cap. Treating 0 as "no
    // cap" would pay it in full.
    const result = computeWaterfall(totals, [
      { sequence: 1, label: 'Suspended incentive', basis: 'OPERATING_SURPLUS', rate: 0.1, capMinor: 0 },
      { sequence: 2, label: 'Partner', basis: 'RESIDUAL', rate: null },
    ], NOW);

    expect(allocation(result, 1).allocatedMinor).toBe(0);
    expect(allocation(result, 2).allocatedMinor).toBe(30_000_000);
  });
});

describe('capital recovery', () => {
  const steps: WaterfallStepConfig[] = [
    { sequence: 1, label: 'Government', basis: 'OPERATING_SURPLUS', rate: 0.4, beneficiaryPartyId: GOV },
    { sequence: 2, label: 'Capital recovery', basis: 'RESIDUAL', rate: null, isCapitalRecovery: true, beneficiaryPartyId: PARTNER },
    { sequence: 3, label: 'Partner return', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
  ];

  it('recovers in full when the month covers what is outstanding', () => {
    const result = computeWaterfall(totals, steps, NOW, { outstandingRecoveryMinor: 5_000_000 });

    expect(allocation(result, 2).allocatedMinor).toBe(5_000_000);
    expect(allocation(result, 3).allocatedMinor).toBe(13_000_000);
  });

  it('recovers only what the month allows when it does not', () => {
    const result = computeWaterfall(totals, steps, NOW, { outstandingRecoveryMinor: 50_000_000 });

    expect(allocation(result, 2).allocatedMinor).toBe(18_000_000);
    expect(allocation(result, 3).allocatedMinor).toBe(0);
  });

  it('stops recovering once the partner has been repaid', () => {
    const result = computeWaterfall(totals, steps, NOW, { outstandingRecoveryMinor: 0 });

    expect(allocation(result, 2).allocatedMinor).toBe(0);
    expect(allocation(result, 3).allocatedMinor).toBe(18_000_000);
  });

  it('does not let a second recovery step recover the same capital twice', () => {
    // The outstanding balance falls as the first step takes from it.
    const twice = computeWaterfall(
      totals,
      [
        { sequence: 1, label: 'Recovery A', basis: 'RESIDUAL', rate: 0.2, isCapitalRecovery: true, beneficiaryPartyId: PARTNER },
        { sequence: 2, label: 'Recovery B', basis: 'RESIDUAL', rate: null, isCapitalRecovery: true, beneficiaryPartyId: PARTNER },
        { sequence: 3, label: 'Partner return', basis: 'RESIDUAL', rate: null, beneficiaryPartyId: PARTNER },
      ],
      NOW,
      { outstandingRecoveryMinor: 10_000_000 },
    );

    expect(allocation(twice, 1).allocatedMinor).toBe(6_000_000);
    expect(allocation(twice, 2).allocatedMinor).toBe(4_000_000);
    expect(allocation(twice, 1).allocatedMinor + allocation(twice, 2).allocatedMinor).toBe(10_000_000);
  });

  it('respects a fixed cap tighter than the outstanding balance', () => {
    const result = computeWaterfall(
      totals,
      [
        { sequence: 1, label: 'Capital recovery', basis: 'RESIDUAL', rate: null, isCapitalRecovery: true, capMinor: 3_000_000 },
        { sequence: 2, label: 'Partner', basis: 'RESIDUAL', rate: null },
      ],
      NOW,
      { outstandingRecoveryMinor: 20_000_000 },
    );

    expect(allocation(result, 1).allocatedMinor).toBe(3_000_000);
  });

  it('never recovers more than was invested, even with a generous fixed cap', () => {
    const result = computeWaterfall(
      totals,
      [{ sequence: 1, label: 'Capital recovery', basis: 'RESIDUAL', rate: null, isCapitalRecovery: true, capMinor: 99_000_000 }],
      NOW,
      { outstandingRecoveryMinor: 4_000_000 },
    );

    expect(allocation(result, 1).allocatedMinor).toBe(4_000_000);
  });
});

describe('the capital position', () => {
  it('sums the append-only recovery ledger', () => {
    const position = capitalPosition([
      { eventType: 'INVESTMENT', amountMinor: 50_000_000 },
      { eventType: 'INVESTMENT', amountMinor: 30_000_000 },
      { eventType: 'RECOVERY', amountMinor: 20_000_000 },
      { eventType: 'RETURN', amountMinor: 5_000_000 },
    ]);

    expect(position.investedMinor).toBe(80_000_000);
    expect(position.recoveredMinor).toBe(20_000_000);
    expect(position.returnPaidMinor).toBe(5_000_000);
    expect(position.outstandingMinor).toBe(60_000_000);
    expect(position.recoveredProportion).toBeCloseTo(0.25, 10);
    expect(position.fullyRecovered).toBe(false);
  });

  it('does not count a return against the capital outstanding', () => {
    // A return is profit, not repayment. Netting it off would let a partner
    // extinguish their capital balance with their own share of the surplus.
    const position = capitalPosition([
      { eventType: 'INVESTMENT', amountMinor: 10_000_000 },
      { eventType: 'RETURN', amountMinor: 10_000_000 },
    ]);

    expect(position.outstandingMinor).toBe(10_000_000);
    expect(position.fullyRecovered).toBe(false);
  });

  it('reports nothing invested as null, not as fully recovered', () => {
    // "100% recovered" of nothing is a sentence that would reach a report.
    const position = capitalPosition([]);

    expect(position.recoveredProportion).toBeNull();
    expect(position.fullyRecovered).toBe(false);
    expect(position.outstandingMinor).toBe(0);
  });

  it('does not report a negative outstanding if more was recovered than invested', () => {
    const position = capitalPosition([
      { eventType: 'INVESTMENT', amountMinor: 10_000_000 },
      { eventType: 'RECOVERY', amountMinor: 12_000_000 },
    ]);

    expect(position.outstandingMinor).toBe(0);
    expect(position.fullyRecovered).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Properties that must hold for any configuration at all
// -----------------------------------------------------------------------------

describe('invariants', () => {
  const configurations: Array<{ name: string; steps: WaterfallStepConfig[] }> = [
    {
      name: 'rates summing to more than the whole',
      steps: [
        { sequence: 1, label: 'A', basis: 'OPERATING_SURPLUS', rate: 0.6 },
        { sequence: 2, label: 'B', basis: 'OPERATING_SURPLUS', rate: 0.6 },
        { sequence: 3, label: 'C', basis: 'RESIDUAL', rate: null },
      ],
    },
    {
      name: 'rates summing to less than the whole',
      steps: [
        { sequence: 1, label: 'A', basis: 'OPERATING_SURPLUS', rate: 0.2 },
        { sequence: 2, label: 'B', basis: 'GROSS_REVENUE', rate: 0.01 },
      ],
    },
    {
      name: 'a fixed amount larger than the surplus',
      steps: [{ sequence: 1, label: 'A', basis: 'FIXED', fixedAmountMinor: 900_000_000 }],
    },
    {
      name: 'awkward rates that do not divide evenly',
      steps: [
        { sequence: 1, label: 'A', basis: 'OPERATING_SURPLUS', rate: 1 / 3 },
        { sequence: 2, label: 'B', basis: 'OPERATING_SURPLUS', rate: 1 / 3 },
        { sequence: 3, label: 'C', basis: 'RESIDUAL', rate: null },
      ],
    },
  ];

  const ledgers: LedgerTotals[] = [
    totals,
    { grossRevenueMinor: 1, directCostMinor: 0, operatingExpenseMinor: 0 },
    { grossRevenueMinor: 99_999_999, directCostMinor: 33_333_333, operatingExpenseMinor: 33_333_333 },
    { grossRevenueMinor: 7, directCostMinor: 3, operatingExpenseMinor: 3 },
  ];

  it('never distributes more or less than there is', () => {
    for (const { name, steps } of configurations) {
      for (const ledger of ledgers) {
        const result = computeWaterfall(ledger, steps, NOW, { outstandingRecoveryMinor: 1_000_000 });

        expect(result.totalAllocatedMinor + result.residualMinor, name).toBe(result.distributableMinor);
      }
    }
  });

  it('never allocates a negative amount', () => {
    for (const { name, steps } of configurations) {
      for (const ledger of ledgers) {
        const result = computeWaterfall(ledger, steps, NOW);

        for (const entry of result.allocations) {
          expect(entry.allocatedMinor, `${name} / ${entry.label}`).toBeGreaterThanOrEqual(0);
          expect(entry.shortfallMinor, `${name} / ${entry.label}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('keeps every allocation a whole number of kobo', () => {
    for (const { steps } of configurations) {
      for (const ledger of ledgers) {
        const result = computeWaterfall(ledger, steps, NOW);

        for (const entry of result.allocations) {
          expect(Number.isInteger(entry.allocatedMinor)).toBe(true);
        }
      }
    }
  });

  it('never leaves the remaining balance negative', () => {
    for (const { steps } of configurations) {
      for (const ledger of ledgers) {
        const result = computeWaterfall(ledger, steps, NOW);

        for (const entry of result.allocations) {
          expect(entry.remainingMinor).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('is deterministic', () => {
    const steps = configurations[0].steps;

    expect(computeWaterfall(totals, steps, NOW)).toEqual(computeWaterfall(totals, steps, NOW));
  });

  it('runs steps in sequence order however they arrive', () => {
    const steps: WaterfallStepConfig[] = [
      { sequence: 3, label: 'C', basis: 'RESIDUAL', rate: null },
      { sequence: 1, label: 'A', basis: 'OPERATING_SURPLUS', rate: 0.5 },
      { sequence: 2, label: 'B', basis: 'RESIDUAL', rate: 0.5 },
    ];

    const result = computeWaterfall(totals, steps, NOW);

    expect(result.allocations.map((entry) => entry.label)).toEqual(['A', 'B', 'C']);
    expect(allocation(result, 1).allocatedMinor).toBe(15_000_000);
    expect(allocation(result, 2).allocatedMinor).toBe(7_500_000);
  });

  it('stamps the injected clock, not the wall clock', () => {
    expect(computeWaterfall(totals, configurations[1].steps, NOW).computedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('labels the result ACTUAL, because it comes from posted entries', () => {
    expect(computeWaterfall(totals, configurations[1].steps, NOW).classification).toBe('ACTUAL');
  });
});

describe('configuration that cannot be honoured', () => {
  it('refuses two steps sharing a sequence', () => {
    expect(() =>
      computeWaterfall(totals, [
        { sequence: 1, label: 'A', basis: 'RESIDUAL', rate: 0.5 },
        { sequence: 1, label: 'B', basis: 'RESIDUAL', rate: 0.5 },
      ], NOW),
    ).toThrow(/share sequence 1/);
  });

  it('refuses a percentage step with no percentage', () => {
    expect(() =>
      computeWaterfall(totals, [{ sequence: 1, label: 'A', basis: 'OPERATING_SURPLUS' }], NOW),
    ).toThrow(/needs a rate/);
  });

  it('refuses a fixed step with no amount', () => {
    expect(() =>
      computeWaterfall(totals, [{ sequence: 1, label: 'A', basis: 'FIXED' }], NOW),
    ).toThrow(/states none/);
  });

  it('refuses negative ledger totals', () => {
    // A credit note posted as a negative revenue would otherwise flip the
    // arithmetic and produce a plausible, wrong distribution.
    expect(() =>
      computeWaterfall({ grossRevenueMinor: -1, directCostMinor: 0, operatingExpenseMinor: 0 }, [], NOW),
    ).toThrow(/cannot be negative/);
  });

  it('refuses fractional kobo', () => {
    expect(() =>
      computeWaterfall({ grossRevenueMinor: 10.5, directCostMinor: 0, operatingExpenseMinor: 0 }, [], NOW),
    ).toThrow(/whole number of minor units/);
  });

  it('accepts a waterfall with no steps, leaving everything undistributed', () => {
    // Not an error: a partnership under negotiation has no agreed steps yet,
    // and the honest answer is that nothing is allocated.
    const result = computeWaterfall(totals, [], NOW);

    expect(result.allocations).toEqual([]);
    expect(result.residualMinor).toBe(30_000_000);
  });
});
