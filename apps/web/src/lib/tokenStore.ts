/**
 * The access token lives in a module-level variable and nowhere else.
 *
 * Never `localStorage`, never `sessionStorage`, never a cookie this code can read: an XSS then
 * costs one in-memory session rather than a credential that survives the tab. The refresh token
 * is an httpOnly cookie the browser attaches for us, which is why a hard refresh can still
 * restore a session without any of it being readable from JavaScript.
 */
let accessToken: string | null = null;
let expiresAt: number | null = null;

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  /** `expiresAtIso` is advisory only — expiry is enforced by the server, not by this clock. */
  set(token: string, expiresAtIso?: string): void {
    accessToken = token;
    expiresAt = expiresAtIso === undefined ? null : Date.parse(expiresAtIso);
  },
  expiresAt(): number | null {
    return expiresAt;
  },
  clear(): void {
    accessToken = null;
    expiresAt = null;
  },
};
