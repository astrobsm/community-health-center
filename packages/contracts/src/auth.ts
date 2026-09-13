import { z } from 'zod';

/** Authentication contracts, shared by the API and every client (doc 07). */

export const loginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  /** Stable per-installation identifier, used to bind refresh tokens. */
  deviceId: z.string().max(128).optional(),
  deviceLabel: z.string().max(128).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const mfaVerifyRequestSchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
  deviceId: z.string().max(128).optional(),
});
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().max(128).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  organisationId: z.string().uuid(),
  roleCodes: z.array(z.string()),
  permissions: z.array(z.string()),
  facilities: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      code: z.string(),
      lifecycleStage: z.string(),
      scopeLevel: z.enum(['FULL', 'DEPARTMENT', 'AGGREGATE_ONLY', 'SELF_ONLY']),
    }),
  ),
  mfaEnabled: z.boolean(),
  /**
   * True when this role may not work offline (doc 07 §5). The client uses it
   * to disable local storage entirely rather than to hide a button.
   */
  offlineDisallowed: z.boolean(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const loginSuccessSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  user: authenticatedUserSchema,
});

export const mfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  /** Single-purpose, five-minute token. Not an access token. */
  mfaToken: z.string(),
});

/**
 * A role that requires MFA, held by a user who has not enrolled yet.
 *
 * Without this state the requirement would be unsatisfiable: a freshly created
 * administrator could never sign in to set up an authenticator. The password
 * has already been verified at this point; the session is withheld until
 * enrolment is confirmed.
 */
export const mfaEnrolmentRequiredSchema = z.object({
  mfaEnrolmentRequired: z.literal(true),
  enrolmentToken: z.string(),
  /** Base32 secret, to be typed in if the QR code cannot be scanned. */
  secret: z.string(),
  /** otpauth:// URI for the QR code. */
  otpauthUri: z.string(),
  reason: z.string(),
});

export const mfaEnrolConfirmRequestSchema = z.object({
  enrolmentToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
  deviceId: z.string().max(128).optional(),
});
export type MfaEnrolConfirmRequest = z.infer<typeof mfaEnrolConfirmRequestSchema>;

export const loginResponseSchema = z.union([
  loginSuccessSchema,
  mfaChallengeSchema,
  mfaEnrolmentRequiredSchema,
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const sessionSummarySchema = z.object({
  id: z.string().uuid(),
  deviceLabel: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  isCurrent: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
