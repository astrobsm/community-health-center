import { z } from 'zod';

/**
 * Environment configuration, validated at boot.
 *
 * The application refuses to start on invalid configuration rather than
 * failing later in a request. A facility discovering at 9am that JWT_PRIVATE_KEY
 * was never set is worse than a container that never came up.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v.toLowerCase())));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    DISPLAY_TIMEZONE: z.string().default('Africa/Lagos'),

    API_PORT: z.coerce.number().int().positive().default(3000),
    API_HOST: z.string().default('0.0.0.0'),
    API_BASE_URL: z.string().url().default('http://localhost:3000'),
    WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
    API_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    REDIS_KEY_PREFIX: z.string().default('chc:'),

    // Base64-encoded PEM. Required outside development so a real deployment
    // cannot silently run on a throwaway key.
    JWT_PRIVATE_KEY_BASE64: z.string().optional(),
    JWT_PUBLIC_KEY_BASE64: z.string().optional(),
    JWT_KEY_ID: z.string().default('dev-key'),
    JWT_ISSUER: z.string().default('chc-platform'),
    JWT_AUDIENCE: z.string().default('chc-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_PEPPER: z.string().optional(),

    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(65_536),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(4),

    MFA_ISSUER: z.string().default('CHC Platform'),
    OFFLINE_GRACE_PERIOD_DAYS: z.coerce.number().int().positive().default(7),

    RATE_LIMIT_GENERAL_PER_MINUTE: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WRITE_PER_MINUTE: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().positive().default(5),

    AI_ENABLED: booleanish.default(false),

    /**
     * Blocks seeding of fake clinical and financial records (spec section 91).
     * Forced false in production by the refinement below — it is not a value a
     * deployment should be able to set by accident.
     */
    ALLOW_DEMO_FIXTURES: booleanish.default(false),

    /** Refuse to serialise a quantitative value with no classification. */
    STRICT_CLASSIFICATION: booleanish.default(true),
  })
  .superRefine((env, ctx) => {
    const isProduction = env.NODE_ENV === 'production';

    if (isProduction) {
      if (!env.JWT_PRIVATE_KEY_BASE64 || !env.JWT_PUBLIC_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PRIVATE_KEY_BASE64'],
          message:
            'A JWT keypair is required in production. Generate one with: openssl genpkey -algorithm ed25519 -out jwt-private.pem',
        });
      }
      if (!env.REFRESH_TOKEN_PEPPER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REFRESH_TOKEN_PEPPER'],
          message: 'REFRESH_TOKEN_PEPPER is required in production.',
        });
      }
      if (env.ALLOW_DEMO_FIXTURES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOW_DEMO_FIXTURES'],
          message:
            'ALLOW_DEMO_FIXTURES must be false in production. Fabricated clinical or financial records must never exist in a live facility.',
        });
      }
      if (!env.STRICT_CLASSIFICATION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRICT_CLASSIFICATION'],
          message:
            'STRICT_CLASSIFICATION must be true in production: every quantitative value must carry its provenance.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example for every variable.`);
  }

  return result.data;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
