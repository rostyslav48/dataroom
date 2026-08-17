import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fixtures } from './contracts';
import { env } from './env';

/**
 * Direct Postgres access for the harness — identities only.
 *
 * SPEC-10 settles E2E authentication as "mint an access token and seed the matching `users` row
 * directly in Postgres". This module is that seeding, and it is the *only* place the suite touches
 * the database. Everything else — rooms, folders, uploads, shares — goes through the real API,
 * because a test that sets up its own world in SQL stops testing the endpoints that build it.
 *
 * ## Why `pg` is resolved rather than imported
 *
 * `pg` is a workspace dependency (`apps/api`) but not an `e2e` one, and adding it would mean
 * editing `e2e/package.json` *and* `pnpm-lock.yaml` — the lockfile is Wave-0 property that the QA
 * track may not write. Resolving it from the workspace keeps the suite dependency-free at the cost
 * of this shim. When someone who owns the lockfile adds `pg` to `e2e`'s devDependencies, delete
 * `loadPg` and import it normally.
 *
 * ## Degrading without a database
 *
 * `DATABASE_URL` is optional. Against a deployed environment there is usually no direct connection,
 * and there does not need to be: `pnpm db:seed` has already created the three fixture users, and
 * `requireFixtureIdentities` verifies that over HTTP instead. The database path exists for the
 * local loop, where it removes the "did you re-seed?" failure mode entirely.
 */

interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

const require_ = createRequire(import.meta.url);

function loadPg(): PgModule | null {
  const candidates = [
    new URL('../../apps/api/node_modules/', import.meta.url).pathname,
    new URL('../../node_modules/', import.meta.url).pathname,
    new URL('../node_modules/', import.meta.url).pathname,
  ];
  for (const path of candidates) {
    try {
      return require_(require_.resolve('pg', { paths: [path] })) as PgModule;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export const databaseAvailable = (): boolean => env().databaseUrl !== null && loadPg() !== null;

async function withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const url = env().databaseUrl;
  const pg = loadPg();
  if (url === null || pg === null) {
    throw new Error('No database connection: set DATABASE_URL, or gate the call on databaseAvailable().');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface HarnessIdentity {
  id: string;
  email: string;
  name: string;
}

export const IDENTITIES = {
  owner: { id: fixtures.IDS.owner, ...pick(fixtures.users.owner) },
  viewer: { id: fixtures.IDS.viewer, ...pick(fixtures.users.viewer) },
  stranger: { id: fixtures.IDS.stranger, ...pick(fixtures.users.stranger) },
} satisfies Record<string, HarnessIdentity>;

export type IdentityName = keyof typeof IDENTITIES;

function pick(user: { email: string; name: string }): { email: string; name: string } {
  return { email: user.email, name: user.name };
}

/**
 * Upsert one identity. Keyed on `id` so re-running the suite never mints a duplicate, and on
 * `google_sub` so it interoperates with a row a real sign-in created earlier.
 *
 * The email is lowercased on the way in. `share_recipients.email` is `citext`, but a parameter
 * bound as `text` compares case-sensitively against it (`citext = text` resolves to `text = text`),
 * so lowercase-everywhere is what actually makes permissioned matching work.
 */
export async function upsertIdentity(identity: HarnessIdentity): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, google_sub, email, name)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [identity.id, `e2e-google-sub-${identity.id}`, identity.email.toLowerCase(), identity.name],
    );
  });
}

export async function upsertAllIdentities(): Promise<void> {
  for (const identity of Object.values(IDENTITIES)) await upsertIdentity(identity);
}

/**
 * Issue a refresh-token cookie value the API will honour, by writing the row `TokensService.issue`
 * would have written. Only the sha-256 hash is stored, exactly as in production.
 *
 * Used by `session.ts` when a database is reachable, so that the browser's boot-time
 * `POST /auth/refresh` succeeds against the real endpoint instead of a stub.
 */
export async function issueRefreshToken(userId: string, ttlDays = 30): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
            VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
      [
        randomUUID(),
        userId,
        randomUUID(),
        createHash('sha256').update(token).digest('hex'),
        String(ttlDays),
      ],
    );
  });
  return token;
}

/** Escape hatch for assertions HTTP structurally cannot make. Read-only by convention. */
export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return withClient(async (client) => (await client.query(text, values)).rows as T[]);
}
