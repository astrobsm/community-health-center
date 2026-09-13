import { z } from 'zod';

import { dataClassificationSchema } from './classification.js';
import {
  PriorityClass,
  clientSyncMetadataSchema,
  isoDateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common.js';

/** Field assessment, evidence and baseline contracts (spec §§15-17, doc 02 §3). */

export const ResponseType = {
  BOOLEAN: 'BOOLEAN',
  SCALE: 'SCALE',
  NUMBER: 'NUMBER',
  TEXT: 'TEXT',
  SELECT: 'SELECT',
  MULTISELECT: 'MULTISELECT',
  DATE: 'DATE',
  CURRENCY: 'CURRENCY',
} as const;
export type ResponseType = (typeof ResponseType)[keyof typeof ResponseType];

// -----------------------------------------------------------------------------
// Scoring rules — configuration, never code (spec §89)
// -----------------------------------------------------------------------------

/**
 * How an answer maps to a 0..1 score for the facility condition index.
 *
 * `NOT_SCORED` is a first-class option rather than an omission: a free-text
 * observation carries real information but cannot be meaningfully reduced to a
 * number, and pretending otherwise would corrupt the index.
 */
export const scoringRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('BOOLEAN'),
    /** Score when the answer is true. `false` scores 1 - this. */
    trueScore: z.number().min(0).max(1).default(1),
  }),
  z.object({
    kind: z.literal('SCALE'),
    min: z.number(),
    max: z.number(),
    /** When true, a LOWER value scores higher (e.g. a defect count). */
    inverted: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('NUMBER'),
    /** The value at which the item scores 1. */
    target: z.number().positive(),
    /** Values above the target are capped at 1 rather than rewarded further. */
    inverted: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('SELECT'),
    /** choice -> score. A choice absent from the map scores 0. */
    scores: z.record(z.string(), z.number().min(0).max(1)),
  }),
  z.object({
    kind: z.literal('MULTISELECT'),
    /** Score is the proportion of `expected` choices that were selected. */
    expected: z.array(z.string()).min(1),
  }),
  z.object({ kind: z.literal('NOT_SCORED') }),
]);
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

// -----------------------------------------------------------------------------
// Answers
// -----------------------------------------------------------------------------

/**
 * The shape of an answer depends on the item's response type.
 *
 * `null` means genuinely unanswered. A separate `notApplicable` flag records
 * "this does not apply here", which is a different fact and must not be scored
 * as zero — doing so would understate a facility that legitimately has no
 * laboratory.
 */
export const answerSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.string()),
  z.null(),
]);
export type Answer = z.infer<typeof answerSchema>;

export const saveResponseSchema = z.object({
  /** Client-generated, so the record has its identity before it reaches us. */
  id: uuidSchema,
  itemId: uuidSchema,
  answer: answerSchema,
  note: z.string().max(4000).optional(),
  notApplicable: z.boolean().default(false),
  /**
   * How this answer was obtained. An assessor reading a register produces
   * VERIFIED; a figure quoted by a staff member is REPORTED. The difference
   * survives all the way into the generated report.
   */
  classification: dataClassificationSchema.default('REPORTED'),
  evidenceIds: z.array(uuidSchema).default([]),
  ...clientSyncMetadataSchema.omit({ id: true }).shape,
});
export type SaveResponse = z.infer<typeof saveResponseSchema>;

export const saveResponseBatchSchema = z.object({
  responses: z.array(saveResponseSchema).min(1).max(200),
});

// -----------------------------------------------------------------------------
// Assessments
// -----------------------------------------------------------------------------

export const AssessmentType = {
  PRE_ASSESSMENT: 'PRE_ASSESSMENT',
  DUE_DILIGENCE: 'DUE_DILIGENCE',
  FIELD: 'FIELD',
  FOLLOW_UP: 'FOLLOW_UP',
  POST_INTERVENTION: 'POST_INTERVENTION',
} as const;
export type AssessmentType = (typeof AssessmentType)[keyof typeof AssessmentType];

export const createAssessmentSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  templateCode: z.string().min(1).default('FIELD_ASSESSMENT_V1'),
  assessmentType: z.nativeEnum(AssessmentType),
  title: z.string().max(200).optional(),
  leadAssessorId: uuidSchema.optional(),
});
export type CreateAssessment = z.infer<typeof createAssessmentSchema>;

