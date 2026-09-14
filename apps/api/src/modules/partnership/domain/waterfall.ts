import type { WaterfallAllocation, WaterfallBasis, WaterfallResult } from '@chc/contracts';

/**
 * The partnership waterfall (spec §35, doc 12 §9).
 *
 * Pure: no I/O, no ambient clock. The same ledger totals and the same steps
 * always produce the same allocations, which is what allows a government
 * partner to re-check a distribution a year later and get the same answer.
 *
 * No percentage is hard-coded here or anywhere else. Every rate arrives as
 * configuration; this function only knows how to apply an ordered list of
 * rules and how to refuse to invent money.
 *
 * The invariant everything else rests on:
 *
 *     Σ allocations + residual === distributable,    exactly, in kobo
 *
 * It holds by construction: the residual is whatever is left in the pool, not
 * a separately computed figure that might disagree.
 */

export interface WaterfallStepConfig {
  sequence: number;
  label: string;
  basis: WaterfallBasis;
  rate?: number | null;
  fixedAmountMinor?: number | null;
  capMinor?: number | null;
  floorMinor?: number | null;
  isCapitalRecovery?: boolean;
  beneficiaryPartyId?: string | null;
  accountCode?: string | null;
}

export interface LedgerTotals {
  grossRevenueMinor: number;
  directCostMinor: number;
  operatingExpenseMinor: number;
}

export interface WaterfallContext {
  /**
   * The partner's unrecovered capital, as it stands when this period is
   * computed. Caps any step marked `isCapitalRecovery`, because a partner
   * cannot recover more than they are owed and the amount owed falls every
   * time they recover some of it.
   */
  outstandingRecoveryMinor?: number;
  revenueShareModelId?: string | null;
  revenueShareModelVersion?: number | null;
}

export class WaterfallConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaterfallConfigurationError';
  }
}

export function computeWaterfall(
  totals: LedgerTotals,
  steps: readonly WaterfallStepConfig[],
  now: Date,
  context: WaterfallContext = {},
): WaterfallResult {
  assertWholeMinorUnits(totals);

  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);
  assertDistinctSequences(ordered);

  const operatingSurplus =
    totals.grossRevenueMinor - totals.directCostMinor - totals.operatingExpenseMinor;

  // Nobody is entitled to a share of a loss. A negative pool would produce
  // negative "allocations" that read as though a party owed money back, which
  // is not what a revenue share agreement says.
  const isLoss = operatingSurplus < 0;
  const distributable = isLoss ? 0 : operatingSurplus;

  let pool = distributable;
  let outstandingRecovery = context.outstandingRecoveryMinor ?? 0;

  const allocations: WaterfallAllocation[] = [];

  for (const step of ordered) {
    assertStepIsSatisfiable(step);

    const calculated = calculateFor(step, {
      grossRevenue: totals.grossRevenueMinor,
      operatingSurplus,
      pool,
    });

    // Caps and floors are applied to what the rule asked for, before the pool
    // is consulted. That ordering matters: a floor is a promise about the
    // entitlement, not a promise the facility can always keep.
    const cap = effectiveCap(step, outstandingRecovery);
    const floor = step.floorMinor ?? null;

    let wanted = calculated;
    let capApplied = false;
    let floorApplied = false;

    if (cap !== null && wanted > cap) {
      wanted = cap;
      capApplied = true;
    }

    if (floor !== null && wanted < floor) {
      // A floor cannot raise a step above its own cap; the schema refuses that
      // configuration, and this keeps the invariant if one ever slipped past.
      wanted = cap !== null ? Math.min(floor, cap) : floor;
      floorApplied = true;
    }

    // Never more than there is. The gap is reported, never quietly absorbed:
    // a party owed a floor the facility could not pay needs to see that.
    const allocated = Math.max(0, Math.min(wanted, pool));
    const shortfall = Math.max(0, wanted - allocated);

    pool -= allocated;

    if (step.isCapitalRecovery) {
      outstandingRecovery = Math.max(0, outstandingRecovery - allocated);
    }

    allocations.push({
      sequence: step.sequence,
      label: step.label,
      basis: step.basis,
      calculatedMinor: calculated,
      allocatedMinor: allocated,
      shortfallMinor: shortfall,
      capApplied,
      floorApplied,
      beneficiaryPartyId: step.beneficiaryPartyId ?? null,
      accountCode: step.accountCode ?? null,
      remainingMinor: pool,
    });
  }

  const totalAllocated = allocations.reduce((sum, allocation) => sum + allocation.allocatedMinor, 0);

  // Belt and braces. If this ever fails, a distribution has invented or lost
  // money, and failing loudly is the only acceptable outcome.
  if (totalAllocated + pool !== distributable) {
    throw new Error(
      `Waterfall did not conserve: allocated ${totalAllocated} + residual ${pool} != distributable ${distributable}.`,
    );
  }

  return {
    grossRevenueMinor: totals.grossRevenueMinor,
    directCostMinor: totals.directCostMinor,
    operatingExpenseMinor: totals.operatingExpenseMinor,
    operatingSurplusMinor: operatingSurplus,
    distributableMinor: distributable,
    allocations,
    totalAllocatedMinor: totalAllocated,
    residualMinor: pool,
    totalShortfallMinor: allocations.reduce((sum, allocation) => sum + allocation.shortfallMinor, 0),
    isLoss,
    revenueShareModelId: context.revenueShareModelId ?? null,
    revenueShareModelVersion: context.revenueShareModelVersion ?? null,
    // Computed from posted ledger entries, so this is what happened — not a
    // projection. A forecast waterfall is computed from PROJECTED periods and
    // is labelled accordingly by its caller.
    classification: 'ACTUAL',
    computedAt: now.toISOString(),
  };
}

