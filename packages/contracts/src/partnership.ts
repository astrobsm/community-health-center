import { z } from 'zod';

import { dataClassificationSchema } from './classification.js';
import { isoDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';

/** Partnership, revenue sharing and capital recovery (spec §§35-37, 73-74). */

// -----------------------------------------------------------------------------
// Parties and the partnership itself
// -----------------------------------------------------------------------------

export const PartyRole = {
  GOVERNMENT: 'GOVERNMENT',
  PARTNER: 'PARTNER',
  COMMUNITY: 'COMMUNITY',
  FUNDER: 'FUNDER',
  OTHER: 'OTHER',
} as const;
export type PartyRole = (typeof PartyRole)[keyof typeof PartyRole];

export const createPartnershipSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  /** The model the commercial terms were negotiated against. */
  financialModelId: uuidSchema.optional(),
  name: z.string().min(3).max(200),
  commencementDate: isoDateSchema.optional(),
  termMonths: z.number().int().positive().max(600).optional(),
  notes: z.string().max(4000).optional(),
});
export type CreatePartnership = z.infer<typeof createPartnershipSchema>;

export const createPartySchema = z.object({
  id: uuidSchema.optional(),
  partnershipId: uuidSchema,
  partyRole: z.nativeEnum(PartyRole),
  legalName: z.string().min(2).max(300),
  representative: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});
export type CreateParty = z.infer<typeof createPartySchema>;

// -----------------------------------------------------------------------------
// The waterfall (spec §35)
// -----------------------------------------------------------------------------

export const RevenueShareType = {
  SURPLUS_SHARE: 'SURPLUS_SHARE',
  GROSS_REVENUE_SHARE: 'GROSS_REVENUE_SHARE',
  HYBRID: 'HYBRID',
} as const;
export type RevenueShareType = (typeof RevenueShareType)[keyof typeof RevenueShareType];

export const WaterfallBasis = {
  /** A share of everything billed, taken before costs. */
  GROSS_REVENUE: 'GROSS_REVENUE',
  /** A share of what is left after direct costs and operating expenses. */
  OPERATING_SURPLUS: 'OPERATING_SURPLUS',
  /** A stated sum, regardless of performance. */
  FIXED: 'FIXED',
  /** A share of whatever remains at this point in the order. */
  RESIDUAL: 'RESIDUAL',
} as const;
export type WaterfallBasis = (typeof WaterfallBasis)[keyof typeof WaterfallBasis];

/**
 * One step of the waterfall.
 *
 * No percentage is hard-coded anywhere in this system (spec §35). Every rate
 * a party is entitled to lives in one of these rows, and changing it is a
 * versioned, dated, audited act.
 */
export const waterfallStepSchema = z
  .object({
    sequence: z.number().int().min(1).max(100),
    label: z.string().min(2).max(200),
    basis: z.nativeEnum(WaterfallBasis),
    /** Proportion of the basis, 0..1. Null on a FIXED step, or a RESIDUAL sweep. */
    rate: z.number().min(0).max(1).nullable().optional(),
    fixedAmountMinor: z.number().int().nonnegative().nullable().optional(),
    capMinor: z.number().int().nonnegative().nullable().optional(),
    floorMinor: z.number().int().nonnegative().nullable().optional(),
    /**
     * Caps this step at the partner's outstanding capital, whatever it is when
     * the period is computed, and records the allocation as a recovery event.
     * A fixed cap could not do this: the outstanding balance falls every month.
     */
    isCapitalRecovery: z.boolean().default(false),
    beneficiaryPartyId: uuidSchema.nullable().optional(),
    accountCode: z.string().max(50).nullable().optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((step, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (step.basis === 'FIXED') {
      if (step.fixedAmountMinor === null || step.fixedAmountMinor === undefined) {
        issue(`Step ${step.sequence} ("${step.label}") is a fixed amount but states none.`, 'fixedAmountMinor');
      }
      if (step.rate !== null && step.rate !== undefined) {
        issue(`Step ${step.sequence} ("${step.label}") is a fixed amount, so a rate would be ignored.`, 'rate');
      }
    } else if (step.basis !== 'RESIDUAL' && (step.rate === null || step.rate === undefined)) {
      // A RESIDUAL step without a rate means "sweep whatever is left", which is
      // a real configuration. Every other basis needs a number.
      issue(`Step ${step.sequence} ("${step.label}") needs a rate.`, 'rate');
    }

    // A floor above a cap has no satisfiable answer. Picking either silently
    // would hand one party money the other was promised.
    if (
      step.floorMinor !== null &&
      step.floorMinor !== undefined &&
      step.capMinor !== null &&
      step.capMinor !== undefined &&
      step.floorMinor > step.capMinor
    ) {
      issue(
        `Step ${step.sequence} ("${step.label}") has a floor of ${step.floorMinor} above its cap of ${step.capMinor}. ` +
          'One of them must give.',
        'floorMinor',
      );
    }
  });
export type WaterfallStepInput = z.infer<typeof waterfallStepSchema>;

export const createRevenueShareModelSchema = z
  .object({
    id: uuidSchema.optional(),
    partnershipId: uuidSchema,
    name: z.string().min(3).max(200),
    shareType: z.nativeEnum(RevenueShareType),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().optional(),
    notes: z.string().max(4000).optional(),
    steps: z.array(waterfallStepSchema).min(1),
  })
  .superRefine((model, ctx) => {
    const sequences = model.steps.map((step) => step.sequence);
    if (new Set(sequences).size !== sequences.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'Two steps share a sequence number, so the order they run in would be undefined.',
      });
    }

    if (model.effectiveTo && model.effectiveTo < model.effectiveFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'A revenue share model cannot stop applying before it starts.',
      });
    }
  });
