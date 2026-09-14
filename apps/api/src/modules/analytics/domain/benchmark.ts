/**
 * Cross-facility benchmarking (spec §§40-41).
 *
 * A league table is the easiest thing in this system to do harm with. Two
 * facilities differ in catchment, staffing, road access and what the nearest
 * hospital does; ranking them on a single number and calling the bottom one
 * "worst" is a claim the data does not support.
 *
 * So this module:
 *   - refuses to rank fewer than a configured minimum of facilities, because a
 *     "rank 2 of 2" is a comparison of two things dressed as a standing;
 *   - suppresses any facility whose denominator is below the small-cell
 *     threshold rather than publishing a rate over a handful of patients;
 *   - reports the median and the quartiles, not just the mean, because one
 *     large facility drags a mean and tells the others nothing;
 *   - names every facility it left out and why, so a missing row is never
 *     mistaken for a zero.
 *
 * Pure: no I/O, no clock.
 */

export interface BenchmarkEntry {
  facilityId: string;
  facilityName: string;
  /** Null where the query could not compute for this facility. */
  value: number | null;
  /** The denominator the value rests on. */
  sampleSize: number | null;
}

export interface BenchmarkRules {
  /** Fewer facilities than this and no ranking is published. */
  minimumFacilities: number;
  /** Denominators below this are withheld (doc 08 §5). */
  smallCellThreshold: number;
}

export const DEFAULT_BENCHMARK_RULES: BenchmarkRules = {
  minimumFacilities: 3,
  smallCellThreshold: 5,
};

export interface RankedFacility {
  facilityId: string;
  facilityName: string;
  value: number;
  sampleSize: number | null;
  /** 1 is best, by the metric's own direction. */
  rank: number;
  /** 0..100. The share of ranked facilities this one is at least as good as. */
  percentile: number;
}

export interface ExcludedFacility {
  facilityId: string;
  facilityName: string;
  reason: string;
}

export interface BenchmarkResult {
  ranked: RankedFacility[];
  excluded: ExcludedFacility[];
  /** Null when too few facilities could be compared. */
  statistics: {
    count: number;
    median: number;
    mean: number;
    lowerQuartile: number;
    upperQuartile: number;
    best: number;
    worst: number;
  } | null;
  published: boolean;
  /** Always present, and always said before the table is read. */
  caveat: string;
}

export function benchmark(
  entries: readonly BenchmarkEntry[],
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER',
  rules: BenchmarkRules = DEFAULT_BENCHMARK_RULES,
): BenchmarkResult {
  const excluded: ExcludedFacility[] = [];
  const eligible: Array<BenchmarkEntry & { value: number }> = [];

  for (const entry of entries) {
    if (entry.value === null) {
      excluded.push({
        facilityId: entry.facilityId,
        facilityName: entry.facilityName,
        reason: 'No value could be computed for this facility in the period.',
      });
      continue;
    }

    if (entry.sampleSize !== null && entry.sampleSize < rules.smallCellThreshold) {
      excluded.push({
        facilityId: entry.facilityId,
        facilityName: entry.facilityName,
        reason:
          `Withheld: ${entry.sampleSize} observation(s), below the threshold of ` +
          `${rules.smallCellThreshold}. A rate over so few people can identify them and measures little.`,
      });
      continue;
    }

    eligible.push({ ...entry, value: entry.value });
  }

  if (eligible.length < rules.minimumFacilities) {
    return {
      ranked: [],
      excluded,
      statistics: null,
      published: false,
      caveat:
        `Only ${eligible.length} facility(ies) could be compared, and a ranking is not published below ` +
        `${rules.minimumFacilities}. A standing drawn from two facilities is a comparison of two things ` +
        'wearing the clothes of a league table.',
    };
  }

  const sorted = [...eligible].sort((a, b) =>
    direction === 'HIGHER_BETTER' ? b.value - a.value : a.value - b.value,
  );

  const ranked: RankedFacility[] = sorted.map((entry, index) => ({
    facilityId: entry.facilityId,
    facilityName: entry.facilityName,
    value: entry.value,
    sampleSize: entry.sampleSize,
    // Ties share the better rank, because telling two identical facilities
    // that one of them is behind the other would be false.
    rank: sorted.findIndex((other) => other.value === entry.value) + 1,
    percentile: round(((sorted.length - index - 1) / (sorted.length - 1)) * 100, 1),
  }));

  const values = [...eligible.map((entry) => entry.value)].sort((a, b) => a - b);

  return {
    ranked,
    excluded,
    statistics: {
      count: values.length,
      median: round(quantile(values, 0.5), 4),
      mean: round(values.reduce((sum, value) => sum + value, 0) / values.length, 4),
      lowerQuartile: round(quantile(values, 0.25), 4),
      upperQuartile: round(quantile(values, 0.75), 4),
      best: direction === 'HIGHER_BETTER' ? values[values.length - 1] : values[0],
      worst: direction === 'HIGHER_BETTER' ? values[0] : values[values.length - 1],
    },
    published: true,
    caveat:
      'Facilities differ in catchment, staffing and access. A rank here is a prompt to ask why, not a ' +
      'judgement about the people working there.' +
      (excluded.length > 0 ? ` ${excluded.length} facility(ies) are excluded; each is named with its reason.` : ''),
  };
}

/** Linear interpolation between the two nearest ranks. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
