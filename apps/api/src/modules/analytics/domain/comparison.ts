/**
 * Baseline, current, target (acceptance criterion B, doc 22 §3).
 *
 * The whole value of this comparison is that the two numbers come from
 * structurally different places: the baseline from a snapshot sealed at Day 0
 * and never recomputed, the current value recomputed from transactions and
 * never read from the snapshot. This module is deliberately given them as two
 * separate inputs and has no way to fetch either, so it cannot conflate them
 * even by accident.
 *
 * Pure: no I/O, no clock.
 */

import type { DataClassification } from '@chc/contracts';
import { weakest } from '@chc/contracts';

export type MetricDirection = 'HIGHER_BETTER' | 'LOWER_BETTER' | 'TARGET_RANGE';

export interface ComparisonInput {
  kpiCode: string;
  kpiName: string;
  unit: string | null;
  direction: MetricDirection;
  /** From the sealed snapshot. Null where Day 0 recorded nothing comparable. */
  baseline: { value: number | null; classification: DataClassification; sealedAt: Date; label: string } | null;
  /** Recomputed from transactions for the period. */
  current: { value: number | null; classification: DataClassification; computedAt: Date; sampleSize: number | null } | null;
  target: { value: number | null; date: Date | null } | null;
}

export type Direction = 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | 'UNKNOWN';

export interface Comparison {
  kpiCode: string;
  kpiName: string;
  unit: string | null;
  baselineValue: number | null;
  currentValue: number | null;
  targetValue: number | null;
  /** current − baseline, in the metric's own unit. */
  change: number | null;
  /** The change as a proportion of the baseline. Null when the baseline is 0. */
  changePercent: number | null;
  /** current − target. */
  varianceToTarget: number | null;
  /** How far from baseline to target the facility has come, 0..1 and beyond. */
  progressToTarget: number | null;
  direction: Direction;
  /** The weakest classification of the inputs that were actually used. */
  classification: DataClassification;
  /** True when both halves are present and the comparison means something. */
  comparable: boolean;
  /** Said in words. A dash in a table is read as zero by everybody in a hurry. */
  note: string;
  /** Provenance, stated on every row rather than in a footnote. */
  provenance: string;
}

export function compare(input: ComparisonInput): Comparison {
  const baselineValue = input.baseline?.value ?? null;
  const currentValue = input.current?.value ?? null;
  const targetValue = input.target?.value ?? null;

  const classifications: DataClassification[] = [];
  if (input.baseline && baselineValue !== null) classifications.push(input.baseline.classification);
  if (input.current && currentValue !== null) classifications.push(input.current.classification);

  const comparable = baselineValue !== null && currentValue !== null;
  const change = comparable ? round(currentValue - baselineValue, 6) : null;

  const changePercent =
    comparable && baselineValue !== 0 ? round(((currentValue - baselineValue) / Math.abs(baselineValue)) * 100, 2) : null;

  const varianceToTarget =
    currentValue !== null && targetValue !== null ? round(currentValue - targetValue, 6) : null;

  // How far along the journey the facility is. Null when baseline and target
  // are the same number, because there is no journey to be a fraction of.
  const progressToTarget =
    comparable && targetValue !== null && baselineValue !== targetValue
      ? round((currentValue - baselineValue) / (targetValue - baselineValue), 4)
      : null;

  return {
    kpiCode: input.kpiCode,
    kpiName: input.kpiName,
    unit: input.unit,
    baselineValue,
    currentValue,
    targetValue,
    change,
    changePercent,
    varianceToTarget,
    progressToTarget,
    direction: directionOf(change, input.direction),
    // An empty list yields ESTIMATED from weakest(), which is right: a
    // comparison resting on nothing is not an actual.
    classification: weakest(classifications),
    comparable,
    note: noteFor(input, baselineValue, currentValue, targetValue),
    provenance: comparable
      ? `Baseline ${baselineValue} from the snapshot "${input.baseline!.label}" sealed on ` +
        `${input.baseline!.sealedAt.toISOString().slice(0, 10)}, never recomputed. Current ${currentValue} ` +
        `recomputed from transactions at ${input.current!.computedAt.toISOString()}` +
        (input.current!.sampleSize === null ? '.' : ` over ${input.current!.sampleSize} record(s).`)
      : 'This comparison is incomplete; see the note.',
  };
}

function directionOf(change: number | null, direction: MetricDirection): Direction {
  if (change === null) return 'UNKNOWN';
  if (change === 0) return 'UNCHANGED';
  // A target range has no single good direction, and guessing one would label
  // a move towards the middle of the range as a decline.
  if (direction === 'TARGET_RANGE') return 'UNKNOWN';
  const better = direction === 'HIGHER_BETTER' ? change > 0 : change < 0;
  return better ? 'IMPROVED' : 'WORSENED';
}

function noteFor(
  input: ComparisonInput,
  baselineValue: number | null,
  currentValue: number | null,
  targetValue: number | null,
): string {
  if (baselineValue === null && currentValue === null) {
    return (
      `Neither a Day 0 baseline nor a current value exists for ${input.kpiName}. ` +
      'Nothing can be claimed about it either way.'
    );
  }

  if (baselineValue === null) {
    return (
      `${input.kpiName} has a current value but no sealed baseline, so no change can be claimed. ` +
      'Reporting the current figure as an improvement would be comparing it with nothing.'
    );
  }

  if (currentValue === null) {
    return (
      `${input.kpiName} has a Day 0 baseline but no computed current value for this period. ` +
      'This is an absence of measurement, not a fall to zero.'
    );
  }

  if (targetValue === null) {
    return `No target is set for ${input.kpiName}, so progress is reported against the baseline only.`;
  }

  return `Measured against a target of ${targetValue}${input.unit ? ` ${input.unit}` : ''}.`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
