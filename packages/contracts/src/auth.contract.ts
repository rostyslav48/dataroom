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
 * `GET /auth/google?returnTo=` — `returnTo` is round-tripped through the OAuth `state`
 * parameter so the user lands where they started after login.
 *
 * SECURITY: `returnTo` must be validated as a same-origin *path* (starts with `/`, no
 * scheme, no `//`) before use. An unvalidated value here is an open-redirect, and this is
 * the classic place it appears.
 */
export const GoogleAuthQuery = z
  .object({
    returnTo: z
      .string()
      .startsWith('/')
      .refine((v) => !v.startsWith('//'), 'must be a same-origin path')
      .optional(),
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
