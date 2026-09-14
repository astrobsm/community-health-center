import { allocate, money } from '@chc/contracts';

/**
 * Incentive computation (spec §25, acceptance criterion J).
 *
 * Two requirements, and the second is the one that matters:
 *
 *  1. Transparent. Every component records the metric, the value, the weight
 *     and the arithmetic in words. Nobody has to trust the number; they can
 *     read how it was made and argue with it.
 *
 *  2. **Patient volume alone cannot determine an incentive.** A system that
 *     pays by headcount pays for seeing more patients, not for seeing them
 *     properly — and the fastest way to see more patients is to spend less
 *     time with each. This module refuses such a configuration outright
 *     rather than warning about it, because a warning is something a busy
 *     administrator clicks past.
 *
 * Pure: no I/O, no clock, money in integer minor units.
 */

export type MetricDirection = 'HIGHER_BETTER' | 'LOWER_BETTER';

export interface MetricDefinition {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  direction: MetricDirection;
  weight: number;
  targetValue: number | null;
  /**
   * The named query that computes this metric.
   *
   * A metric with no query cannot be scored, which is what stops performance
   * being an opinion typed into a box.
   */
  sourceQueryId: string | null;
  /** True for metrics that count patients seen, procedures done, and the like. */
  isVolumeMetric: boolean;
}

export interface MetricObservation {
  metricId: string;
  /** Null when the query returned nothing for this person in this period. */
  value: number | null;
}

export interface IncentiveComponentResult {
  metricId: string | null;
  label: string;
  metricValue: number | null;
  normalisedScore: number | null;
  weight: number;
  amountMinor: number;
  /** Readable by the person being paid. */
  formulaText: string;
}

export interface IncentiveResult {
  components: IncentiveComponentResult[];
  totalAmountMinor: number;
  /** The share of the pool this person earned, 0..1. */
  overallScore: number;
  poolMinor: number;
  /** Metrics that could not be scored, and why. Never silently dropped. */
  unscored: Array<{ code: string; reason: string }>;
  explanation: string;
}

export class IncentiveConfigurationError extends Error {
  constructor(
    message: string,
    readonly code: 'volume-only' | 'no-metrics' | 'no-weight' | 'unscoreable-metric' | 'volume-dominant',
  ) {
    super(message);
    this.name = 'IncentiveConfigurationError';
  }
}

export interface IncentiveRules {
  /**
   * The most of the total weight that volume metrics may carry.
   *
   * Configurable, but it cannot be 1: the specification forbids volume alone,
   * and a ceiling of 100% would be that configuration wearing a different hat.
   */
  maxVolumeWeightShare: number;
}

export const DEFAULT_INCENTIVE_RULES: IncentiveRules = { maxVolumeWeightShare: 0.4 };

/**
 * Check a metric set before anybody is paid from it.
 *
 * Called when the metrics are configured AND again at computation, because a
 * metric may be deactivated between the two and leave volume standing alone.
 */
