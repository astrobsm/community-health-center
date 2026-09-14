import { z } from 'zod';

import { dataClassificationSchema } from './classification.js';
import { PriorityClass, isoDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';

/** Needs, CAPEX, risk and the five-year financial model (spec §§17-20, 34). */

// -----------------------------------------------------------------------------
// Needs and recommendations
// -----------------------------------------------------------------------------

export const createNeedSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  /** The finding this need arises from. Its absence must be justified. */
  findingId: uuidSchema.optional(),
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  domainCode: z.string().max(50).optional(),
  /**
   * Required when there is no finding.
   *
   * A need with no observed basis is not forbidden — a regulator may impose one
   * — but it must say where it came from, or the chain from observation to
   * spending is broken at its first link.
   */
  unlinkedReason: z.string().min(10).max(1000).optional(),
});
export type CreateNeed = z.infer<typeof createNeedSchema>;

export const createRecommendationSchema = z.object({
  id: uuidSchema.optional(),
  needId: uuidSchema,
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  expectedOutcome: z.string().max(1000).optional(),
  priorityClass: z.nativeEnum(PriorityClass).optional(),
});
export type CreateRecommendation = z.infer<typeof createRecommendationSchema>;

// -----------------------------------------------------------------------------
// CAPEX
// -----------------------------------------------------------------------------

export const CapexCategory = {
  BUILDING: 'BUILDING',
  EQUIPMENT: 'EQUIPMENT',
  LABORATORY: 'LABORATORY',
  PHARMACY: 'PHARMACY',
  FURNITURE: 'FURNITURE',
  ICT: 'ICT',
  POWER: 'POWER',
  WATER: 'WATER',
  SECURITY: 'SECURITY',
  WASTE: 'WASTE',
  INITIAL_STOCK: 'INITIAL_STOCK',
  WORKING_CAPITAL: 'WORKING_CAPITAL',
  TRAINING: 'TRAINING',
  CONTINGENCY: 'CONTINGENCY',
} as const;
export type CapexCategory = (typeof CapexCategory)[keyof typeof CapexCategory];

export const createCapexLineSchema = z.object({
  id: uuidSchema.optional(),
  capexPlanId: uuidSchema,
  /** Lineage to the observed problem. */
  recommendationId: uuidSchema.optional(),
  category: z.nativeEnum(CapexCategory),
  description: z.string().min(3).max(500),
  quantity: z.number().positive().default(1),
  unit: z.string().max(50).optional(),
  unitCostMinor: z.union([z.bigint(), z.number().int().nonnegative()]),
  priorityClass: z.nativeEnum(PriorityClass).default('P3'),
  /**
   * Where the figure came from: a quotation, a previous purchase, a rule of
   * thumb. An estimate with no stated basis is a guess, and a guess that later
   * becomes an approved budget is how projects overrun.
   */
  costBasis: z.string().max(500).optional(),
});
export type CreateCapexLine = z.infer<typeof createCapexLineSchema>;

export const approveCapexLineSchema = z.object({
  approvedCostMinor: z.union([z.bigint(), z.number().int().nonnegative()]),
  /** Required when the approved figure differs from the estimate. */
  reason: z.string().max(1000).optional(),
});

// -----------------------------------------------------------------------------
// Financial model assumptions (spec §34)
// -----------------------------------------------------------------------------

/**
 * One line of the service mix.
 *
 * Revenue per patient is derived from the mix and the tariffs rather than
 * entered directly, so a tariff change propagates instead of leaving a stale
 * average behind.
 */
export const serviceLineSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  /** Share of encounters, 0..1. The lines must sum to 1. */
  share: z.number().min(0).max(1),
  tariffMinor: z.number().int().nonnegative(),
  /** Direct cost as a proportion of the tariff — drugs, reagents, consumables. */
  variableCostRatio: z.number().min(0).max(1).default(0),
});
export type ServiceLine = z.infer<typeof serviceLineSchema>;

export const capexScheduleEntrySchema = z.object({
  periodIndex: z.number().int().min(0),
  amountMinor: z.number().int().nonnegative(),
  label: z.string().max(200).optional(),
});

/**
 * The model's inputs. Every one is classified ASSUMPTION and never promoted.
 *
 * These are deliberately explicit rather than bundled into a single "growth
 * rate": a partnership is negotiated on these numbers, and each one has to be
 * arguable on its own.
 */
export const modelAssumptionsSchema = z
  .object({
    patientsPerDay: z.number().positive(),
    operatingDaysPerMonth: z.number().positive().max(31),
    serviceLines: z.array(serviceLineSchema).min(1),

    /** Compound annual growth in patient volume, as a proportion. */
    annualGrowthRate: z.number().min(-1).max(5).default(0),
    /** Compound annual inflation applied to costs. */
    annualInflationRate: z.number().min(0).max(5).default(0),

    fixedMonthlyCostMinor: z.number().int().nonnegative(),
    staffMonthlyCostMinor: z.number().int().nonnegative(),
    /** Staff incentive pool as a proportion of operating surplus. */
    incentivePoolRate: z.number().min(0).max(1).default(0),

    /** Proportion of billed revenue ultimately collected. */
    collectionRate: z.number().min(0).max(1).default(1),
    /** Average days between service and collection. */
    collectionLagDays: z.number().min(0).max(365).default(0),

    capexSchedule: z.array(capexScheduleEntrySchema).default([]),
    workingCapitalMinor: z.number().int().nonnegative().default(0),
    openingCashMinor: z.number().int().default(0),

    /** Straight-line depreciation period for capitalised spend. */
    depreciationYears: z.number().positive().max(50).default(10),
  })
  .superRefine((assumptions, ctx) => {
    const total = assumptions.serviceLines.reduce((sum, line) => sum + line.share, 0);
    // A mix that does not sum to 1 silently mis-states revenue per patient,
    // and the error is invisible in the output.
    if (Math.abs(total - 1) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceLines'],
        message: `Service mix shares must sum to 1 (100% of encounters); they sum to ${total.toFixed(3)}.`,
      });
    }
  });
