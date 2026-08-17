import { createHmac } from 'node:crypto';

/**
 * A 20-line HS256 signer, rather than a dependency.
 *
 * `e2e/package.json` and the lockfile are Wave-0 property; QA may not add to them. More to the
 * point, the only thing this suite needs from a JWT library is one signature over one payload
 * shape, and `@nestjs/jwt` verifies with `jsonwebtoken`, which defaults to the HS* family when it
 * is handed a string secret. So HS256 is exactly what the API will accept.
 */

const b64url = (value: string | Buffer): string =>
  (typeof value === 'string' ? Buffer.from(value, 'utf8') : value).toString('base64url');

export interface AccessTokenClaims {
  /** The `users.id` of the identity. `JwtAuthGuard` reads this as `userId`. */
  sub: string;
  /** Read straight into `Identity.email`; permission resolution matches recipients on it. */
  email: string;
}

/**
 * Mints a token the *real* API will accept — same secret, same algorithm, same claim names as
 * `TokensService.issue`. Nothing about it is special-cased server-side.
 */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ ...claims, iat: issuedAt, exp: issuedAt + ttlSeconds }),
  );
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

/** An expiry in the past — for asserting that the client refreshes rather than dying. */
export function signExpiredAccessToken(claims: AccessTokenClaims, secret: string): string {
  return signAccessToken(claims, secret, -60);
}
