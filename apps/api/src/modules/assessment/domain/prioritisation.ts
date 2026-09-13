import type { PriorityClassValue, PriorityInputs } from '@chc/contracts';

/**
 * Investment prioritisation (spec §18).
 *
 * priority_score = clinical importance·w1 + safety·w2 + urgency·w3
 *                + patient impact·w4 + sustainability·w5 − cost burden·w6
 *
 * The weights and the band boundaries are CONFIGURATION, not constants here —
 * an organisation that values safety differently must be able to say so
 * without a code change (spec §89). The defaults below are a starting point,
 * and the caller always passes them in explicitly.
 */

export interface PriorityWeights {
  clinicalImportance: number;
  safetyRisk: number;
  urgency: number;
  patientImpact: number;
  sustainability: number;
  costBurden: number;
}

/**
 * Safety and clinical importance lead, because a facility that is unsafe to
 * operate cannot open regardless of how cheap the alternative work is. Cost
 * subtracts rather than dominating: expensive work that prevents harm still
 * ranks above cheap work that does not.
 */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  clinicalImportance: 1.0,
  safetyRisk: 1.2,
  urgency: 0.9,
  patientImpact: 1.0,
  sustainability: 0.6,
  costBurden: 0.5,
};

export interface PriorityBands {
  /** Score at or above which a finding is P1. */
  p1: number;
  p2: number;
  p3: number;
}

export const DEFAULT_PRIORITY_BANDS: PriorityBands = { p1: 16, p2: 11, p3: 6 };

export interface PriorityResult {
  score: number;
  computedClass: PriorityClassValue;
  /** Per-input contribution, so the ranking can be explained rather than asserted. */
  contributions: Record<keyof PriorityInputs, number>;
  maximumPossible: number;
}

export function computePriority(
  inputs: PriorityInputs,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
  bands: PriorityBands = DEFAULT_PRIORITY_BANDS,
): PriorityResult {
  const contributions: Record<keyof PriorityInputs, number> = {
    clinicalImportance: inputs.clinicalImportance * weights.clinicalImportance,
    safetyRisk: inputs.safetyRisk * weights.safetyRisk,
    urgency: inputs.urgency * weights.urgency,
    patientImpact: inputs.patientImpact * weights.patientImpact,
    sustainability: inputs.sustainability * weights.sustainability,
    costBurden: -(inputs.costBurden * weights.costBurden),
  };

  const score = round(Object.values(contributions).reduce((sum, value) => sum + value, 0), 3);

  // The best possible score: every positive driver at maximum, no cost burden.
  const maximumPossible = round(
    5 *
      (weights.clinicalImportance +
        weights.safetyRisk +
        weights.urgency +
        weights.patientImpact +
        weights.sustainability),
    3,
  );

  return {
    score,
    computedClass: classify(score, bands),
    contributions: roundAll(contributions),
    maximumPossible,
  };
}

function classify(score: number, bands: PriorityBands): PriorityClassValue {
  if (score >= bands.p1) return 'P1';
  if (score >= bands.p2) return 'P2';
  if (score >= bands.p3) return 'P3';
  return 'P4';
}

/**
 * A human may override the computed class, but never silently.
 *
 * The formula cannot know that the LGA chairman has committed to an opening
 * date, so the override exists — and it requires a reason, which is stored
 * beside the computed score so both are visible to a later reviewer.
 */
export function resolvePriority(
  computed: PriorityResult,
  override?: { priorityClass: PriorityClassValue; reason?: string },
): { priorityClass: PriorityClassValue; overridden: boolean } {
  if (!override) return { priorityClass: computed.computedClass, overridden: false };

  if (override.priorityClass === computed.computedClass) {
    // Not an override at all — the human agreed with the formula.
    return { priorityClass: computed.computedClass, overridden: false };
  }

  if (!override.reason || override.reason.trim().length < 10) {
    throw new Error(
      `Overriding the computed priority (${computed.computedClass} -> ${override.priorityClass}) requires a reason of at least 10 characters. ` +
        'The reason is stored with the finding so a later reviewer can see why the ranking was changed.',
    );
  }

  return { priorityClass: override.priorityClass, overridden: true };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function roundAll(values: Record<keyof PriorityInputs, number>): Record<keyof PriorityInputs, number> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, round(value, 3)]),
  ) as Record<keyof PriorityInputs, number>;
}
