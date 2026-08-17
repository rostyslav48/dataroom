import type { BrowserContext } from '@playwright/test';
import type { SessionDto } from '@dataroom/contracts';
import { API_BASE } from './contracts';
import { env } from './env';
import { signAccessToken } from './jwt';
import { IDENTITIES, databaseAvailable, issueRefreshToken, upsertIdentity, type IdentityName } from './db';

/**
 * Signing a browser context in, without driving Google.
 *
 * Playwright does not attempt the real OAuth flow. Google blocks scripted sign-in from CI, and
 * building around that — a headed browser, a stashed cookie jar, a captcha solver — produces a
 * suite that is flaky forever and, worse, flaky in the one place a red build is easiest to dismiss.
 * SPEC-10 settles this: the harness mints its own session.
 *
 * ## The line this must not cross
 *
 * Everything here is test-side. There is no test-only login endpoint, no `NODE_ENV === 'test'`
 * branch, no env-flagged bypass, nothing in `apps/api` that a misconfigured variable could switch
 * on in production. A backdoor in the auth system of a product whose entire premise is access
 * control is not a trade worth making for test convenience, and the two strategies below are the
 * two ways of getting a session without one:
 *
 *   1. **Refresh cookie** (used whenever `DATABASE_URL` is reachable). Write the `refresh_tokens`
 *      row `TokensService.issue` would have written and set the cookie the callback would have set.
 *      The app then boots, calls `POST /auth/refresh` for real, and receives a real session from
 *      unmodified production code. Nothing is stubbed; this is the honest one, and it also gives
 *      the refresh path itself coverage.
 *
 *   2. **Fulfil `/auth/refresh` in the browser** (fallback when there is no direct database, e.g.
 *      against a deployed environment). Playwright answers that one route with a `SessionDto`
 *      carrying a token signed with the API's own `JWT_ACCESS_SECRET`. Every *other* request —
 *      every node read, every share, every mutation — still goes to the real API and is
 *      authenticated by the real guard against that real token. Only the handshake is short-cut.
 *
 * ## What this costs
 *
 * The Google round trip is the one flow with no automated coverage. Its consequences — user upsert,
 * recipient backfill, `returnTo` validation, token rotation — are covered by SPEC-02's integration
 * tests; only the redirect to Google and back is verified by hand, at INT-1 and INT-7.
 */

const apiHost = (): string => new URL(env().apiUrl).hostname;
const apiIsHttps = (): boolean => new URL(env().apiUrl).protocol === 'https:';

export interface Session {
  identity: IdentityName;
  userId: string;
  email: string;
  /** A token the real API accepts. Handy for a spec that wants to assert at the wire level too. */
  accessToken: string;
}

export async function signIn(context: BrowserContext, identity: IdentityName): Promise<Session> {
  const { jwtAccessSecret, accessTokenTtlSeconds } = env();
  const user = IDENTITIES[identity];
  const accessToken = signAccessToken(
    { sub: user.id, email: user.email },
    jwtAccessSecret,
    accessTokenTtlSeconds,
  );

  if (databaseAvailable()) {
    await upsertIdentity(user);
    const refreshToken = await issueRefreshToken(user.id);
    await context.addCookies([
      {
        name: 'refresh_token',
        value: refreshToken,
        domain: apiHost(),
        // Must match `AppConfig.cookie.path` exactly, or the browser will not send it back.
        path: `${API_BASE}/auth`,
        httpOnly: true,
        secure: apiIsHttps(),
        sameSite: apiIsHttps() ? 'None' : 'Lax',
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    ]);
  } else {
    await stubRefresh(context, user.id, user.email, user.name, accessToken, accessTokenTtlSeconds);
  }

  return { identity, userId: user.id, email: user.email, accessToken };
}

/**
 * Answer `POST /auth/refresh` — and its preflight — with a real, signed session.
 *
 * The CORS headers are ours to supply because a fulfilled response still goes through the browser's
 * cross-origin checks; without them the web app would see a network error rather than a session.
 */
async function stubRefresh(
  context: BrowserContext,
  userId: string,
  email: string,
  name: string,
  accessToken: string,
  ttlSeconds: number,
): Promise<void> {
  const session: SessionDto = {
    user: { id: userId, email, name, avatarUrl: null },
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };

  const cors = {
    'Access-Control-Allow-Origin': env().webUrl,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type,authorization,x-share-token',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };

  await context.route(`**${API_BASE}/auth/refresh`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(session),
    });
  });
}

/**
 * Drop the session from a context that has one, without discarding the rest of its state.
 *
 * Flow 4 needs the recipient to keep browsing after the owner revokes; flow 3's clean context needs
 * to *stay* clean. Both are about proving there is no cached grant anywhere, so the session is the
 * only thing that changes.
 */
export async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
  await context.unroute(`**${API_BASE}/auth/refresh`);
}
