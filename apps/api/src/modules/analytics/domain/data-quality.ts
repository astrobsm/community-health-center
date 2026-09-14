/**
 * The data quality engine (spec §47).
 *
 * A score out of 100 that a facility manager can act on, built from counts the
 * system can actually take. Three things it deliberately does NOT do:
 *
 *  1. It does not invent a dimension it cannot measure. A dimension with no
 *     denominator is reported as unmeasured, not scored at zero and not
 *     quietly left out of the average — an unmeasured dimension and a failing
 *     one look identical on a dial and mean opposite things.
 *
 *  2. It does not average rates. Two hundred records at 50% and four records
 *     at 0% is not 25%; it is 49%. Weighting by denominator is the difference
 *     between a score that tracks reality and one that a tiny sample can swing.
 *
 *  3. It does not round a failing score up to a passing one. 79.6 is 79.6.
 *
 * Pure: no I/O, no clock.
 */

import type { DataQualityDimension, DataQualityIssue } from '@chc/contracts';

export interface DimensionInput {
  dimension: DataQualityDimension;
  /** Records that are correct on this dimension. */
  good: number;
  /** Records assessed. Zero means the dimension could not be measured. */
  outOf: number;
  /** Relative importance. Configurable; never hard-coded at a call site. */
  weight: number;
  issues: DataQualityIssue[];
}

export interface DimensionScore {
  dimension: DataQualityDimension;
  /** 0..100, or null where nothing could be measured. */
  score: number | null;
  good: number;
  outOf: number;
  weight: number;
  measured: boolean;
  note?: string;
}

export interface DataQualityResult {
  /** 0..100, or null when nothing at all could be measured. */
  overallScore: number | null;
  dimensions: DimensionScore[];
  issues: DataQualityIssue[];
  /** Dimensions that could not be measured, named rather than dropped. */
  unmeasured: DataQualityDimension[];
  /** The denominator the overall score rests on. */
  recordsAssessed: number;
  explanation: string;
}

export function scoreDataQuality(inputs: readonly DimensionInput[]): DataQualityResult {
  const dimensions: DimensionScore[] = inputs.map((input) => {
    if (input.outOf === 0) {
      return {
        dimension: input.dimension,
        score: null,
        good: 0,
        outOf: 0,
        weight: input.weight,
        measured: false,
        note:
          'No record of this kind exists in the period, so this dimension could not be assessed. ' +
          'That is not the same as scoring nothing on it.',
      };
    }

    if (input.good > input.outOf) {
      throw new RangeError(
        `${input.dimension}: ${input.good} good records out of ${input.outOf} assessed. ` +
          'A dimension cannot have more correct records than records.',
      );
    }

    return {
      dimension: input.dimension,
      score: round(( input.good / input.outOf) * 100, 2),
      good: input.good,
      outOf: input.outOf,
      weight: input.weight,
      measured: true,
    };
  });

  const measured = dimensions.filter((dimension) => dimension.measured);
  const unmeasured = dimensions.filter((dimension) => !dimension.measured).map((d) => d.dimension);

  const issues = inputs.flatMap((input) => input.issues);

  if (measured.length === 0) {
    return {
      overallScore: null,
      dimensions,
      issues,
      unmeasured,
      recordsAssessed: 0,
      explanation:
        'Nothing could be assessed in this period: there are no records of any measured kind. ' +
        'A data quality score of zero would say the data is bad; there is no data.',
    };
  }

  // Weighted by the denominator as well as the configured weight, so four bad
  // records cannot drag a score built from four thousand good ones.
  const totalWeight = measured.reduce((sum, dimension) => sum + dimension.weight * dimension.outOf, 0);
  const weightedGood = measured.reduce(
    (sum, dimension) => sum + dimension.weight * dimension.good,
    0,
  );

  const recordsAssessed = measured.reduce((sum, dimension) => sum + dimension.outOf, 0);

  return {
    overallScore: totalWeight === 0 ? null : round((weightedGood / totalWeight) * 100, 2),
    dimensions,
    issues,
    unmeasured,
    recordsAssessed,
    explanation:
      `${measured.length} of ${dimensions.length} dimension(s) could be measured, over ` +
      `${recordsAssessed} record(s). The score weights each dimension by its configured weight and by ` +
      'how many records it was measured over, so a handful of records cannot swing it.' +
      (unmeasured.length > 0
        ? ` Not measured: ${unmeasured.join(', ')}. These are excluded rather than counted as failures.`
        : ''),
  };
}

/** The usual bands. Thresholds belong with the score, not scattered in a UI. */
export function qualityBand(score: number | null): 'GOOD' | 'ADEQUATE' | 'POOR' | 'NOT_ASSESSED' {
  if (score === null) return 'NOT_ASSESSED';
  if (score >= 90) return 'GOOD';
  if (score >= 75) return 'ADEQUATE';
  return 'POOR';
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
