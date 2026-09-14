/**
 * The shape of a named, version-controlled metric query (spec §§25, 38).
 *
 * A metric's `sourceQueryId` names one of these. That indirection is the
 * mechanism behind two of the specification's rules at once:
 *
 *   - §5 "no fabricated data": a metric cannot be scored unless a named query
 *     exists to compute it, so nobody can type a performance figure into a box
 *     and have it paid on.
 *   - §10 "never store a calculated value": the query is the definition, and
 *     it can be re-run at any time to check what was computed before.
 *
 * A query returns `null` when it cannot compute, never 0. The difference
 * matters enormously: "this nurse saw no patients" and "we have no record of
 * what this nurse did" look identical on a dashboard and mean opposite things
 * to the person being paid.
 */

export type MetricScope = 'STAFF' | 'FACILITY';

export interface MetricQueryParams {
  organisationId: string;
  facilityId: string;
  /** Inclusive. */
  periodStart: Date;
  /** Inclusive; the query covers the whole of this day. */
  periodEnd: Date;
  /** Required for STAFF-scope queries, ignored by FACILITY-scope ones. */
  staffId?: string;
  /** Injected, so a computation over a past period is reproducible. */
  now: Date;
}

export interface MetricQueryOutcome {
  /** Null when the query could not compute — never a stand-in zero. */
  value: number | null;
  /**
   * How many observations the value rests on.
   *
   * A rate computed from three encounters is not the same evidence as one
   * computed from three thousand, and a figure presented without its
   * denominator invites exactly that confusion.
   */
  sampleSize: number | null;
  /**
   * The counts and identifiers the value was derived from, stored alongside
   * the result so a disputed figure can be re-examined months later without
   * re-running anything (doc 22).
   */
  inputs: Record<string, unknown>;
  /** Said in words when the value is null, or when it needs a caveat. */
  note?: string;
}

export interface NamedMetricQuery<TClient = unknown> {
  id: string;
  name: string;
  /** What the number means, in the words that belong on a report. */
  definition: string;
  unit: string | null;
  scope: MetricScope;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  /**
   * True for anything that counts patients, procedures or attendances.
   *
   * Carried on the query rather than on the metric configuration so that a
   * volume query cannot be re-labelled as a quality metric to get around the
   * rule that volume alone may not determine an incentive (spec §25).
   */
  isVolumeMetric: boolean;
  /**
   * True where the value is a rate over people.
   *
   * Such a figure is withheld when its denominator is small: "50% of patients"
   * over two people identifies both of them and measures nothing (doc 08 §5).
   * Stated explicitly rather than inferred from the unit, because a unit is a
   * label and this is a disclosure decision.
   */
  suppressSmallCells: boolean;
  /** The tables this query reads, for the lineage view (doc 22). */
  reads: readonly string[];
  run(client: TClient, params: MetricQueryParams): Promise<MetricQueryOutcome>;
}

export class UnknownMetricQueryError extends Error {
  constructor(id: string, known: readonly string[]) {
    super(
      `No named query "${id}" exists. A metric must name a query that can be run and re-run; ` +
        `the catalogue holds: ${known.join(', ')}.`,
    );
    this.name = 'UnknownMetricQueryError';
  }
}

/** A rate, with the guard that a zero denominator yields null rather than NaN. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/** The period as a half-open interval, so "inclusive to the end of the day" is honest. */
export function periodRange(params: MetricQueryParams): { gte: Date; lt: Date } {
  const end = new Date(params.periodEnd);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);

  const start = new Date(params.periodStart);
  start.setUTCHours(0, 0, 0, 0);

  return { gte: start, lt: end };
}