export function assertScorable(
  metrics: readonly MetricDefinition[],
  rules: IncentiveRules = DEFAULT_INCENTIVE_RULES,
): void {
  if (rules.maxVolumeWeightShare >= 1) {
    throw new IncentiveConfigurationError(
      'The volume weight ceiling cannot be 100%: that is patient volume alone, which the specification ' +
        'forbids. Pick a ceiling below 1.',
      'volume-only',
    );
  }

  const active = metrics.filter((metric) => metric.weight > 0);

  if (active.length === 0) {
    throw new IncentiveConfigurationError(
      'No metric carries any weight, so there is nothing to compute an incentive from.',
      'no-metrics',
    );
  }

  const totalWeight = active.reduce((sum, metric) => sum + metric.weight, 0);

  if (totalWeight <= 0) {
    throw new IncentiveConfigurationError('The metric weights sum to zero.', 'no-weight');
  }

  const unscoreable = active.filter((metric) => !metric.sourceQueryId);
  if (unscoreable.length > 0) {
    // A metric with no query behind it is somebody's impression. Paying on it
    // makes the whole calculation an opinion with a currency symbol.
    throw new IncentiveConfigurationError(
      `These metrics have no source query and cannot be scored: ${unscoreable
        .map((metric) => metric.code)
        .join(', ')}. A metric nobody can compute is an opinion, and an incentive must not rest on one.`,
      'unscoreable-metric',
    );
  }

  const volumeWeight = active
    .filter((metric) => metric.isVolumeMetric)
    .reduce((sum, metric) => sum + metric.weight, 0);

  const volumeShare = volumeWeight / totalWeight;

  if (volumeShare >= 1) {
    throw new IncentiveConfigurationError(
      'Every weighted metric counts patient volume, so this configuration pays for seeing more patients ' +
        'and nothing else. The specification forbids it, and the reason is practical: the quickest way to ' +
        'see more patients is to spend less time with each. Add at least one metric of quality, safety or ' +
        'stewardship.',
      'volume-only',
    );
  }

  if (volumeShare > rules.maxVolumeWeightShare) {
    throw new IncentiveConfigurationError(
      `Patient volume carries ${(volumeShare * 100).toFixed(0)}% of the total weight, above the ceiling of ` +
        `${(rules.maxVolumeWeightShare * 100).toFixed(0)}%. Reduce its weight, or raise the ceiling ` +
        'deliberately and record why.',
      'volume-dominant',
    );
  }
}

/**
 * Score one metric to 0..1.
 *
 * A metric with no target cannot be normalised — there is nothing to be good
 * against — so it scores null and is reported as unscored rather than assumed
 * to be perfect or assumed to be nothing.
 */
export function normalise(value: number | null, metric: MetricDefinition): number | null {
  if (value === null || metric.targetValue === null) return null;
  if (metric.targetValue === 0) {
    // A target of zero (say, zero stockouts) is met or it is not; a ratio
    // against zero is undefined.
    return metric.direction === 'LOWER_BETTER' ? (value <= 0 ? 1 : 0) : value > 0 ? 1 : 0;
  }

  const ratio =
    metric.direction === 'HIGHER_BETTER' ? value / metric.targetValue : metric.targetValue / value;

  // Capped at 1: exceeding a target is good, but paying more than the full
  // share for it turns a target into a race.
  return round(Math.max(0, Math.min(1, ratio)), 4);
}

/**
 * Compute one person's incentive from a pool.
 *
 * Every component carries its own arithmetic in words. The components sum to
 * the awarded total exactly — the last kobo is not lost to rounding, because
 * somebody would notice and be right to.
 */
