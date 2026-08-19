import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../src/config/app.config';
import { EnvValidationError, durationToMs, validateEnv } from '../../src/config/env.schema';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
  JWT_ACCESS_SECRET: 'access-secret-000000000000000000000',
  JWT_REFRESH_SECRET: 'refresh-secret-00000000000000000000',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_BUCKET: 'dataroom',
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('env schema', () => {
  it('accepts a complete environment and applies documented defaults', () => {
    const env = validateEnv({ ...valid });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
    expect(env.REFRESH_TOKEN_TTL).toBe('30d');
    expect(env.MAX_UPLOAD_BYTES).toBe(104_857_600);
  });

  it.each(Object.keys(valid))('fails naming %s when it is missing', (key) => {
    const incomplete: Record<string, unknown> = { ...valid };
    delete incomplete[key];

    try {
      validateEnv(incomplete);
      expect.unreachable('validateEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toContain(key);
    }
  });

  it('reads COOKIE_SECURE=false as false rather than as a truthy string', () => {
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('rejects SameSite=None without Secure, which browsers would silently drop', () => {
    expect(() =>
      validateEnv({ ...valid, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
    expect(() =>
      validateEnv({ ...valid, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }),
    ).not.toThrow();
  });

  it('rejects a JWT secret short enough for a human to have typed it', () => {
    // 32 characters is the floor below which a passphrase stops being a key. Render generates
    // these in production; the rule bites on self-hosted and staging deploys, where a person picks
    // the value and `.env.example` is the model they copy.
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'a'.repeat(31) })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => validateEnv({ ...valid, JWT_REFRESH_SECRET: 'b'.repeat(31) })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
    expect(() =>
      validateEnv({
        ...valid,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateEnv({
        ...valid,
        JWT_ACCESS_SECRET: 'same-secret-0000000000000000000000',
        JWT_REFRESH_SECRET: 'same-secret-0000000000000000000000',
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it.each([
    ['a short secret', { JWT_ACCESS_SECRET: 'tooshort' }],
    ['a non-url callback', { GOOGLE_CALLBACK_URL: 'not-a-url' }],
    ['a non-numeric port', { PORT: 'http' }],
    ['a bad ttl format', { ACCESS_TOKEN_TTL: '15 minutes' }],
    ['a zero upload cap', { MAX_UPLOAD_BYTES: '0' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateEnv({ ...valid, ...override })).toThrow(EnvValidationError);
  });
});

describe('durationToMs', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['30d', 2_592_000_000],
  ])('converts %s', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it('throws on an unparseable duration', () => {
    expect(() => durationToMs('soon')).toThrow();
  });
});

/**
 * The minimum a production environment must add beyond `valid`. Both rules exist because their
 * failure mode is silent: a plaintext database connection only surfaces if the server happens to
 * refuse it, and an untrusted proxy only surfaces as every caller sharing one rate-limit bucket.
 */
const productionOnly = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db.example.com:5432/db?sslmode=require',
  TRUST_PROXY_HOPS: '1',
};

describe('production environment guarantees', () => {
  it('refuses to boot without TLS on the database connection', () => {
    expect(() =>
      validateEnv({ ...valid, ...productionOnly, DATABASE_URL: 'postgres://u:p@db:5432/db' }),
    ).toThrow(/DATABASE_URL/);
    // `prefer` and `allow` fall back to plaintext silently, so they are not TLS.
    expect(() =>
      validateEnv({
        ...valid,
        ...productionOnly,
        DATABASE_URL: 'postgres://u:p@db:5432/db?sslmode=prefer',
      }),
    ).toThrow(/DATABASE_URL/);
    for (const mode of ['require', 'verify-ca', 'verify-full']) {
      expect(() =>
        validateEnv({
          ...valid,
          ...productionOnly,
          DATABASE_URL: `postgres://u:p@db:5432/db?sslmode=${mode}`,
        }),
      ).not.toThrow();
    }
  });

  it('refuses to boot without a trusted proxy hop', () => {
    expect(() => validateEnv({ ...valid, ...productionOnly, TRUST_PROXY_HOPS: '0' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
  });

  it('leaves both rules off outside production, where there is no proxy and no public network', () => {
    expect(validateEnv({ ...valid }).TRUST_PROXY_HOPS).toBe(0);
    expect(new AppConfig(validateEnv({ ...valid })).databaseSsl).toBe(false);
  });

  it('requires certificate verification for the production database connection', () => {
    expect(new AppConfig(validateEnv({ ...valid, ...productionOnly })).databaseSsl).toEqual({
      rejectUnauthorized: true,
    });
  });
});

describe('production cookie configuration', () => {
  it('is cross-site and Secure when configured for the deployed pair of domains', () => {
    // The deployed web app and API sit on unrelated registrable domains, so the refresh cookie has
    // to be SameSite=None; Secure. The integration tests run against the local Lax configuration,
    // so without this case the production cookie shape would be asserted nowhere.
    const config = new AppConfig(
      validateEnv({
        ...valid,
        ...productionOnly,
        COOKIE_SAMESITE: 'none',
        COOKIE_SECURE: 'true',
        WEB_ORIGIN: 'https://dataroom.vercel.app',
        GOOGLE_CALLBACK_URL: 'https://dataroom.onrender.com/api/v1/auth/google/callback',
      }),
    );

    expect(config.cookie).toMatchObject({
      name: 'refresh_token',
      path: '/api/v1/auth',
      sameSite: 'none',
      secure: true,
    });
    expect(config.cookie.maxAgeMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.isProduction).toBe(true);
  });
});
