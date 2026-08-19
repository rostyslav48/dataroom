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

/** The `sslmode` values that actually encrypt. `prefer` and `allow` silently fall back to plaintext. */
const REQUIRES_TLS = /[?&]sslmode=(require|verify-ca|verify-full)(&|$)/;

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1),

    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_CALLBACK_URL: z.string().url(),

    // 32 characters is ~192 bits for an alphanumeric secret. HS256 wants 256; this is the floor
    // below which a hand-typed passphrase stops being a key. Production uses Render's
    // `generateValue`, so the rule bites on self-hosted and staging deploys, which is where a
    // human picks the value.
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: duration.default('15m'),
    REFRESH_TOKEN_TTL: duration.default('30d'),

    COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
    COOKIE_SECURE: booleanish.default(false),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_BUCKET: z.string().min(1),

    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),

    /**
     * How many reverse proxies sit in front of this process, for Express's `trust proxy`.
     *
     * `0` means "no proxy" and is right for local development and tests. `1` is right for Render,
     * Fly, Heroku and every other single-load-balancer platform. It is a hop *count* rather than a
     * boolean because `trust proxy: true` trusts the whole `X-Forwarded-For` chain, and a caller
     * who can prepend an address to that chain can mint themselves an unlimited number of
     * rate-limit buckets.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    /**
     * Requests per minute per client IP, across the whole API. The abuse-sensitive routes narrow
     * this further at the handler; see `app.module.ts`. Loose by default on purpose — it caps a
     * script rather than shaping ordinary traffic, and a whole office behind one NAT is one key.
     */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1_200),

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
    // node-postgres does not negotiate TLS unless it is asked to. Without `sslmode`, a production
    // API and an external database exchange refresh-token hashes and recipient email addresses in
    // plaintext across the public internet, and nothing anywhere notices — the failure is silent
    // by construction, visible only if the server happens to *refuse* the cleartext connection.
    // Same class of guarantee as the cookie rule above: fail at boot, not at rest.
    if (env.NODE_ENV === 'production' && !REQUIRES_TLS.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message:
          'must carry sslmode=require (or verify-ca / verify-full) in production — ' +
          'without it node-postgres connects in plaintext',
      });
    }
    // A proxy that is not trusted makes every client share one rate-limit bucket; see
    // `bootstrap.ts`. Production is always behind at least one.
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY_HOPS'],
        message:
          'must be at least 1 in production — the platform load balancer is a proxy, and ' +
          'without this every caller shares one rate-limit bucket',
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
