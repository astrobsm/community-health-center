import { z } from 'zod';

/**
 * Data classification — the non-fabrication rule (spec §82, doc 00 §6).
 *
 * Every quantitative value in the system carries one of these, everywhere:
 * database column, API field, UI label, PDF figure, AI output.
 *
 * This module is the single implementation of the rules. It is deliberately
 * pure and framework-free so the same logic runs in a browser on a phone in a
 * village and on the server at sync time.
 */

export const DataClassification = {
  /** Produced by a system transaction. */
  ACTUAL: 'ACTUAL',
  /** Observed and confirmed by a named verifier, with evidence. */
  VERIFIED: 'VERIFIED',
  /** Stated by a third party, not independently verified. */
  REPORTED: 'REPORTED',
  /** Derived by a documented calculation from incomplete data. */
  ESTIMATED: 'ESTIMATED',
  /** An input chosen by a modeller. */
  ASSUMPTION: 'ASSUMPTION',
  /** Output of a financial or statistical model. */
  PROJECTED: 'PROJECTED',
  /** Produced by the AI layer. */
  AI_GENERATED: 'AI_GENERATED',
} as const;

export type DataClassification = (typeof DataClassification)[keyof typeof DataClassification];

export const dataClassificationSchema = z.nativeEnum(DataClassification);

/**
 * Strength ordering. A LOWER number is stronger evidence.
 *
 * Used by {@link weakest} so that aggregating values of mixed provenance
 * yields the weakest of them — a single estimate visibly demotes a total
 * rather than hiding inside it.
 */
const STRENGTH: Record<DataClassification, number> = {
  ACTUAL: 0,
  VERIFIED: 1,
  REPORTED: 2,
  ESTIMATED: 3,
  ASSUMPTION: 4,
  PROJECTED: 5,
  AI_GENERATED: 6,
};

/**
 * The classification an aggregate must carry, given its inputs.
 *
 * Summing 100 ACTUAL values and 1 ESTIMATED value yields ESTIMATED. This is
 * the rule that stops an estimate laundering itself into a fact by being
 * added to enough real numbers.
 *
 * An empty input list has no provenance at all, so it cannot be ACTUAL; it is
 * ESTIMATED, and callers should normally render "no data" instead.
 */
export function weakest(classifications: readonly DataClassification[]): DataClassification {
  if (classifications.length === 0) return DataClassification.ESTIMATED;
  return classifications.reduce((worst, current) =>
    STRENGTH[current] > STRENGTH[worst] ? current : worst,
  );
}

/** True when `a` is at least as strong as `b`. */
export function isAtLeastAsStrongAs(a: DataClassification, b: DataClassification): boolean {
  return STRENGTH[a] <= STRENGTH[b];
}

/**
 * Permitted promotions (doc 00 §6).
 *
 * REPORTED and ESTIMATED may become VERIFIED once someone observes and
 * confirms the value with evidence. Nothing else ever moves:
 *
 *  - ACTUAL and VERIFIED are already terminal.
 *  - ASSUMPTION, PROJECTED and AI_GENERATED are NEVER promoted. An assumption
 *    that becomes a fact is precisely the failure this system exists to
 *    prevent.
 */
const PROMOTIONS: Partial<Record<DataClassification, readonly DataClassification[]>> = {
  REPORTED: [DataClassification.VERIFIED],
  ESTIMATED: [DataClassification.VERIFIED],
};

export function canPromote(from: DataClassification, to: DataClassification): boolean {
  return PROMOTIONS[from]?.includes(to) ?? false;
}

export class IllegalPromotionError extends Error {
  constructor(
    readonly from: DataClassification,
    readonly to: DataClassification,
  ) {
    super(
      `Cannot reclassify ${from} as ${to}. ` +
        (from === 'ASSUMPTION' || from === 'PROJECTED' || from === 'AI_GENERATED'
          ? `${from} values are never promoted — doing so would turn a modelled or generated figure into a fact.`
          : `The only permitted promotion from ${from} is to VERIFIED, and it requires a named verifier and evidence.`),
    );
    this.name = 'IllegalPromotionError';
  }
}

/** Throws unless the promotion is permitted. */
export function assertPromotion(from: DataClassification, to: DataClassification): void {
  if (from === to) return;
  if (!canPromote(from, to)) throw new IllegalPromotionError(from, to);
}

/**
 * A quantitative value as it crosses every boundary in this system.
 *
 * There is no way to express a bare number in an API response: the schema
 * requires the classification, which is how spec §82 becomes mechanical
 * rather than a matter of discipline.
 */
export const classifiedNumberSchema = z.object({
  value: z.number().nullable(),
  classification: dataClassificationSchema,
  unit: z.string().optional(),
  /** When this value was computed. Stale data must never look current. */
  computedAt: z.string().datetime().optional(),
  /** The named query or record that produced it — the lineage entry point. */
  sourceRef: z.string().optional(),
  /** Set when the value is withheld because the denominator is too small. */
  suppressed: z.boolean().optional(),
  suppressionReason: z.string().optional(),
  /** Denominator, so a rate from 3 observations is not read like one from 3000. */
  sampleSize: z.number().int().nonnegative().optional(),
  /** Which inputs weakened an aggregate, and why. */
  weakenedBy: z
    .array(
      z.object({
        source: z.string(),
        classification: dataClassificationSchema,
        reason: z.string(),
      }),
    )
    .optional(),
});

export type ClassifiedNumber = z.infer<typeof classifiedNumberSchema>;

/** A classified monetary amount. Minor units only — ADR 0003. */
export const classifiedMoneySchema = z.object({
  amountMinor: z.union([z.bigint(), z.number().int()]).nullable(),
  currency: z.string().length(3),
  classification: dataClassificationSchema,
  computedAt: z.string().datetime().optional(),
  sourceRef: z.string().optional(),
  modelVersion: z.string().optional(),
  weakenedBy: classifiedNumberSchema.shape.weakenedBy,
});

export type ClassifiedMoney = z.infer<typeof classifiedMoneySchema>;

/** Human-readable label for UI and report rendering. */
export const CLASSIFICATION_LABEL: Record<DataClassification, string> = {
  ACTUAL: 'Actual',
  VERIFIED: 'Verified',
  REPORTED: 'Reported',
  ESTIMATED: 'Estimated',
  ASSUMPTION: 'Assumption',
  PROJECTED: 'Projected',
  AI_GENERATED: 'AI-generated',
};

/** One-line explanation, shown on hover and in document appendices. */
export const CLASSIFICATION_DESCRIPTION: Record<DataClassification, string> = {
  ACTUAL: 'Produced by a system transaction.',
  VERIFIED: 'Observed and confirmed by a named verifier, with evidence.',
  REPORTED: 'Stated by a third party and not independently verified.',
  ESTIMATED: 'Calculated from incomplete data; the method is stated where it is used.',
  ASSUMPTION: 'An input chosen by a modeller, not a measurement.',
  PROJECTED: 'Output of a financial or statistical model, not an outcome.',
  AI_GENERATED: 'Produced by the AI layer. Not a system record.',
};

/**
 * Classifications that may never be used as an input to a financial posting,
 * a clinical record, or an approval (doc 17 §3).
 */
export const NON_AUTHORITATIVE: readonly DataClassification[] = [
  DataClassification.ASSUMPTION,
  DataClassification.PROJECTED,
  DataClassification.AI_GENERATED,
];

export function isAuthoritative(classification: DataClassification): boolean {
  return !NON_AUTHORITATIVE.includes(classification);
}
