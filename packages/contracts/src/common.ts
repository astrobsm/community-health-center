import { z } from 'zod';

/** Shared primitives, envelopes and error shapes (doc 06). */

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Sync metadata carried by every offline-capable record (doc 10 §1). */
export const SyncStatus = {
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  CONFLICT: 'CONFLICT',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/**
 * Sync metadata as a CLIENT sends it when creating a record.
 *
 * `version` is deliberately absent: it is the server's concurrency token,
 * assigned on write and incremented by a database trigger. Requiring a client
 * to invent one would be asking it to guess, and would reject every
 * first-time create from a field device.
 *
 * A client sends `version` only when UPDATING, as the baseVersion it edited
 * against — see `syncMetadataSchema`.
 */
export const clientSyncMetadataSchema = z.object({
  id: uuidSchema,
  deviceId: z.string().max(128).optional(),
  deviceCreatedAt: isoDateTimeSchema.optional(),
  /** The version this edit was made against. Absent on a create. */
  baseVersion: z.number().int().positive().optional(),
});

export const syncMetadataSchema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  deviceId: z.string().max(128).optional(),
  /**
   * The device's own clock, kept as a hint only. Field devices are routinely
   * wrong — sometimes by years after a battery change — so the server stamps
   * the authoritative time and ordering uses a monotonic sequence.
   */
  deviceCreatedAt: isoDateTimeSchema.optional(),
  syncStatus: z.nativeEnum(SyncStatus).optional(),
});

/** Collection envelope. Single resources are returned unwrapped. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().optional(),
      total: z.number().int().nonnegative().optional(),
      nextCursor: z.string().nullable().optional(),
      /**
       * When this result was computed. Every figure the product shows carries
       * its age, so stale data never reads as current (doc 02 §6).
       */
      computedAt: isoDateTimeSchema.optional(),
    }),
  });
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  sort: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
});