function calculateFor(
  step: WaterfallStepConfig,
  bases: { grossRevenue: number; operatingSurplus: number; pool: number },
): number {
  switch (step.basis) {
    case 'FIXED':
      return step.fixedAmountMinor ?? 0;

    case 'GROSS_REVENUE':
      return Math.round(bases.grossRevenue * (step.rate ?? 0));

    case 'OPERATING_SURPLUS':
      // A share of a negative surplus is not a negative entitlement.
      return bases.operatingSurplus > 0 ? Math.round(bases.operatingSurplus * (step.rate ?? 0)) : 0;

    case 'RESIDUAL':
      // No rate means "sweep whatever is left", which is how a waterfall ends.
      return step.rate === null || step.rate === undefined
        ? Math.max(0, bases.pool)
        : Math.round(Math.max(0, bases.pool) * step.rate);
  }
}

function effectiveCap(step: WaterfallStepConfig, outstandingRecovery: number): number | null {
  if (step.isCapitalRecovery) {
    // The outstanding balance always binds, even when a looser fixed cap was
    // also configured. Recovering more than was invested is not a cap being
    // generous; it is a partner being paid twice.
    return step.capMinor === null || step.capMinor === undefined
      ? outstandingRecovery
      : Math.min(step.capMinor, outstandingRecovery);
  }

  return step.capMinor ?? null;
}

function assertStepIsSatisfiable(step: WaterfallStepConfig): void {
  if (
    step.floorMinor !== null &&
    step.floorMinor !== undefined &&
    step.capMinor !== null &&
    step.capMinor !== undefined &&
    step.floorMinor > step.capMinor
  ) {
    throw new WaterfallConfigurationError(
      `Step ${step.sequence} ("${step.label}") has a floor of ${step.floorMinor} above its cap of ` +
        `${step.capMinor}. There is no amount that satisfies both, and choosing one silently would ` +
        'hand one party money the other was promised.',
    );
  }

  if (step.basis === 'FIXED' && (step.fixedAmountMinor === null || step.fixedAmountMinor === undefined)) {
    throw new WaterfallConfigurationError(
      `Step ${step.sequence} ("${step.label}") is a fixed amount but states none.`,
    );
  }

  if (step.basis !== 'FIXED' && step.basis !== 'RESIDUAL' && (step.rate === null || step.rate === undefined)) {
    throw new WaterfallConfigurationError(
      `Step ${step.sequence} ("${step.label}") needs a rate to compute a share of ${step.basis}.`,
    );
  }
}

function assertDistinctSequences(steps: readonly WaterfallStepConfig[]): void {
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i].sequence === steps[i - 1].sequence) {
      throw new WaterfallConfigurationError(
        `Two steps share sequence ${steps[i].sequence} ("${steps[i - 1].label}" and "${steps[i].label}"), ` +
          'so the order they run in would depend on how they were loaded.',
      );
    }
  }
}

function assertWholeMinorUnits(totals: LedgerTotals): void {
  for (const [name, value] of Object.entries(totals)) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new WaterfallConfigurationError(`${name} must be a whole number of minor units; got ${value}.`);
    }
    if (value < 0) {
      // Revenue and costs are magnitudes here. A negative would flip the
      // arithmetic silently and produce a plausible, wrong distribution.
      throw new WaterfallConfigurationError(`${name} cannot be negative; got ${value}.`);
    }
  }
}

/**
 * What each party ends up with, across all the steps that name them.
 *
 * Presented separately because the waterfall is ordered by rule, not by party,
 * and a government reading it wants one number.
 */
export function summariseByParty(
  result: WaterfallResult,
): Array<{ partyId: string | null; allocatedMinor: number; shortfallMinor: number; steps: number[] }> {
  const byParty = new Map<string | null, { allocatedMinor: number; shortfallMinor: number; steps: number[] }>();

  for (const allocation of result.allocations) {
    const key = allocation.beneficiaryPartyId;
    const entry = byParty.get(key) ?? { allocatedMinor: 0, shortfallMinor: 0, steps: [] };

    entry.allocatedMinor += allocation.allocatedMinor;
    entry.shortfallMinor += allocation.shortfallMinor;
    entry.steps.push(allocation.sequence);
    byParty.set(key, entry);
  }

  return [...byParty].map(([partyId, entry]) => ({ partyId, ...entry }));
}

/**
 * The partner's capital position, from the recovery ledger.
 *
 * Derived on read from append-only events; never stored (§10). "Outstanding"
 * is what a recovery step is capped at, so a stale stored figure would let a
 * partner recover money they had already been repaid.
 */
export function capitalPosition(
  events: ReadonlyArray<{ eventType: string; amountMinor: number }>,
): {
  investedMinor: number;
  recoveredMinor: number;
  returnPaidMinor: number;
  outstandingMinor: number;
  recoveredProportion: number | null;
  fullyRecovered: boolean;
} {
  let invested = 0;
  let recovered = 0;
  let returnPaid = 0;

  for (const event of events) {
    if (event.eventType === 'INVESTMENT') invested += event.amountMinor;
    else if (event.eventType === 'RECOVERY') recovered += event.amountMinor;
    else if (event.eventType === 'RETURN') returnPaid += event.amountMinor;
  }

  const outstanding = Math.max(0, invested - recovered);

  return {
    investedMinor: invested,
    recoveredMinor: recovered,
    returnPaidMinor: returnPaid,
    outstandingMinor: outstanding,
    // Null rather than 0 or 1 when nothing was invested: "100% recovered" of
    // nothing is a sentence that would appear on a report and mislead.
    recoveredProportion: invested === 0 ? null : recovered / invested,
    fullyRecovered: invested > 0 && recovered >= invested,
  };
}
