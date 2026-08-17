import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../src/config/app.config';
import { EnvValidationError, durationToMs, validateEnv } from '../../src/config/env.schema';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
  JWT_ACCESS_SECRET: 'access-secret-0000000000',
  JWT_REFRESH_SECRET: 'refresh-secret-000000000',
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

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'same-secret-00000000', JWT_REFRESH_SECRET: 'same-secret-00000000' }),
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

describe('production cookie configuration', () => {
  it('is cross-site and Secure when configured for the deployed pair of domains', () => {
    // The deployed web app and API sit on unrelated registrable domains, so the refresh cookie has
    // to be SameSite=None; Secure. The integration tests run against the local Lax configuration,
    // so without this case the production cookie shape would be asserted nowhere.
    const config = new AppConfig(
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
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