export const cursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/** RFC 9457 Problem Details (doc 06 §5). Errors are never swallowed. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Always present on 5xx, and shown to the user so they can quote it. */
  traceId: z.string(),
  errors: z
    .array(
      z.object({
        field: z.string().optional(),
        code: z.string(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/**
 * Business-rule error codes. Each maps to a specific HTTP status and a
 * specific, non-generic message, because "something went wrong" is useless to
 * a pharmacist holding a patient's prescription.
 */
export const BusinessErrorCode = {
  INSUFFICIENT_STOCK: 'insufficient-stock',
  BATCH_EXPIRED: 'batch-expired',
  PERIOD_CLOSED: 'period-closed',
  UNBALANCED_ENTRY: 'unbalanced-entry',
  BASELINE_SEALED: 'baseline-sealed',
  DOCUMENT_APPROVED: 'document-approved',
  CONTRACT_EXECUTED: 'contract-executed',
  MODEL_LOCKED: 'model-locked',
  VERSION_CONFLICT: 'version-conflict',
  SEGREGATION_OF_DUTIES: 'segregation-of-duties',
  DUPLICATE_PAYMENT: 'duplicate-payment',
  THREE_WAY_MATCH_FAILED: 'three-way-match-failed',
  CONSENT_REQUIRED: 'consent-required',
  RESULT_NOT_VERIFIED: 'result-not-verified',
  OFFLINE_LIMIT_REACHED: 'offline-limit-reached',
  SMALL_CELL_SUPPRESSED: 'small-cell-suppressed',
  REASON_REQUIRED: 'reason-required',
  DOCUMENT_INCOMPLETE: 'document-incomplete',
  CLINICAL_RECORD_IMMUTABLE: 'clinical-record-immutable',
} as const;
export type BusinessErrorCode = (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];

/** Facility lifecycle, mirrored from the database enum (doc 00 §4). */
export const FacilityLifecycleStage = {
  PRE_ASSESSMENT: 'PRE_ASSESSMENT',
  DUE_DILIGENCE: 'DUE_DILIGENCE',
  FIELD_ASSESSMENT: 'FIELD_ASSESSMENT',
  BASELINE_ESTABLISHED: 'BASELINE_ESTABLISHED',
  PLANNING: 'PLANNING',
  PROPOSAL: 'PROPOSAL',
  GOVERNMENT_REVIEW: 'GOVERNMENT_REVIEW',
  AGREEMENT: 'AGREEMENT',
  IMPLEMENTATION: 'IMPLEMENTATION',
  COMMISSIONING: 'COMMISSIONING',
  LIVE_OPERATIONS: 'LIVE_OPERATIONS',
  CONTINUOUS_IMPROVEMENT: 'CONTINUOUS_IMPROVEMENT',
  SUSPENDED: 'SUSPENDED',
  EXITED: 'EXITED',
} as const;
export type FacilityLifecycleStage =
  (typeof FacilityLifecycleStage)[keyof typeof FacilityLifecycleStage];

/**
 * Permitted forward transitions. Moving "backwards" is not a deletion — it is
 * a new transition row with a reason, so history is never rewritten.
 */
export const LIFECYCLE_TRANSITIONS: Record<FacilityLifecycleStage, FacilityLifecycleStage[]> = {
  PRE_ASSESSMENT: ['DUE_DILIGENCE', 'SUSPENDED'],
  DUE_DILIGENCE: ['FIELD_ASSESSMENT', 'SUSPENDED'],
  FIELD_ASSESSMENT: ['BASELINE_ESTABLISHED', 'SUSPENDED'],
  BASELINE_ESTABLISHED: ['PLANNING', 'SUSPENDED'],
  PLANNING: ['PROPOSAL', 'SUSPENDED'],
  PROPOSAL: ['GOVERNMENT_REVIEW', 'SUSPENDED'],
  GOVERNMENT_REVIEW: ['AGREEMENT', 'PROPOSAL', 'SUSPENDED'],
  AGREEMENT: ['IMPLEMENTATION', 'SUSPENDED'],
  IMPLEMENTATION: ['COMMISSIONING', 'SUSPENDED'],
  COMMISSIONING: ['LIVE_OPERATIONS', 'IMPLEMENTATION', 'SUSPENDED'],
  LIVE_OPERATIONS: ['CONTINUOUS_IMPROVEMENT', 'SUSPENDED', 'EXITED'],
  CONTINUOUS_IMPROVEMENT: ['LIVE_OPERATIONS', 'SUSPENDED', 'EXITED'],
  SUSPENDED: [
    'PRE_ASSESSMENT',
    'DUE_DILIGENCE',
    'FIELD_ASSESSMENT',
    'BASELINE_ESTABLISHED',
    'PLANNING',
    'PROPOSAL',
    'GOVERNMENT_REVIEW',
    'AGREEMENT',
    'IMPLEMENTATION',
    'COMMISSIONING',
    'LIVE_OPERATIONS',
    'EXITED',
  ],
  EXITED: [],
};

export function canTransition(from: FacilityLifecycleStage, to: FacilityLifecycleStage): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Stages at which Mode B (live operations) modules become available. */
export const MODE_B_STAGES: FacilityLifecycleStage[] = [
  'COMMISSIONING',
  'LIVE_OPERATIONS',
  'CONTINUOUS_IMPROVEMENT',
];

export function isLiveOperations(stage: FacilityLifecycleStage): boolean {
  return MODE_B_STAGES.includes(stage);
}

/** Investment priority classes (spec §18). */
export const PriorityClass = { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' } as const;
export type PriorityClass = (typeof PriorityClass)[keyof typeof PriorityClass];

export const PRIORITY_DESCRIPTION: Record<PriorityClass, string> = {
  P1: 'Critical — must be complete before opening.',
  P2: 'High — within the first 100 days.',
  P3: 'Development — within 12 months.',
  P4: 'Expansion — long term.',
};

/** RAG status, always accompanied by its reasons. A colour alone is decoration. */
export const RagStatus = {
  GREEN: 'GREEN',
  AMBER: 'AMBER',
  RED: 'RED',
  NOT_ASSESSED: 'NOT_ASSESSED',
} as const;
export type RagStatus = (typeof RagStatus)[keyof typeof RagStatus];

export const ragResultSchema = z.object({
  status: z.nativeEnum(RagStatus),
  score: z.number().nullable(),
  /** Required: the reasons ARE the product (doc 15 §8). */
  reasons: z.array(
    z.object({
      component: z.string(),
      score: z.number().nullable(),
      status: z.nativeEnum(RagStatus),
      detail: z.string(),
      drillDownHref: z.string().optional(),
    }),
  ),
  computedAt: isoDateTimeSchema,
});

/**
 * Baseline / current / target, the six-tuple every headline metric resolves to
 * (doc 00 §7).
 *
 * `baseline` is read from the sealed snapshot; `current` is always recomputed
 * from transactions. They are structurally incapable of being conflated.
 */
export const metricComparisonSchema = z.object({
  metricCode: z.string(),
  metricName: z.string(),
  unit: z.string().nullable(),
  baseline: z.number().nullable(),
  current: z.number().nullable(),
  target: z.number().nullable(),
  varianceToTarget: z.number().nullable(),
  changeFromBaseline: z.number().nullable(),
  trend: z.enum(['IMPROVING', 'STABLE', 'DETERIORATING', 'INSUFFICIENT_DATA']),
  /** Sample size behind the trend, so noise is not read as a signal. */
  trendSampleSize: z.number().int().nonnegative().nullable(),
  baselineAsOf: isoDateSchema.nullable(),
  computedAt: isoDateTimeSchema,
});

export type MetricComparison = z.infer<typeof metricComparisonSchema>;
