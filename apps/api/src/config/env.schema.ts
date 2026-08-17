import { z } from 'zod';

/**
 * The single description of this service's environment.
 *
 * Parsed once, at boot, before the app listens. A missing or malformed variable exits non-zero
 * naming the variable — the alternative is a `undefined` reaching a Supabase client three hours
 * later, in production, on a request that then half-succeeds.
 */

/** `.env` files carry strings; a plain `z.coerce.boolean()` would read "false" as `true`. */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true' || value === '1'));

/** `15m`, `30d`, `900s` — the format both `@nestjs/jwt` and our cookie maxAge understand. */
const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/, 'must look like 15m, 3600s or 30d');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1),

    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_CALLBACK_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    ACCESS_TOKEN_TTL: duration.default('15m'),
    REFRESH_TOKEN_TTL: duration.default('30d'),

    COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
    COOKIE_SECURE: booleanish.default(false),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_BUCKET: z.string().min(1),

    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),

    WEB_ORIGIN: z.string().url(),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
    // Browsers drop `SameSite=None` cookies that are not also `Secure`. Catching it here turns a
    // silent production-only session failure into a boot failure.
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'must be true when COOKIE_SAMESITE=none — browsers reject the cookie otherwise',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n` +
        'See .env.example for every variable and what it is for.',
    );
    this.name = 'EnvValidationError';
  }
}

/** Used as `ConfigModule.forRoot({ validate })`, and directly in tests. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new EnvValidationError(issues);
}

/** Milliseconds for a duration string validated by the schema above. */
export function durationToMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Not a duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * scale[unit];
}
