import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common.js';

/** Staff, credentials, attendance, performance and incentives (spec §§23-25). */

// -----------------------------------------------------------------------------
// Staff
// -----------------------------------------------------------------------------

export const createStaffSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  staffNumber: z.string().min(1).max(50),
  givenName: z.string().min(1).max(100),
  familyName: z.string().min(1).max(100),
  otherNames: z.string().max(100).optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).default('UNKNOWN'),
  dateOfBirth: isoDateSchema.optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(255).optional(),
  cadre: z.string().min(1).max(100),
  qualification: z.string().max(200).optional(),
  employerType: z.enum(['GOVERNMENT', 'PARTNER', 'LOCUM', 'VOLUNTEER', 'CONTRACTOR']).default('GOVERNMENT'),
  employmentDate: isoDateSchema.optional(),
  userId: uuidSchema.optional(),
});
export type CreateStaff = z.infer<typeof createStaffSchema>;

export const exitStaffSchema = z.object({
  staffId: uuidSchema,
  exitDate: isoDateSchema,
  /** An exit with no reason recorded cannot be told apart from a deletion. */
  reason: z.string().min(5).max(1000),
});
export type ExitStaff = z.infer<typeof exitStaffSchema>;

// -----------------------------------------------------------------------------
// Credentials
// -----------------------------------------------------------------------------

export const recordCredentialSchema = z.object({
  staffId: uuidSchema,
  credentialType: z.string().min(2).max(100),
  credentialNumber: z.string().max(100).optional(),
  issuingBody: z.string().max(200).optional(),
  issuedOn: isoDateSchema.optional(),
  expiresOn: isoDateSchema.optional(),
  evidenceStorageKey: z.string().max(500).optional(),
});
export type RecordCredential = z.infer<typeof recordCredentialSchema>;

export const verifyCredentialSchema = z.object({
  credentialId: uuidSchema,
  /**
   * What was actually checked, and against what.
   *
   * Verification without a record of what was seen is somebody's memory, and a
   * regulator asking six months later will not accept it.
   */
  verificationNote: z.string().min(10).max(1000),
});
export type VerifyCredential = z.infer<typeof verifyCredentialSchema>;

export const suspendCredentialSchema = z.object({
  credentialId: uuidSchema,
  reason: z.string().min(10).max(1000),
});
export type SuspendCredential = z.infer<typeof suspendCredentialSchema>;

// -----------------------------------------------------------------------------
// Scheduling and attendance
// -----------------------------------------------------------------------------

export const createScheduleSchema = z.object({
  staffId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  shifts: z
    .array(
      z.object({
        shiftType: z.enum(['MORNING', 'AFTERNOON', 'NIGHT', 'ON_CALL', 'OUTREACH']),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        departmentId: uuidSchema.optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1),
});
export type CreateSchedule = z.infer<typeof createScheduleSchema>;

export const clockSchema = z.object({
  staffId: uuidSchema,
  eventType: z.enum(['CLOCK_IN', 'CLOCK_OUT']),
  method: z.enum(['QR', 'PIN', 'BIOMETRIC', 'MANUAL']).default('PIN'),
  occurredAt: z.string().datetime().optional(),
  shiftId: uuidSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Required for MANUAL, and refused otherwise — see the service. */
  manualReason: z.string().max(1000).optional(),
});
export type Clock = z.infer<typeof clockSchema>;

export const correctAttendanceSchema = z.object({
  /** The event being corrected. It is never edited; this creates its replacement. */
  attendanceId: uuidSchema,
  occurredAt: z.string().datetime(),
  correctionReason: z.string().min(10).max(1000),
});
export type CorrectAttendance = z.infer<typeof correctAttendanceSchema>;

// -----------------------------------------------------------------------------
// Performance metrics
// -----------------------------------------------------------------------------

export const configureMetricSchema = z.object({
  facilityId: uuidSchema.optional(),
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(200),
  definition: z.string().min(10).max(1000),
  unit: z.string().max(50).optional(),
  direction: z.enum(['HIGHER_BETTER', 'LOWER_BETTER']).default('HIGHER_BETTER'),
  /**
   * Required, not optional.
   *
   * The schema permits null for metrics inherited from elsewhere, but nothing
   * in this system will create one: a metric with no query behind it cannot be
   * computed, and paying on a number nobody can recompute is the failure the
   * whole design exists to prevent (spec §25).
   */
  sourceQueryId: z.string().min(3).max(100),
  weight: z.number().positive().max(1000),
  targetValue: z.number().optional(),
});
export type ConfigureMetric = z.infer<typeof configureMetricSchema>;

export const computePerformanceSchema = z.object({
  facilityId: uuidSchema,
  staffId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
});
export type ComputePerformance = z.infer<typeof computePerformanceSchema>;

// -----------------------------------------------------------------------------
// Incentives
// -----------------------------------------------------------------------------

export const computeIncentiveSchema = z.object({
  facilityId: uuidSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  /** The whole pool to divide, in minor units. Never a percentage of anything. */
  poolMinor: z.number().int().nonnegative(),
  /** Where the money came from, so the total can be reconciled to the waterfall. */
  poolReference: z.string().min(2).max(100),
  staffIds: z.array(uuidSchema).min(1),
  /** Per-staff weights for the split, in the same order. Equal shares if omitted. */
  splitWeights: z.array(z.number().nonnegative()).optional(),
});
export type ComputeIncentive = z.infer<typeof computeIncentiveSchema>;

export const approveIncentiveSchema = z.object({
  incentiveId: uuidSchema,
  /** Recorded on the audit entry; an approval with no note is a signature nobody can read. */
  note: z.string().max(1000).optional(),
});
export type ApproveIncentive = z.infer<typeof approveIncentiveSchema>;
