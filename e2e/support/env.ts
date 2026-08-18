import { API_BASE } from './contracts';

/**
 * Where the suite points, and nothing else.
 *
 * E2E never starts the stack: the flows under test include real storage, real cookies and a real
 * Postgres, and a suite that boots a stubbed stack proves nothing about any of them. Locally that
 * means `pnpm db:up && pnpm db:seed && pnpm dev:api && pnpm dev:web`; at INT-5 it means the
 * deployed URLs.
 */
export interface E2EEnv {
  /** Origin the web app is served from. */
  webUrl: string;
  /** Origin the API is served from, no trailing slash. */
  apiUrl: string;
  /** `apiUrl` + `/api/v1` — every request path in this suite is relative to this. */
  apiBase: string;
  /** Optional. When present the harness upserts its identities directly; see `db.ts`. */
  databaseUrl: string | null;
  /**
   * The API's own access-token secret. The harness signs tokens with it so Playwright never has
   * to drive Google's login page — see `session.ts` for why that is the only workable choice and
   * what it deliberately does not do.
   */
  jwtAccessSecret: string;
  /** Seconds; matches ACCESS_TOKEN_TTL's default of 15m. */
  accessTokenTtlSeconds: number;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. The E2E suite runs against a *running* stack; see e2e/support/env.ts.`,
    );
  }
  return value;
}

const stripSlash = (value: string): string => value.replace(/\/+$/, '');

let cached: E2EEnv | undefined;

export function env(): E2EEnv {
  if (cached) return cached;

  const apiUrl = stripSlash(required('E2E_API_URL', 'http://localhost:3000'));

  cached = {
    webUrl: stripSlash(required('E2E_WEB_URL', 'http://localhost:5173')),
    apiUrl,
    apiBase: `${apiUrl}${API_BASE}`,
    databaseUrl: process.env.DATABASE_URL ?? null,
    jwtAccessSecret: required('JWT_ACCESS_SECRET'),
    accessTokenTtlSeconds: 15 * 60,
  };
  return cached;
}

/**
 * Whether the API under test is wired to a **real** object store.
 *
 * `POST /uploads/init` mints a signed upload URL before it answers, so against a placeholder
 * Supabase host it 500s and every byte-moving flow fails for a reason that has nothing to do with
 * the behaviour under test. Set `E2E_STORAGE_READY=true` once HUMAN-3 has provisioned a bucket
 * with CORS; until then those specs skip with the blocker named, which is the honest report — a
 * permanently red suite teaches everyone to ignore it.
 *
 * Deliberately *not* part of `env()`: a `test.skip(...)` runs while Playwright is collecting the
 * file, and `env()` throws there when the stack variables are absent — which would make
 * `playwright test --list` fail instead of listing.
 */
export const storageReady = (): boolean => process.env.E2E_STORAGE_READY === 'true';