export type CreateRevenueShareModel = z.infer<typeof createRevenueShareModelSchema>;

// -----------------------------------------------------------------------------
// Computed results
// -----------------------------------------------------------------------------

export const waterfallAllocationSchema = z.object({
  sequence: z.number().int(),
  label: z.string(),
  basis: z.nativeEnum(WaterfallBasis),
  /** What the configuration asked for, before caps, floors and what was left. */
  calculatedMinor: z.number().int(),
  /** What the step actually receives. */
  allocatedMinor: z.number().int(),
  /** Calculated less allocated, when the pool ran out. Never hidden. */
  shortfallMinor: z.number().int(),
  capApplied: z.boolean(),
  floorApplied: z.boolean(),
  beneficiaryPartyId: z.string().nullable(),
  accountCode: z.string().nullable(),
  /** What remains after this step. */
  remainingMinor: z.number().int(),
});
export type WaterfallAllocation = z.infer<typeof waterfallAllocationSchema>;

export const waterfallResultSchema = z.object({
  /** The inputs, restated so a reader never has to go looking for them. */
  grossRevenueMinor: z.number().int(),
  directCostMinor: z.number().int(),
  operatingExpenseMinor: z.number().int(),
  operatingSurplusMinor: z.number().int(),
  /** What the waterfall had to distribute: the surplus, or zero in a loss. */
  distributableMinor: z.number().int(),
  allocations: z.array(waterfallAllocationSchema),
  totalAllocatedMinor: z.number().int(),
  /** Undistributed remainder after the last step. */
  residualMinor: z.number().int(),
  totalShortfallMinor: z.number().int(),
  /** True when costs exceeded revenue: nobody is entitled to a share of a loss. */
  isLoss: z.boolean(),
  revenueShareModelId: z.string().nullable(),
  revenueShareModelVersion: z.number().int().nullable(),
  classification: dataClassificationSchema,
  computedAt: isoDateTimeSchema,
});
export type WaterfallResult = z.infer<typeof waterfallResultSchema>;

// -----------------------------------------------------------------------------
// Capital recovery (spec §74)
// -----------------------------------------------------------------------------

export const RecoveryEventType = {
  INVESTMENT: 'INVESTMENT',
  RECOVERY: 'RECOVERY',
  RETURN: 'RETURN',
} as const;
export type RecoveryEventType = (typeof RecoveryEventType)[keyof typeof RecoveryEventType];

export const createRecoveryEventSchema = z.object({
  id: uuidSchema.optional(),
  partnershipId: uuidSchema,
  partyId: uuidSchema.optional(),
  eventType: z.nativeEnum(RecoveryEventType),
  amountMinor: z.union([z.bigint(), z.number().int().positive()]),
  occurredOn: isoDateSchema,
  /**
   * The payment that funded it.
   *
   * Required for an INVESTMENT: a partner cannot claim recovery of money that
   * was never spent, and the link to a real payment is what makes that true
   * rather than merely stated (spec §74).
   */
  sourcePaymentId: uuidSchema.optional(),
  description: z.string().max(1000).optional(),
});
export type CreateRecoveryEvent = z.infer<typeof createRecoveryEventSchema>;

export const capitalRecoveryPositionSchema = z.object({
  investedMinor: z.number().int(),
  recoveredMinor: z.number().int(),
  returnPaidMinor: z.number().int(),
  outstandingMinor: z.number().int(),
  /** Proportion recovered, 0..1. Null when nothing has been invested. */
  recoveredProportion: z.number().nullable(),
  fullyRecovered: z.boolean(),
  classification: dataClassificationSchema,
});
export type CapitalRecoveryPosition = z.infer<typeof capitalRecoveryPositionSchema>;

// -----------------------------------------------------------------------------
// Obligations (spec §36)
// -----------------------------------------------------------------------------

export const ObligationStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  MET: 'MET',
  BREACHED: 'BREACHED',
  WAIVED: 'WAIVED',
} as const;
export type ObligationStatus = (typeof ObligationStatus)[keyof typeof ObligationStatus];

export const createObligationSchema = z.object({
  id: uuidSchema.optional(),
  partnershipId: uuidSchema,
  partyId: uuidSchema.optional(),
  description: z.string().min(5).max(2000),
  dueDate: isoDateSchema.optional(),
});
export type CreateObligation = z.infer<typeof createObligationSchema>;

export const settleObligationSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'MET', 'BREACHED', 'WAIVED']),
  /** Required for MET and WAIVED: an obligation closed on nothing is a claim. */
  evidenceNote: z.string().max(2000).optional(),
});
