import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { request as playwrightRequest } from '@playwright/test';
import { fixtures } from '../support/contracts';
import { Api, env, expect, test } from '../support/fixtures';
import {
  databaseAvailable,
  IDENTITIES,
  issueRefreshToken,
  upsertAllIdentities,
} from '../support/db';
import { signAccessToken, signExpiredAccessToken } from '../support/jwt';
import {
  assertShareResolveTopology,
  protectShareResolveApiContext,
  protectShareResolveBrowserContext,
} from '../support/shared-route';
import { acquireShareResolveProcessLock } from '../support/suite-lock';

/**
 * A self-test of the harness, run first so the other five flows fail for their own reasons.
 *
 * Everything below the surface of this suite rests on one claim: a token this process signs is
 * indistinguishable, to the API, from one the API issued itself. If that claim is false — a
 * mismatched `JWT_ACCESS_SECRET`, an environment pointed at the wrong stack, a database with no
 * fixture users — then all twenty-odd remaining tests fail at once with authentication errors, and
 * whoever reads the report spends an hour looking for a permissions bug that is not there.
 *
 * So the harness proves itself first, and says which part is wrong when it cannot.
 *
 * It also proves the harness is not a backdoor. A forged token and an expired one are both refused,
 * which is only interesting because it means the API is doing real verification rather than
 * trusting anything shaped like a JWT.
 */