export function computeIncentive(params: {
  metrics: readonly MetricDefinition[];
  observations: readonly MetricObservation[];
  /** This person's share of the incentive pool, in minor units. */
  poolMinor: number;
  rules?: IncentiveRules;
}): IncentiveResult {
  const rules = params.rules ?? DEFAULT_INCENTIVE_RULES;
  assertScorable(params.metrics, rules);

  if (params.poolMinor < 0) {
    throw new RangeError('An incentive pool cannot be negative.');
  }

  const byMetric = new Map(params.observations.map((observation) => [observation.metricId, observation]));
  const active = params.metrics.filter((metric) => metric.weight > 0);

  const unscored: IncentiveResult['unscored'] = [];
  const scored: Array<{ metric: MetricDefinition; value: number | null; score: number }> = [];

  for (const metric of active) {
    const observation = byMetric.get(metric.id);
    const value = observation?.value ?? null;
    const score = normalise(value, metric);

    if (score === null) {
      // Reported, never silently dropped and never scored as zero: a metric
      // the query could not compute is not evidence that somebody did badly.
      unscored.push({
        code: metric.code,
        reason:
          value === null
            ? 'The query returned no value for this person in this period.'
            : 'The metric has no target, so there is nothing to score it against.',
      });
      continue;
    }

    scored.push({ metric, value, score });
  }

  if (scored.length === 0) {
    return {
      components: [],
      totalAmountMinor: 0,
      overallScore: 0,
      poolMinor: params.poolMinor,
      unscored,
      explanation:
        'No metric could be scored for this person in this period, so no incentive was computed. ' +
        'This is not a score of zero — it is an absence of evidence, and it needs looking at.',
    };
  }

  // Re-checked against what could ACTUALLY be scored. If the quality metrics
  // all failed to compute, what remains might be volume alone, and paying on
  // that is exactly what the rule forbids.
  assertScorable(
    scored.map((entry) => entry.metric),
    rules,
  );

  const scoredWeight = scored.reduce((sum, entry) => sum + entry.metric.weight, 0);
  const overallScore = round(
    scored.reduce((sum, entry) => sum + entry.score * entry.metric.weight, 0) / scoredWeight,
    4,
  );

  const awardedMinor = Math.round(params.poolMinor * overallScore);

  // Largest remainder, so the components sum to the award exactly rather than
  // leaving a kobo unexplained.
  const shares = scored.map((entry) => entry.score * entry.metric.weight);
  const totalShare = shares.reduce((sum, share) => sum + share, 0);

  const amounts =
    totalShare > 0 && awardedMinor > 0
      ? allocate(money(awardedMinor), shares).map((share) => Number(share.amountMinor))
      : scored.map(() => 0);

  const components: IncentiveComponentResult[] = scored.map((entry, index) => ({
    metricId: entry.metric.id,
    label: entry.metric.name,
    metricValue: entry.value,
    normalisedScore: entry.score,
    weight: entry.metric.weight,
    amountMinor: amounts[index],
    formulaText:
      `${entry.metric.name}: ${entry.value}${entry.metric.unit ? ` ${entry.metric.unit}` : ''} ` +
      `against a target of ${entry.metric.targetValue}${entry.metric.unit ? ` ${entry.metric.unit}` : ''} ` +
      `(${entry.metric.direction === 'HIGHER_BETTER' ? 'higher is better' : 'lower is better'}) ` +
      `scores ${entry.score}. Weight ${entry.metric.weight} of ${round(scoredWeight, 4)}. ` +
      `Share of the ${formatMinor(params.poolMinor)} pool: ${formatMinor(amounts[index])}.`,
  }));

  return {
    components,
    totalAmountMinor: components.reduce((sum, component) => sum + component.amountMinor, 0),
    overallScore,
    poolMinor: params.poolMinor,
    unscored,
    explanation:
      `${scored.length} metric(s) scored, weighted, and averaged to ${overallScore}. ` +
      `${overallScore} of the ${formatMinor(params.poolMinor)} pool is ${formatMinor(awardedMinor)}. ` +
      (unscored.length > 0
        ? `${unscored.length} metric(s) could not be scored and were excluded rather than counted as zero.`
        : 'Every weighted metric was scored.'),
  };
}

/**
 * Split a facility pool between staff.
 *
 * Equal shares by default. Splitting by seniority or by hours is a policy
 * decision for the facility, and one this module will not make silently.
 */
export function splitPool(
  poolMinor: number,
  staffIds: readonly string[],
  weights?: readonly number[],
): Array<{ staffId: string; shareMinor: number }> {
  if (staffIds.length === 0) return [];

  const shares = weights ?? staffIds.map(() => 1);

  if (shares.length !== staffIds.length) {
    throw new RangeError('A weight must be given for every member of staff, or for none of them.');
  }

  if (poolMinor === 0) return staffIds.map((staffId) => ({ staffId, shareMinor: 0 }));

  const amounts = allocate(money(poolMinor), [...shares]);

  return staffIds.map((staffId, index) => ({
    staffId,
    shareMinor: Number(amounts[index].amountMinor),
  }));
}

function formatMinor(minor: number): string {
  return `NGN ${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
