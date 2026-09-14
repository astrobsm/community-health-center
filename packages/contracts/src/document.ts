import { z } from 'zod';

import { dataClassificationSchema } from './classification.js';
import { isoDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';

/** Document generation (spec §§49-52, doc 16). */

export const DocumentType = {
  PRE_ASSESSMENT_REPORT: 'PRE_ASSESSMENT_REPORT',
  DUE_DILIGENCE_REPORT: 'DUE_DILIGENCE_REPORT',
  BASELINE_REPORT: 'BASELINE_REPORT',
  NEEDS_ASSESSMENT: 'NEEDS_ASSESSMENT',
  CAPITAL_PLAN: 'CAPITAL_PLAN',
  FIVE_YEAR_FINANCIAL_REPORT: 'FIVE_YEAR_FINANCIAL_REPORT',
  BUSINESS_CASE: 'BUSINESS_CASE',
  FULL_PROPOSAL: 'FULL_PROPOSAL',
  CHAIRMAN_BRIEF: 'CHAIRMAN_BRIEF',
  LETTER: 'LETTER',
  IMPLEMENTATION_PLAN: 'IMPLEMENTATION_PLAN',
  MOU: 'MOU',
  MANAGEMENT_AGREEMENT: 'MANAGEMENT_AGREEMENT',
  COMMISSIONING_REPORT: 'COMMISSIONING_REPORT',
  MONTHLY_REPORT: 'MONTHLY_REPORT',
  QUARTERLY_REPORT: 'QUARTERLY_REPORT',
  ANNUAL_REPORT: 'ANNUAL_REPORT',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentStatus = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  REVISION: 'REVISION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

/**
 * How complete a document of each type must be before it may be submitted.
 *
 * Configurable per organisation; these are the defaults. A proposal that goes
 * to a government partner half-populated damages the credibility of every
 * figure in it, including the ones that were right.
 */
export const DEFAULT_COMPLETENESS_THRESHOLDS: Record<DocumentType, number> = {
  PRE_ASSESSMENT_REPORT: 80,
  DUE_DILIGENCE_REPORT: 90,
  BASELINE_REPORT: 95,
  NEEDS_ASSESSMENT: 90,
  CAPITAL_PLAN: 95,
  FIVE_YEAR_FINANCIAL_REPORT: 100,
  BUSINESS_CASE: 95,
  FULL_PROPOSAL: 95,
  CHAIRMAN_BRIEF: 90,
  LETTER: 100,
  IMPLEMENTATION_PLAN: 85,
  MOU: 100,
  MANAGEMENT_AGREEMENT: 100,
  COMMISSIONING_REPORT: 90,
  MONTHLY_REPORT: 85,
  QUARTERLY_REPORT: 90,
  ANNUAL_REPORT: 95,
};

// -----------------------------------------------------------------------------
// The content of a document, before it is rendered
// -----------------------------------------------------------------------------

/**
 * One resolved figure.
 *
 * Carries its classification and where it came from, because a document that
 * states a number without saying whether it was counted, observed, estimated
 * or assumed is exactly what §82 forbids.
 */
export const documentValueSchema = z.object({
  kind: z.literal('VALUE'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  classification: dataClassificationSchema,
  /** The record or query this came from, for the provenance appendix. */
  source: z.string(),
  /** How it was arrived at. Required for anything not directly observed. */
  method: z.string().optional(),
});

/**
 * A figure that is not available.
 *
 * Never rendered as 0, blank, "—" or a substituted estimate. The document says
 * what is missing, why, and what would fix it (doc 16 §3).
 */
export const documentGapSchema = z.object({
  kind: z.literal('GAP'),
  label: z.string(),
  reason: z.string().min(5),
  /** What someone must do to fill it. A gap with no remedy is a dead end. */
  remedy: z.string().min(5),
  source: z.string(),
});

export const documentFieldSchema = z.discriminatedUnion('kind', [documentValueSchema, documentGapSchema]);
export type DocumentField = z.infer<typeof documentFieldSchema>;
export type DocumentValue = z.infer<typeof documentValueSchema>;
export type DocumentGap = z.infer<typeof documentGapSchema>;

export const documentSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  sequence: z.number().int().min(0),
  /** Free text, attributed and versioned. Never a place to type a figure. */
  narrative: z.string().optional(),
  fields: z.array(documentFieldSchema).default([]),
  /** Clause text for legal documents, which are prose rather than figures. */
  clauses: z.array(z.object({ number: z.string(), heading: z.string(), text: z.string() })).default([]),
});
export type DocumentSection = z.infer<typeof documentSectionSchema>;

// -----------------------------------------------------------------------------
// Completeness and provenance
// -----------------------------------------------------------------------------

export const completenessSchema = z.object({
  totalFields: z.number().int(),
  resolvedFields: z.number().int(),
  /** 100 when there is nothing to resolve — vacuously complete, and said so. */
  completenessPercent: z.number(),
  gaps: z.array(z.object({ section: z.string(), label: z.string(), reason: z.string(), remedy: z.string() })),
  /** Counts by classification, rendered in the appendix. */
  classificationSummary: z.record(z.string(), z.number()),
  /** The weakest classification any figure in the document carries. */
  weakestClassification: dataClassificationSchema.nullable(),
});
export type Completeness = z.infer<typeof completenessSchema>;

export const provenanceSchema = z.object({
  documentType: z.nativeEnum(DocumentType),
  title: z.string(),
  reference: z.string(),
  versionNumber: z.number().int(),
  supersedesVersion: z.number().int().nullable(),
  status: z.nativeEnum(DocumentStatus),
  generatedAt: isoDateTimeSchema,
  generatedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: isoDateTimeSchema.nullable(),
  reportingPeriodStart: isoDateSchema.nullable(),
  reportingPeriodEnd: isoDateSchema.nullable(),
  /** Every dataset the figures came from, named and dated. */
  sourceDatasets: z.array(z.object({ name: z.string(), detail: z.string() })),
  financialModel: z.string().nullable(),
  contentHash: z.string(),
  completeness: completenessSchema,
});
export type Provenance = z.infer<typeof provenanceSchema>;

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export const generateDocumentSchema = z.object({
  facilityId: uuidSchema,
  documentType: z.nativeEnum(DocumentType),
  title: z.string().min(3).max(300).optional(),
  reportingPeriodStart: isoDateSchema.optional(),
  reportingPeriodEnd: isoDateSchema.optional(),
  /** Narrative blocks by section key, attributed to their author. */
  narratives: z.record(z.string(), z.string().max(20_000)).optional(),
  /** For financial sections. */
  financialModelId: uuidSchema.optional(),
  partnershipId: uuidSchema.optional(),
});
export type GenerateDocument = z.infer<typeof generateDocumentSchema>;

export const submitDocumentSchema = z.object({
  note: z.string().max(2000).optional(),
});

export const approveDocumentSchema = z.object({
  /** Required on a rejection: a document sent back with no reason cannot be fixed. */
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(2000).optional(),
});

// -----------------------------------------------------------------------------
// Letters (spec §51)
// -----------------------------------------------------------------------------

export const createLetterSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  templateCode: z.string().min(2).max(50),
  recipientName: z.string().min(2).max(200),
  recipientTitle: z.string().max(200).optional(),
  recipientOffice: z.string().max(200).optional(),
  recipientAddress: z.string().max(500).optional(),
  senderName: z.string().max(200).optional(),
  senderTitle: z.string().max(200).optional(),
  enclosures: z.string().max(1000).optional(),
  /** Values for the template's merge fields. Every token must be supplied. */
  values: z.record(z.string(), z.string().max(4000)).default({}),
});
export type CreateLetter = z.infer<typeof createLetterSchema>;

