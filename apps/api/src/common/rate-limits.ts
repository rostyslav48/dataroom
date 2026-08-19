import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Rate limits, all on the same one-minute window, all keyed per client IP.
 *
 * There is exactly **one** registered throttler and the strict routes narrow it with `@Throttle`,
 * rather than several named throttlers. `@nestjs/throttler` applies every registered throttler to
 * every route unless each is individually skipped, so a second named throttler at 10/min would
 * quietly cap the entire authenticated API at 10 requests a minute.
 *
 * These bound resource exhaustion, not credential guessing: the refresh token is 48 random bytes
 * and the share token 32, so neither is reachable by brute force at any rate. What they stop is an
 * unauthenticated caller turning cheap HTTP into unbounded database work.
 *
 * Sizing note: the buckets are keyed on the client address, and a whole Playwright run — or a whole
 * office behind one NAT — is a single address. The global ceiling is therefore deliberately loose;
 * it exists to cap a script, not to shape ordinary traffic. `RATE_LIMIT_PER_MINUTE` tightens it per
 * deployment without a code change.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** `/shared/:token` — the one endpoint reachable with no session at all (SPEC-05). */
export const SHARE_RATE_LIMIT = 10;

/**
 * `POST /auth/refresh` and the two OAuth legs. Each refresh is an `UPDATE … RETURNING` plus an
 * `INSERT`, and all three are `@Public()`.
 */
export const AUTH_RATE_LIMIT = 300;

/** `GET /health` runs a real `SELECT 1`, so it converts HTTP directly into database load. */
export const HEALTH_RATE_LIMIT = 120;

const windowed = (limit: number): Record<string, ThrottlerOptions> => ({
  default: { ttl: RATE_LIMIT_WINDOW_MS, limit },
});

/** `@Throttle(SHARE_THROTTLE)` — the per-route narrowings, named where they are read. */
export const SHARE_THROTTLE = windowed(SHARE_RATE_LIMIT);
export const AUTH_THROTTLE = windowed(AUTH_RATE_LIMIT);
export const HEALTH_THROTTLE = windowed(HEALTH_RATE_LIMIT);
