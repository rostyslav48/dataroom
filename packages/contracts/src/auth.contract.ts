import { z } from 'zod';
import { Email, EndpointDescriptor, IsoDateTime, Uuid } from './common.contract';

/**
 * Auth surface. See SPEC-02 (backend) and SPEC-06 (frontend).
 *
 * Token model:
 *   - Access token: JWT, ~15 min, returned in the `/auth/refresh` and callback responses,
 *     held in memory by the frontend. Never in localStorage — an XSS then costs a session
 *     rather than a persistent credential.
 *   - Refresh token: opaque, httpOnly + Secure + SameSite=None cookie scoped to the API
 *     origin. Never readable by JS, so it never appears in a contract.
 */

export const UserDto = z
  .object({
    id: Uuid,
    email: Email,
    name: z.string(),
    avatarUrl: z.string().url().nullable(),
  })
  .strict();
export type UserDto = z.infer<typeof UserDto>;

export const SessionDto = z
  .object({
    user: UserDto,
    accessToken: z.string(),
    accessTokenExpiresAt: IsoDateTime,
  })
  .strict();
export type SessionDto = z.infer<typeof SessionDto>;

/** `GET /me` — 200 with the user, or 401 UNAUTHENTICATED. Never 200 with a null user. */
export const MeResponse = UserDto;
export type MeResponse = z.infer<typeof MeResponse>;

/**
 * The one definition of "same-origin path", shared by every caller.
 *
 * A path is safe only if it starts with a single `/` that is not followed by another separator,
 * and contains no backslash and no control character anywhere after it.
 *
 * `//` is the obvious protocol-relative form. **`\` is the one that gets missed:** the WHATWG URL
 * parser — every browser, `history`, and `new URL()` — treats `\` exactly like `/` in the authority
 * position, so `/\evil.com` resolves to `https://evil.com/` against any base. Control characters
 * matter for the same reason: browsers *strip* tab, CR and LF from a URL before parsing, so
 * `/<TAB>/evil.com` becomes `//evil.com` after stripping. Percent-encoded backslashes are rejected
 * too — no legitimate route in this application contains one, and the margin is free.
 *
 * Anything that decides where a browser goes next must run through `isSafeReturnTo`. Three
 * hand-rolled copies of "starts with `/`, does not start with `//`" is how the backslash bypass got
 * in; there is deliberately only one now.
 */
const SAFE_RETURN_TO_PATTERN = /^\/(?![/\\])[^\\]*$/;
const ENCODED_BACKSLASH = /%5c/i;

/**
 * Control characters are checked by code point rather than by a regex class: a `\u0000-\u001F`
 * range inside a literal is exactly what `no-control-regex` exists to flag, and it is unreadable
 * besides. C0 (0x00–0x1F) and DEL (0x7F) — every character a browser strips or refuses.
 */
const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

export function isSafeReturnTo(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' &&
    SAFE_RETURN_TO_PATTERN.test(candidate) &&
    !ENCODED_BACKSLASH.test(candidate) &&
    !hasControlCharacter(candidate)
  );
}

/**
 * `GET /auth/google?returnTo=` — `returnTo` is round-tripped through the OAuth `state`
 * parameter so the user lands where they started after login.
 *
 * SECURITY: `returnTo` must be validated as a same-origin *path* before use. An unvalidated
 * value here is an open-redirect, and this is the classic place it appears.
 */
export const GoogleAuthQuery = z
  .object({
    // Deliberately not extracted into an exported `SafeReturnTo` schema: the contract's export
    // surface is a frozen inventory that a meta-test enumerates, and `isSafeReturnTo` is the
    // reusable part. Callers that need the rule get the predicate, not a second schema.
    returnTo: z.string().refine(isSafeReturnTo, 'must be a same-origin path').optional(),
  })
  .strict();
export type GoogleAuthQuery = z.infer<typeof GoogleAuthQuery>;

export const RefreshResponse = SessionDto;
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const authEndpoints = {
  googleStart:    { method: 'GET',  path: '/auth/google',          public: true },
  googleCallback: { method: 'GET',  path: '/auth/google/callback', public: true },
  refresh:        { method: 'POST', path: '/auth/refresh',         public: true },
  logout:         { method: 'POST', path: '/auth/logout' },
  me:             { method: 'GET',  path: '/me' },
} as const satisfies Record<string, EndpointDescriptor>;