export const dispatchLetterSchema = z.object({
  dispatchMethod: z.string().min(2).max(100),
  dispatchedAt: isoDateTimeSchema.optional(),
});

// -----------------------------------------------------------------------------
// Contracts and the MOU (spec §52)
// -----------------------------------------------------------------------------

export const ContractType = {
  MOU: 'MOU',
  MANAGEMENT_AGREEMENT: 'MANAGEMENT_AGREEMENT',
  SERVICE_AGREEMENT: 'SERVICE_AGREEMENT',
  AMENDMENT: 'AMENDMENT',
} as const;
export type ContractType = (typeof ContractType)[keyof typeof ContractType];

/**
 * The banner every unexecuted legal document carries, on every page (spec §83).
 *
 * Exported as a constant so the test that proves it cannot be removed compares
 * against the same string the generator uses.
 */
export const DRAFT_LEGAL_BANNER = 'DRAFT — SUBJECT TO LEGAL, GOVERNMENT AND PROFESSIONAL REVIEW';

/** Carried by anything the system generates that touches a legal obligation. */
export const LEGAL_REVIEW_NOTICE =
  'SUBJECT TO APPLICABLE LAW, GOVERNMENT APPROVAL AND PROFESSIONAL REVIEW';

export const generateContractSchema = z.object({
  partnershipId: uuidSchema,
  contractType: z.nativeEnum(ContractType),
  title: z.string().min(3).max(300).optional(),
  changeSummary: z.string().max(2000).optional(),
});
export type GenerateContract = z.infer<typeof generateContractSchema>;

export const executeContractSchema = z.object({
  /** Object storage key of the signed file. Without it there is no execution. */
  storageKey: z.string().min(3).max(500),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.optional(),
  signatories: z
    .array(
      z.object({
        partyId: uuidSchema.optional(),
        name: z.string().min(2).max(200),
        title: z.string().max(200),
        signedOn: isoDateSchema,
      }),
    )
    .min(2),
});
export type ExecuteContract = z.infer<typeof executeContractSchema>;