export const submitAssessmentSchema = z.object({
  /** Acknowledges submitting below the configured completeness threshold. */
  acknowledgeIncomplete: z.boolean().default(false),
  note: z.string().max(2000).optional(),
});

/** Progress, reported per section so an assessor knows exactly what remains. */
export const sectionProgressSchema = z.object({
  sectionId: uuidSchema,
  code: z.string(),
  name: z.string(),
  sequence: z.number().int(),
  requiredItems: z.number().int().nonnegative(),
  answeredRequired: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  answeredTotal: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  completionPercent: z.number().min(0).max(100),
  /** Items that require evidence and do not yet have any. */
  missingEvidence: z.number().int().nonnegative(),
});
export type SectionProgress = z.infer<typeof sectionProgressSchema>;

export const assessmentProgressSchema = z.object({
  assessmentId: uuidSchema,
  completionPercent: z.number().min(0).max(100),
  requiredItems: z.number().int().nonnegative(),
  answeredRequired: z.number().int().nonnegative(),
  missingEvidence: z.number().int().nonnegative(),
  sections: z.array(sectionProgressSchema),
  computedAt: isoDateTimeSchema,
});
export type AssessmentProgress = z.infer<typeof assessmentProgressSchema>;

// -----------------------------------------------------------------------------
// Facility condition index (spec §17)
// -----------------------------------------------------------------------------

export const domainScoreSchema = z.object({
  domainCode: z.string(),
  name: z.string(),
  rawScore: z.number(),
  maxScore: z.number(),
  weight: z.number(),
  /** 0..1. Null when every item in the domain was excluded. */
  normalisedScore: z.number().min(0).max(1).nullable(),
  scoredItems: z.number().int().nonnegative(),
  /**
   * Items excluded as not applicable or not scoreable. Excluded — NOT scored
   * zero, which would silently understate readiness.
   */
  excludedItems: z.number().int().nonnegative(),
});
export type DomainScore = z.infer<typeof domainScoreSchema>;

export const readinessScoreSchema = z.object({
  /** 0..1, or null when nothing scoreable has been answered. */
  overall: z.number().min(0).max(1).nullable(),
  domains: z.array(domainScoreSchema),
  /**
   * Proportion of scoreable items actually answered. A high score over a
   * thin sample is not the same as a high score over a complete one, and the
   * UI must be able to say so.
   */
  coverage: z.number().min(0).max(1),
  computedAt: isoDateTimeSchema,
});
export type ReadinessScore = z.infer<typeof readinessScoreSchema>;

// -----------------------------------------------------------------------------
// Findings (spec §18)
// -----------------------------------------------------------------------------

// PriorityClass itself lives in common.ts, because CAPEX lines and capital
// projects use the same four classes as findings do.
export type PriorityClassValue = PriorityClass;

/**
 * The inputs to the prioritisation score. Each 0..5, assessed by a human.
 *
 * They are stored alongside the computed score so a later reviewer can see
 * exactly why something was ranked as it was — a bare priority letter is an
 * assertion, the inputs are an argument.
 */
export const priorityInputsSchema = z.object({
  clinicalImportance: z.number().min(0).max(5),
  safetyRisk: z.number().min(0).max(5),
  urgency: z.number().min(0).max(5),
  patientImpact: z.number().min(0).max(5),
  sustainability: z.number().min(0).max(5),
  costBurden: z.number().min(0).max(5),
});
export type PriorityInputs = z.infer<typeof priorityInputsSchema>;

export const createFindingSchema = z.object({
  id: uuidSchema.optional(),
  responseId: uuidSchema.optional(),
  facilityId: uuidSchema,
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  priorityInputs: priorityInputsSchema.optional(),
  /** Overriding the computed class requires a reason (spec §18). */
  priorityOverride: z.nativeEnum(PriorityClass).optional(),
  priorityOverrideReason: z.string().min(10).max(1000).optional(),
  estimatedCostMinor: z.union([z.bigint(), z.number().int().nonnegative()]).optional(),
  recommendationText: z.string().max(2000).optional(),
  evidenceIds: z.array(uuidSchema).default([]),
});
export type CreateFinding = z.infer<typeof createFindingSchema>;

