import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common.js';

/** Incidents, complaints, improvement cycles and KPIs (spec §§38-39). */

// -----------------------------------------------------------------------------
// Incidents
// -----------------------------------------------------------------------------

export const reportIncidentSchema = z.object({
  facilityId: uuidSchema,
  incidentType: z.string().min(2).max(100),
  description: z.string().min(10).max(4000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  occurredAt: z.string().datetime(),
  patientAffected: z.boolean().default(false),
  /**
   * Linked only where the clinical detail matters.
   *
   * Incident reporting must not be discouraged by identity exposure, so the
   * link is optional and permissioned rather than required.
   */
  linkedEncounterId: uuidSchema.optional(),
  immediateAction: z.string().max(2000).optional(),
});
export type ReportIncident = z.infer<typeof reportIncidentSchema>;

export const investigateIncidentSchema = z.object({
  incidentId: uuidSchema,
  rootCause: z.string().min(10).max(4000),
  actions: z
    .array(
      z.object({
        description: z.string().min(5).max(1000),
        ownerUserId: uuidSchema.optional(),
        dueDate: isoDateSchema.optional(),
      }),
    )
    .min(1, 'An investigation with no action is a finding nobody acted on.'),
});
export type InvestigateIncident = z.infer<typeof investigateIncidentSchema>;

export const closeIncidentSchema = z.object({
  incidentId: uuidSchema,
  closureNote: z.string().min(10).max(2000),
});
export type CloseIncident = z.infer<typeof closeIncidentSchema>;

export const completeActionSchema = z.object({
  actionId: uuidSchema,
  /** What was actually done, and how anybody could check it. */
  verificationNote: z.string().min(10).max(2000),
});
export type CompleteAction = z.infer<typeof completeActionSchema>;

// -----------------------------------------------------------------------------
// Complaints
// -----------------------------------------------------------------------------

export const receiveComplaintSchema = z.object({
  facilityId: uuidSchema,
  source: z.string().min(2).max(100),
  subject: z.string().min(3).max(200),
  description: z.string().min(10).max(4000),
  complainantName: z.string().max(200).optional(),
  complainantContact: z.string().max(200).optional(),
  isAnonymous: z.boolean().default(false),
  receivedAt: z.string().datetime().optional(),
});
export type ReceiveComplaint = z.infer<typeof receiveComplaintSchema>;

export const actOnComplaintSchema = z.object({
  complaintId: uuidSchema,
  description: z.string().min(5).max(2000),
  outcome: z.string().max(2000).optional(),
});
export type ActOnComplaint = z.infer<typeof actOnComplaintSchema>;

export const resolveComplaintSchema = z.object({
  complaintId: uuidSchema,
  resolution: z.string().min(10).max(4000),
  /** 1-5 as the complainant gave it. Never inferred, never defaulted. */
  satisfactionRating: z.number().int().min(1).max(5).optional(),
});
export type ResolveComplaint = z.infer<typeof resolveComplaintSchema>;

// -----------------------------------------------------------------------------
// Quality improvement cycles (spec §39)
// -----------------------------------------------------------------------------

export const openQualityCycleSchema = z.object({
  facilityId: uuidSchema,
  title: z.string().min(3).max(200),
  problemStatement: z.string().min(20).max(4000),
  /**
   * The KPI the cycle will be judged by, named before the work starts.
   *
   * Chosen up front so that a cycle cannot be declared a success afterwards by
   * picking whichever number happened to move.
   */
  measurementKpiId: uuidSchema,
  ownerUserId: uuidSchema.optional(),
  targetValue: z.number().optional(),
});
export type OpenQualityCycle = z.infer<typeof openQualityCycleSchema>;

export const advanceQualityCycleSchema = z.object({
  cycleId: uuidSchema,
  rootCauseAnalysis: z.string().min(10).max(4000).optional(),
  intervention: z.string().min(10).max(4000).optional(),
  reviewOutcome: z.string().min(10).max(4000).optional(),
});
export type AdvanceQualityCycle = z.infer<typeof advanceQualityCycleSchema>;

// -----------------------------------------------------------------------------
// KPIs
// -----------------------------------------------------------------------------

export const assignKpiSchema = z.object({
  kpiCode: z.string().min(2).max(50),
  facilityId: uuidSchema,
  targetValue: z.number().optional(),
  targetDate: isoDateSchema.optional(),
  ownerUserId: uuidSchema.optional(),
  /** Fractions of target, e.g. 0.9 amber / 0.75 red. Never hard-coded. */
  amberThreshold: z.number().min(0).max(1).optional(),
  redThreshold: z.number().min(0).max(1).optional(),
});
export type AssignKpi = z.infer<typeof assignKpiSchema>;

export const computeKpiSchema = z.object({
  facilityId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  /** Omit to recompute every KPI assigned to the facility. */
  kpiCode: z.string().min(2).max(50).optional(),
});
export type ComputeKpi = z.infer<typeof computeKpiSchema>;