export type ModelAssumptions = z.infer<typeof modelAssumptionsSchema>;

export const ScenarioType = {
  CONSERVATIVE: 'CONSERVATIVE',
  BASE: 'BASE',
  GROWTH: 'GROWTH',
  STRESS: 'STRESS',
} as const;
export type ScenarioType = (typeof ScenarioType)[keyof typeof ScenarioType];

// -----------------------------------------------------------------------------
// Projections
// -----------------------------------------------------------------------------

export const projectionPeriodSchema = z.object({
  periodIndex: z.number().int().min(0),
  patients: z.number(),
  revenueMinor: z.number().int(),
  collectionsMinor: z.number().int(),
  /**
   * Billed revenue the collection rate says will never arrive, recognised as
   * a cost in the period it is billed rather than left inflating surplus.
   */
  badDebtMinor: z.number().int(),
  directCostMinor: z.number().int(),
  opexMinor: z.number().int(),
  staffCostMinor: z.number().int(),
  incentiveMinor: z.number().int(),
  depreciationMinor: z.number().int(),
  /** Revenue less uncollectables, direct costs, opex, staff and incentives. Before depreciation. */
  ebitdaMinor: z.number().int(),
  surplusMinor: z.number().int(),
  cumulativeSurplusMinor: z.number().int(),
  capexMinor: z.number().int(),
  cashBalanceMinor: z.number().int(),
});
export type ProjectionPeriod = z.infer<typeof projectionPeriodSchema>;

export const projectionResultSchema = z.object({
  periods: z.array(projectionPeriodSchema),
  /**
   * First period in which cumulative surplus turns non-negative.
   *
   * NULL when it never does. A model that never breaks even must say so — a
   * fabricated month here would be the single most misleading number the
   * system could produce.
   */
  breakEvenPeriod: z.number().int().nullable(),
  /** First period in which cumulative net cash covers total investment. */
  paybackPeriod: z.number().int().nullable(),
  totalInvestmentMinor: z.number().int(),
  totalRevenueMinor: z.number().int(),
  totalSurplusMinor: z.number().int(),
  /** The lowest cash balance reached, and when. Drives working capital. */
  lowestCashMinor: z.number().int(),
  lowestCashPeriod: z.number().int(),
  classification: dataClassificationSchema,
});
export type ProjectionResult = z.infer<typeof projectionResultSchema>;

// -----------------------------------------------------------------------------
// Sensitivity (spec §34)
// -----------------------------------------------------------------------------

export const sensitivityEntrySchema = z.object({
  driver: z.string(),
  /** -0.3, -0.2, -0.1, +0.1, +0.2, +0.3 */
  variation: z.number(),
  breakEvenPeriod: z.number().int().nullable(),
  paybackPeriod: z.number().int().nullable(),
  totalSurplusMinor: z.number().int(),
  /** Change against the base case, as a proportion. */
  surplusDelta: z.number().nullable(),
});

export const sensitivityResultSchema = z.object({
  base: z.object({
    breakEvenPeriod: z.number().int().nullable(),
    paybackPeriod: z.number().int().nullable(),
    totalSurplusMinor: z.number().int(),
  }),
  entries: z.array(sensitivityEntrySchema),
  /** Drivers ordered by how much the result moves. The ones worth arguing about. */
  mostSensitiveDrivers: z.array(z.string()),
  computedAt: isoDateTimeSchema,
});
export type SensitivityResult = z.infer<typeof sensitivityResultSchema>;

// -----------------------------------------------------------------------------
// Change impact (spec §72)
// -----------------------------------------------------------------------------

export const impactLineSchema = z.object({
  output: z.string(),
  label: z.string(),
  before: z.union([z.number(), z.null()]),
  after: z.union([z.number(), z.null()]),
  unit: z.string(),
  /** Proportional change, or null when a value went from or to null. */
  changeRatio: z.number().nullable(),
  /** Set when the change crosses a threshold someone agreed to. */
  warning: z.string().optional(),
});

export const changeImpactSchema = z.object({
  assumptionCode: z.string(),
  label: z.string(),
  before: z.number(),
  after: z.number(),
  impacts: z.array(impactLineSchema),
  /** True when the model is approved and must be unlocked before changing. */
  requiresUnlock: z.boolean(),
  computedAt: isoDateTimeSchema,
});
export type ChangeImpact = z.infer<typeof changeImpactSchema>;

export const applyAssumptionChangeSchema = z.object({
  value: z.number(),
  /** Mandatory: a changed assumption in an approved model needs a rationale. */
  reason: z.string().min(10).max(1000),
  /** Acknowledges the impact preview. */
  confirmImpact: z.literal(true),
});

// -----------------------------------------------------------------------------
// Risk (spec §20)
// -----------------------------------------------------------------------------

export const createRiskSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  projectId: uuidSchema.optional(),
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  category: z.string().max(100).optional(),
  /** 1-5 each; the product is the score. */
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  mitigation: z.string().max(2000).optional(),
  contingency: z.string().max(2000).optional(),
  ownerUserId: uuidSchema.optional(),
  reviewDate: isoDateSchema.optional(),
});
export type CreateRisk = z.infer<typeof createRiskSchema>;