test.describe('harness', () => {
  test.beforeAll(async () => {
    if (databaseAvailable()) await upsertAllIdentities();
  });

  test('a token minted by the harness is accepted as a real session', async ({ ownerApi }) => {
    const me = await ownerApi.me();

    expect(
      me.id,
      'The API accepted the token but resolved a different user — is this environment seeded from ' +
        'contracts/fixtures.ts? Run `pnpm db:seed`.',
    ).toBe(fixtures.IDS.owner);
    expect(me.email).toBe(fixtures.users.owner.email);
  });

  test('all three fixture identities resolve, so flow 4 has two accounts to work with', async ({
    ownerApi,
    viewerApi,
    strangerApi,
  }) => {
    expect((await ownerApi.me()).email).toBe(fixtures.users.owner.email);
    expect((await viewerApi.me()).email).toBe(fixtures.users.viewer.email);
    expect((await strangerApi.me()).email).toBe(fixtures.users.stranger.email);
  });

  test('an expired token is refused, and so is one signed with the wrong secret', async () => {
    const claims = { sub: IDENTITIES.owner.id, email: IDENTITIES.owner.email };

    const expired = await Api.as({
      kind: 'raw',
      bearer: signExpiredAccessToken(claims, env().jwtAccessSecret),
    });
    await expired.expectDenied('get', '/me', 'UNAUTHENTICATED');
    await expired.dispose();

    // If this one ever passes, the API is not verifying signatures and nothing else in this suite
    // means anything.
    const forged = await Api.as({
      kind: 'raw',
      bearer: signAccessToken(claims, 'not-the-real-secret-0000000000000', 900),
    });
    await forged.expectDenied('get', '/me', 'UNAUTHENTICATED');
    await forged.dispose();

    const none = await Api.as({ kind: 'anonymous' });
    await none.expectDenied('get', '/me', 'UNAUTHENTICATED');
    await none.dispose();
  });

  test('the refresh cookie the harness writes is honoured by the real endpoint', async () => {
    test.skip(
      !databaseAvailable(),
      'No DATABASE_URL: sessions are injected by route stub instead.',
    );

    const token = await issueRefreshToken(IDENTITIES.owner.id);
    const api = await Api.as({ kind: 'anonymous' });

    // Nothing test-only is involved: this is the same cookie the OAuth callback sets, against the
    // same endpoint the web app calls on boot.
    const response = await api.raw.post(api.absolute('/auth/refresh'), {
      headers: { cookie: `refresh_token=${token}` },
    });
    expect(response.status(), await response.text()).toBe(200);

    const session = (await response.json()) as { user: { id: string }; accessToken: string };
    expect(session.user.id).toBe(IDENTITIES.owner.id);

    // Rotation happened: the response carries a *different* cookie from the one that was sent.
    const rotated = response.headers()['set-cookie'] ?? '';
    expect(rotated).toContain('refresh_token=');
    expect(rotated).not.toContain(token);

    // An immediate replay currently succeeds, and this test asserts that on purpose.
    //
    // `TokensService` allows a 15-second grace window so that two tabs refreshing together are not
    // both logged out. That is a defensible trade, but it is *not* what SPEC-02 says — rule 3 and
    // its acceptance criterion both promise that a replayed token is rejected and invalidates the
    // chain — and no CCP records the change. QA has raised it; until it is decided, pinning the
    // real behaviour here means a later fix shows up as a failing test to update rather than as a
    // silent difference between the spec and the system.
    const replay = await api.raw.post(api.absolute('/auth/refresh'), {
      headers: { cookie: `refresh_token=${token}` },
    });
    expect(
      replay.status(),
      'replay inside the grace window — see the note above if this is now 401',
    ).toBe(200);

    await api.dispose();
  });

  test('the share-resolve coordinator requires one unsharded worker', () => {
    expect(() => assertShareResolveTopology({ workers: 1, shard: null })).not.toThrow();
    expect(() => assertShareResolveTopology({ workers: 2, shard: null })).toThrow(
      /workers=1.*received 2/i,
    );
    expect(() =>
      assertShareResolveTopology({ workers: 1, shard: { current: 1, total: 2 } }),
    ).toThrow(/sharding.*not supported/i);
  });

  test('the suite lock serializes an independent process on the same host', async () => {
    const portProbe = createServer();
    portProbe.listen(0, '127.0.0.1');
    await once(portProbe, 'listening');
    const address = portProbe.address();
    expect(address && typeof address === 'object').toBe(true);
    const port = (address as { port: number }).port;
    portProbe.close();
    await once(portProbe, 'close');

    const holder = spawn(
      process.execPath,
      [
        '-e',
        [
          "const net = require('node:net');",
          'const server = net.createServer();',
          "server.listen(Number(process.argv[1]), '127.0.0.1', () => process.stdout.write('ready\\n'));",
          "process.stdin.once('data', () => server.close(() => process.exit(0)));",
        ].join(''),
        String(port),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const [ready] = await once(holder.stdout, 'data');
    expect(String(ready)).toContain('ready');

    const waitMessages: string[] = [];
    let acquired = false;
    let lock: Awaited<ReturnType<typeof acquireShareResolveProcessLock>> | undefined;
    const waiting = acquireShareResolveProcessLock({
      port,
      retryIntervalMs: 10,
      timeoutMs: 2_000,
      onWait: (message) => waitMessages.push(message),
    }).then((lock) => {
      acquired = true;
      return lock;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(acquired).toBe(false);
      expect(waitMessages).toHaveLength(1);

      holder.stdin.write('release');
      await once(holder, 'exit');

      lock = await waiting;
      expect(acquired).toBe(true);
      await lock.release();
      await lock.release();
    } finally {
      if (holder.exitCode === null) {
        holder.stdin.write('release');
        await once(holder, 'exit');
      }
      lock ??= await waiting.catch(() => undefined);
      await lock?.release();
    }
  });

  test('share-resolve recovery covers refetches, pages, and direct API contexts', async ({
    browser,
  }) => {
    const statuses: number[] = [];
    const unguardedRequests: string[] = [];
    let guardedRequestCount = 0;
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const guardedCandidate =
        request.method === 'GET' && requestUrl.pathname === '/api/v1/shared/probe';
      if (guardedCandidate) guardedRequestCount += 1;
      const status = guardedCandidate && guardedRequestCount % 2 === 0 ? 200 : 429;
      statuses.push(status);
      if (!guardedCandidate) unguardedRequests.push(`${request.method} ${requestUrl.pathname}`);
      response.writeHead(status, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Retry-After-share': '0',
        'X-RateLimit-Remaining-share': status === 200 ? '9' : '0',
        'X-RateLimit-Reset-share': '0',
      });
      response.end(
        JSON.stringify(
          status === 429
            ? { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: 'harness-probe' }
            : { ok: true },
        ),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    expect(address && typeof address === 'object').toBe(true);
    const url = `http://127.0.0.1:${(address as { port: number }).port}/api/v1/shared/probe`;
    const nonResolveUrl = `http://127.0.0.1:${(address as { port: number }).port}/api/v1/nodes/probe`;
    const browserContext = await browser.newContext();
    await protectShareResolveBrowserContext(browserContext);
    const page = await browserContext.newPage();
    const secondPage = await browserContext.newPage();
    const rawApi = await playwrightRequest.newContext();
    const api = protectShareResolveApiContext(rawApi);

    try {
      const capturedRequestPromise = page.waitForRequest(
        (request) => request.method() === 'GET' && request.url() === url,
      );
      const navigation = await page.goto(url);
      const capturedRequest = await capturedRequestPromise;
      const refetchStatus = await page.evaluate(
        async (shareUrl) => (await fetch(shareUrl)).status,
        url,
      );
      const secondNavigation = await secondPage.goto(url);
      const apiResponse = await api.get(url);
      const fetchResponse = await api.fetch(url);
      const requestFetchResponse = await api.fetch(capturedRequest);
      const postResponse = await api.fetch(url, { method: 'POST' });
      const nonResolveResponse = await api.fetch(nonResolveUrl);

      expect(navigation?.status()).toBe(200);
      expect(refetchStatus).toBe(200);
      expect(secondNavigation?.status()).toBe(200);
      expect(apiResponse.status()).toBe(200);
      expect(fetchResponse.status()).toBe(200);
      expect(requestFetchResponse.status()).toBe(200);
      expect(postResponse.status()).toBe(429);
      expect(nonResolveResponse.status()).toBe(429);
      expect(statuses).toEqual([
        429, 200, 429, 200, 429, 200, 429, 200, 429, 200, 429, 200, 429, 429,
      ]);
      expect(unguardedRequests).toEqual(['POST /api/v1/shared/probe', 'GET /api/v1/nodes/probe']);
      await expect(page.locator('body')).not.toContainText('RATE_LIMITED');
    } finally {
      await browserContext.close();
      await api.dispose();
      server.close();
      await once(server, 'close');
    }
  });
});
