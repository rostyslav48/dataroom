import { fixtures } from '../support/contracts';
import { Api, env, expect, test } from '../support/fixtures';
import { databaseAvailable, IDENTITIES, issueRefreshToken, upsertAllIdentities } from '../support/db';
import { signAccessToken, signExpiredAccessToken } from '../support/jwt';

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
    test.skip(!databaseAvailable(), 'No DATABASE_URL: sessions are injected by route stub instead.');

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
});