// -----------------------------------------------------------------------------
// Evidence (spec §16)
// -----------------------------------------------------------------------------

export const EvidenceSource = {
  PHOTOGRAPH: 'PHOTOGRAPH',
  DOCUMENT: 'DOCUMENT',
  SCANNED_DOCUMENT: 'SCANNED_DOCUMENT',
  INTERVIEW: 'INTERVIEW',
  FINANCIAL_RECORD: 'FINANCIAL_RECORD',
  SYSTEM_RECORD: 'SYSTEM_RECORD',
  OBSERVATION: 'OBSERVATION',
} as const;
export type EvidenceSource = (typeof EvidenceSource)[keyof typeof EvidenceSource];

export const EvidenceStage = {
  BEFORE: 'BEFORE',
  DURING: 'DURING',
  AFTER: 'AFTER',
  BASELINE: 'BASELINE',
  ROUTINE: 'ROUTINE',
} as const;
export type EvidenceStage = (typeof EvidenceStage)[keyof typeof EvidenceStage];

/**
 * Step 1 of upload: register the evidence and receive a pre-signed URL.
 *
 * The metadata record syncs immediately and the bytes follow on a separate
 * channel, so an assessment is complete and reportable before its photographs
 * have finished uploading (doc 10 §7).
 */
export const createEvidenceSchema = z.object({
  id: uuidSchema,
  facilityId: uuidSchema,
  source: z.nativeEnum(EvidenceSource),
  description: z.string().max(1000).optional(),
  capturedOn: isoDateTimeSchema.optional(),
  stage: z.nativeEnum(EvidenceStage).default('BASELINE'),
  category: z.string().max(100).optional(),
  /** Media details, when this evidence carries a file. */
  media: z
    .object({
      fileName: z.string().max(255),
      contentType: z.string().max(100),
      sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
      /** SHA-256 of the bytes — detects duplicates and proves integrity. */
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .optional(),
  /** Attached only with explicit consent (doc 09 §5). */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  ...clientSyncMetadataSchema.omit({ id: true }).shape,
});
export type CreateEvidence = z.infer<typeof createEvidenceSchema>;

export const uploadIntentSchema = z.object({
  evidenceId: uuidSchema,
  uploadUrl: z.string().url(),
  /** Headers the client must send verbatim with the upload. */
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema,
});

export const verifyEvidenceSchema = z.object({
  verificationNote: z.string().max(1000).optional(),
});

// -----------------------------------------------------------------------------
// Baseline (spec §12)
// -----------------------------------------------------------------------------

export const sealBaselineSchema = z.object({
  label: z.string().min(3).max(200).default('Baseline — Day 0'),
  asOfDate: isoDateSchema,
  notes: z.string().max(4000).optional(),
  /**
   * Sealing is irreversible: the snapshot can never be edited or deleted, and
   * every later comparison is measured against it. The client must say so out
   * loud rather than have it happen as a side effect of a save.
   */
  confirmIrreversible: z.literal(true),
});
export type SealBaseline = z.infer<typeof sealBaselineSchema>;

export const baselineMetricSchema = z.object({
  metricCode: z.string(),
  metricName: z.string(),
  domainCode: z.string().nullable(),
  numericValue: z.number().nullable(),
  textValue: z.string().nullable(),
  unit: z.string().nullable(),
  classification: dataClassificationSchema,
  sourceReference: z.string().nullable(),
  evidenceCount: z.number().int().nonnegative(),
});
export type BaselineMetric = z.infer<typeof baselineMetricSchema>;

export const baselineSnapshotSchema = z.object({
  id: uuidSchema,
  facilityId: uuidSchema,
  sequence: z.number().int().positive(),
  label: z.string(),
  asOfDate: isoDateSchema,
  sealedAt: isoDateTimeSchema,
  sealedBy: uuidSchema.nullable(),
  contentHash: z.string(),
  metrics: z.array(baselineMetricSchema),
});
export type BaselineSnapshot = z.infer<typeof baselineSnapshotSchema>;
