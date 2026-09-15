import { z } from 'zod';

import { classifiedNumberSchema, dataClassificationSchema } from './classification.js';
import { isoDateSchema, uuidSchema } from './common.js';

/**
 * Analytics: dashboards, lineage, drill-down and data quality (spec §§38, 47,
 * 60, 71; criteria B and M).
 *
 * The important thing in this file is {@link figureSchema}. It is not a
 * convenience wrapper — it is the mechanism by which "no dashboard renders a
 * number without its classification and timestamp" stops being an instruction
 * and starts being something the process refuses to violate.
 *
 * Every dashboard response is parsed through these schemas before it leaves the
 * server. A developer who adds a bare number to a dashboard gets a failed
 * request, not a plausible-looking chart.
 */

// -----------------------------------------------------------------------------
// The figure
// -----------------------------------------------------------------------------

export const drillDownLevel = {
  /** Broken down by service line, cadre, department, account. */
  DIMENSION: 'DIMENSION',
  /** The individual transactions: payments, encounters, stock movements. */
  TRANSACTION: 'TRANSACTION',
  /** One record. */
  RECORD: 'RECORD',
} as const;

export const drillDownSchema = z.object({
  /** The API path that returns the rows behind this figure. */
  href: z.string().min(1),
  level: z.nativeEnum(drillDownLevel),
  /** What the reader will find there, in words. */
  label: z.string().min(1),
});
export type DrillDown = z.infer<typeof drillDownSchema>;

/**
 * One number on one dashboard.
 *
 * `computedAt` and `classification` are required — they are inherited from
 * {@link classifiedNumberSchema} and tightened here so neither can be omitted.
 *
 * A figure must either be clickable down to its rows or say why it is not.
 * "It has no drill-down" is a legitimate answer for a count of zero or a
 * configuration value; refusing to say which is not.
 */
export const figureSchema = classifiedNumberSchema
  .extend({
    key: z.string().min(1),
    label: z.string().min(1),
    classification: dataClassificationSchema,
    computedAt: z.string().datetime(),
    /** The named, versioned query that produced it. */
    sourceQueryId: z.string().min(1),
    /** What the number means, in the words that belong on a report. */
    definition: z.string().min(10),
    /** The tables the query reads — the first hop of the lineage walk. */
    reads: z.array(z.string()).min(1),
    drillDown: drillDownSchema.nullable(),
    noDrillDownReason: z.string().min(10).nullable(),
  })
  .superRefine((figure, ctx) => {
    if (figure.drillDown === null && figure.noDrillDownReason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['drillDown'],
        message:
          `Figure "${figure.key}" offers no way to reach the records behind it and gives no reason. ` +
          'Every figure is either clickable down to its rows or says why it is not (spec §71).',
      });
    }

    if (figure.drillDown !== null && figure.noDrillDownReason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noDrillDownReason'],
        message: `Figure "${figure.key}" both offers a drill-down and explains why it has none.`,
      });
    }

    if (figure.suppressed === true && figure.value !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message:
          `Figure "${figure.key}" is marked suppressed but still carries its value. ` +
          'A withheld figure that travels with its number is not withheld.',
      });
    }
  });

export type Figure = z.infer<typeof figureSchema>;

export const dashboardSectionSchema = z.object({
  title: z.string().min(1),
  /** Why these figures belong together, for a reader who did not design it. */
  subtitle: z.string().optional(),
  figures: z.array(figureSchema),
});

export const dashboardSchema = z.object({
  role: z.string(),
  facilityId: uuidSchema,
  facilityName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  generatedAt: z.string().datetime(),
  sections: z.array(dashboardSectionSchema).min(1),
  /** Anything the reader needs to know before believing the numbers. */
  caveats: z.array(z.string()),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  facilityId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const drillDownQuerySchema = z.object({
  facilityId: uuidSchema,
  figure: z.string().min(1),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  /** Set when descending from a dimension to its transactions. */
  dimension: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(200).optional(),
});
export type DrillDownQuery = z.infer<typeof drillDownQuerySchema>;

export const comparisonQuerySchema = z.object({
  facilityId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  kpiCode: z.string().min(2).max(50).optional(),
});
export type ComparisonQuery = z.infer<typeof comparisonQuerySchema>;

export const benchmarkQuerySchema = z.object({
  kpiCode: z.string().min(2).max(50),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
});
export type BenchmarkQuery = z.infer<typeof benchmarkQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
  facilityId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// -----------------------------------------------------------------------------
// Data quality (spec §47)
// -----------------------------------------------------------------------------

export const dataQualityDimension = {
  COMPLETENESS: 'COMPLETENESS',
  DUPLICATES: 'DUPLICATES',
  VALIDITY: 'VALIDITY',
  RECONCILIATION: 'RECONCILIATION',
  TIMELINESS: 'TIMELINESS',
} as const;

export type DataQualityDimension = (typeof dataQualityDimension)[keyof typeof dataQualityDimension];

export const dataQualityIssueSchema = z.object({
  dimension: z.nativeEnum(dataQualityDimension),
  code: z.string(),
  /** What is wrong, in the words of the person who has to fix it. */
  description: z.string(),
  affectedCount: z.number().int().nonnegative(),
  /** How many records the count is out of. A rate without one is a rumour. */
  outOf: z.number().int().nonnegative(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  /** Where to go and put it right. */
  href: z.string().nullable(),
});

export type DataQualityIssue = z.infer<typeof dataQualityIssueSchema>;

// -----------------------------------------------------------------------------
// AI (spec §§53-54, doc 17)
// -----------------------------------------------------------------------------

export const aiAskSchema = z.object({
  facilityId: uuidSchema,
  question: z.string().min(3).max(500),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  /**
   * Skip the router and name the capability directly.
   *
   * Useful from a menu of questions. Anything not in the approved list is
   * refused; there is no path by which a caller supplies their own query.
   */
  capabilityId: z.string().max(100).optional(),
});
export type AiAsk = z.infer<typeof aiAskSchema>;

export const aiReviewSchema = z.object({
  insightId: uuidSchema,
  outcome: z.enum(['ACCEPTED', 'REJECTED', 'EDITED']),
  note: z.string().max(2000).optional(),
});
export type AiReview = z.infer<typeof aiReviewSchema>;

export const aiForecastSchema = z.object({
  facilityId: uuidSchema,
  measure: z.enum(['ENCOUNTERS', 'REVENUE']),
  /** Days of history to read. */
  days: z.coerce.number().int().min(7).max(400).optional(),
  /** Periods ahead. */
  horizon: z.coerce.number().int().min(1).max(30).optional(),
  /** 7 for a weekly cycle, 1 to fit no season at all. */
  seasonLength: z.coerce.number().int().min(1).max(52).optional(),
});
export type AiForecast = z.infer<typeof aiForecastSchema>;
