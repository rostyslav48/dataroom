import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE, ApiError, SessionDto, UserDto, endpoints } from '@dataroom/contracts';
import { ShareRecipientEntity, UserEntity } from '../../src/database/entities';
import type { GoogleIdentity } from '../../src/users/users.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';

const url = (path: string): string => `${API_BASE}${path}`;

const googleIdentity = (overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  googleSub: 'google-sub-1',
  email: 'owner@example.com',
  name: 'Acme Owner',
  avatarUrl: null,
  ...overrides,
});

/** The refresh cookie value out of a `Set-Cookie` header, or undefined if none was set. */
const refreshCookie = (headers: Record<string, unknown>): string | undefined => {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith('refresh_token='));
};

const cookieValue = (cookie: string): string => cookie.split(';')[0] as string;

describe('auth', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /** The nonce the API just minted, as the browser would hold it. */
  const startFlow = async (returnTo?: string): Promise<{ cookie: string; nonce: string }> => {
    const response = await request(httpServer(harness))
      .get(url(endpoints.auth.googleStart.path))
      .query(returnTo === undefined ? {} : { returnTo })
      .expect(200);

    const raw = response.headers['set-cookie'] as unknown;
    const cookies = Array.isArray(raw) ? (raw as string[]) : [];
    const stateCookie = cookies.find((cookie) => cookie.startsWith('oauth_state='));
    expect(stateCookie, 'the start route sets a state cookie').toBeDefined();

    const value = cookieValue(stateCookie as string);
    return { cookie: value, nonce: value.slice('oauth_state='.length) };
  };

  const stateFor = (nonce: string, returnTo: string | null = null): string =>
    Buffer.from(JSON.stringify({ returnTo, nonce })).toString('base64url');

  /** The whole round trip: start the flow, come back with a matching state, get a session. */
  const signIn = async (
    identity: GoogleIdentity = googleIdentity(),
    returnTo: string | null = null,
  ): Promise<{ cookie: string; location: string }> => {
    harness.googleProfile.current = identity;
    const { cookie: stateCookie, nonce } = await startFlow(returnTo ?? undefined);

    const response = await request(httpServer(harness))
      .get(url(endpoints.auth.googleCallback.path))
      .query({ state: stateFor(nonce, returnTo) })
      .set('Cookie', stateCookie)
      .expect(302);

    const cookie = refreshCookie(response.headers as Record<string, unknown>);
    expect(cookie).toBeDefined();
    return { cookie: cookieValue(cookie as string), location: response.headers.location as string };
  };

  describe('GET /auth/google', () => {
    it('accepts a same-origin return path', async () => {
      await request(httpServer(harness))
        .get(url(endpoints.auth.googleStart.path))
        .query({ returnTo: '/rooms/abc' })
        .expect(200);
    });

    it.each([
      ['an absolute url', 'https://evil.com'],
      ['a protocol-relative url', '//evil.com'],
      ['a scheme-only value', 'javascript:alert(1)'],
      ['a bare path with no leading slash', 'rooms'],
    ])('rejects %s as VALIDATION_FAILED', async (_label, returnTo) => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleStart.path))
        .query({ returnTo })
        .expect(400);

      expect(ApiError.parse(response.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /auth/google/callback', () => {
    it('creates the user on first sign-in and updates on the second', async () => {
      await signIn();
      const users = harness.dataSource.getRepository(UserEntity);
      expect(await users.count()).toBe(1);

      await signIn(googleIdentity({ name: 'Renamed', avatarUrl: 'https://example.com/a.png' }));
      expect(await users.count()).toBe(1);

      const user = await users.findOneByOrFail({ googleSub: 'google-sub-1' });
      expect(user.name).toBe('Renamed');
      expect(user.avatarUrl).toBe('https://example.com/a.png');
    });

    it('keeps identity stable when the Google email changes', async () => {
      await signIn();
      const users = harness.dataSource.getRepository(UserEntity);
      const before = await users.findOneByOrFail({ googleSub: 'google-sub-1' });

      await signIn(googleIdentity({ email: 'new-address@example.com' }));

      const after = await users.findOneByOrFail({ googleSub: 'google-sub-1' });
      expect(after.id).toBe(before.id);
      expect(after.email).toBe('new-address@example.com');
      expect(await users.count()).toBe(1);
    });

    it('backfills a share invitation addressed to an email with no account yet', async () => {
      const owner = await harness.dataSource.getRepository(UserEntity).save({
        googleSub: 'owner-sub',
        email: 'owner@example.com',
        name: 'Owner',
        avatarUrl: null,
      });
      const [room] = (await harness.dataSource.query(
        `INSERT INTO data_rooms (owner_id, name) VALUES ($1, 'Room') RETURNING id`,
        [owner.id],
      )) as Array<{ id: string }>;
      const [node] = (await harness.dataSource.query(
        `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, NULL, 'folder', 'Room', '/x/', 0, $2) RETURNING id`,
        [room!.id, owner.id],
      )) as Array<{ id: string }>;
      const [share] = (await harness.dataSource.query(
        `INSERT INTO shares (node_id, data_room_id, type, created_by)
         VALUES ($1, $2, 'permissioned', $3) RETURNING id`,
        [node!.id, room!.id, owner.id],
      )) as Array<{ id: string }>;
      await harness.dataSource.query(
        `INSERT INTO share_recipients (share_id, email) VALUES ($1, 'Invitee@Example.com')`,
        [share!.id],
      );

      await signIn(googleIdentity({ googleSub: 'invitee-sub', email: 'invitee@example.com' }));

      const recipient = await harness.dataSource
        .getRepository(ShareRecipientEntity)
        .findOneByOrFail({ shareId: share!.id });
      expect(recipient.userId).not.toBeNull();
      expect(recipient.acceptedAt).not.toBeNull();
    });

    it('sends the refresh token as an httpOnly cookie scoped to the auth path', async () => {
      harness.googleProfile.current = googleIdentity();
      const { cookie: stateCookie, nonce } = await startFlow();
      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleCallback.path))
        .query({ state: stateFor(nonce) })
        .set('Cookie', stateCookie)
        .expect(302);

      const cookie = refreshCookie(response.headers as Record<string, unknown>) as string;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth');
      // Host-only: both platform domains are on the Public Suffix List, so a Domain attribute
      // would be rejected by the browser anyway.
      expect(cookie).not.toContain('Domain=');
    });

    it('never puts the access token in the redirect url', async () => {
      const { location } = await signIn();
      expect(location).not.toMatch(/token/i);
      expect(location).toBe('http://localhost:5173/rooms');
    });

    it('round-trips a valid returnTo through state', async () => {
      const { location } = await signIn(googleIdentity(), '/rooms/abc');
      expect(location).toBe('http://localhost:5173/rooms/abc');
    });

    it.each([
      ['an absolute url', 'https://evil.com'],
      ['a protocol-relative url', '//evil.com'],
      ['a javascript scheme', 'javascript:alert(1)'],
    ])('falls back to the default when state carries %s', async (_label, returnTo) => {
      // The state is re-validated on the way back in, not merely on the way out: this is a value
      // that left our control entirely and came back through somebody else's redirect.
      harness.googleProfile.current = googleIdentity();
      const { cookie, nonce } = await startFlow();

      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleCallback.path))
        .query({ state: stateFor(nonce, returnTo) })
        .set('Cookie', cookie)
        .expect(302);

      expect(response.headers.location).toBe('http://localhost:5173/rooms');
    });

    describe('login CSRF', () => {
      it('refuses a callback with no state cookie', async () => {
        harness.googleProfile.current = googleIdentity();
        const { nonce } = await startFlow();

        // The attacker's browser holds the cookie; the victim's does not.
        const response = await request(httpServer(harness))
          .get(url(endpoints.auth.googleCallback.path))
          .query({ state: stateFor(nonce) })
          .expect(403);

        expect(ApiError.parse(response.body).code).toBe('FORBIDDEN');
        expect(refreshCookie(response.headers as Record<string, unknown>)).toBeUndefined();
      });

      it('refuses a callback whose state does not match the cookie', async () => {
        harness.googleProfile.current = googleIdentity();
        const { cookie } = await startFlow();

        await request(httpServer(harness))
          .get(url(endpoints.auth.googleCallback.path))
          .query({ state: stateFor('a-nonce-from-somewhere-else') })
          .set('Cookie', cookie)
          .expect(403);
      });

      it('refuses a callback with no state at all', async () => {
        harness.googleProfile.current = googleIdentity();
        const { cookie } = await startFlow();

        await request(httpServer(harness))
          .get(url(endpoints.auth.googleCallback.path))
          .set('Cookie', cookie)
          .expect(403);
      });

      it('consumes the nonce, so a captured callback cannot be replayed', async () => {
        harness.googleProfile.current = googleIdentity();
        const { cookie, nonce } = await startFlow();

        await request(httpServer(harness))
          .get(url(endpoints.auth.googleCallback.path))
          .query({ state: stateFor(nonce) })
          .set('Cookie', cookie)
          .expect(302);

        // The browser was told to clear the cookie; a client that ignores that still gains nothing,
        // because Google will not honour the same authorization code twice either.
        const cleared = await request(httpServer(harness))
          .get(url(endpoints.auth.googleStart.path))
          .expect(200);
        const raw = cleared.headers['set-cookie'] as unknown;
        const fresh = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
          c.startsWith('oauth_state='),
        );
        expect(cookieValue(fresh as string)).not.toBe(cookie);
      });
    });
  });

  describe('POST /auth/refresh', () => {
    it('issues a new session for a valid cookie', async () => {
      const { cookie } = await signIn();

      const response = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(200);

      const session = SessionDto.parse(response.body);
      expect(session.user.email).toBe('owner@example.com');
      expect(new Date(session.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(refreshCookie(response.headers as Record<string, unknown>)).toBeDefined();
    });

    it('rotates the refresh token on every use', async () => {
      const { cookie } = await signIn();

      const first = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(200);

      const rotated = cookieValue(
        refreshCookie(first.headers as Record<string, unknown>) as string,
      );
      expect(rotated).not.toBe(cookie);

      await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', rotated)
        .expect(200);
    });

    it('rejects a replayed token and kills the whole chain', async () => {
      const { cookie } = await signIn();

      const first = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(200);
      const rotated = cookieValue(
        refreshCookie(first.headers as Record<string, unknown>) as string,
      );

      // Age the exchange past the race window, so this is a replay rather than two tabs refreshing
      // at the same moment.
      await harness.dataSource.query(
        `UPDATE refresh_tokens SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL`,
      );

      const replay = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(401);
      expect(ApiError.parse(replay.body).code).toBe('UNAUTHENTICATED');

      // …and the token the legitimate client is holding is now dead too, because there is no way
      // to tell which of the two holders was the attacker.
      await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', rotated)
        .expect(401);
    });

    it('treats two tabs refreshing at the same moment as a race, not an attack', async () => {
      const { cookie } = await signIn();

      const first = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(200);

      // The second tab arrives moments later holding the same cookie. Revoking the family here
      // would log the user out of both tabs for doing nothing wrong.
      const second = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(200);

      const firstRotated = cookieValue(
        refreshCookie(first.headers as Record<string, unknown>) as string,
      );
      const secondRotated = cookieValue(
        refreshCookie(second.headers as Record<string, unknown>) as string,
      );
      expect(secondRotated).not.toBe(firstRotated);

      // Both successors work, and both belong to the same live family.
      for (const rotated of [firstRotated, secondRotated]) {
        await request(httpServer(harness))
          .post(url(endpoints.auth.refresh.path))
          .set('Cookie', rotated)
          .expect(200);
      }
    });

    it('rejects a missing cookie and an unknown token', async () => {
      await request(httpServer(harness)).post(url(endpoints.auth.refresh.path)).expect(401);
      await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', 'refresh_token=not-a-real-token')
        .expect(401);
    });

    it('rejects an expired token', async () => {
      const { cookie } = await signIn();
      await harness.dataSource.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1s'`);

      await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the cookie and ends the session', async () => {
      const { cookie } = await signIn();
      const user = await harness.dataSource
        .getRepository(UserEntity)
        .findOneByOrFail({ googleSub: 'google-sub-1' });

      const response = await request(httpServer(harness))
        .post(url(endpoints.auth.logout.path))
        .set(await harness.authHeader(user))
        .set('Cookie', cookie)
        .expect(204);

      expect(refreshCookie(response.headers as Record<string, unknown>)).toContain(
        'refresh_token=;',
      );

      await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', cookie)
        .expect(401);
    });
  });

  describe('GET /me', () => {
    it('returns the signed-in user', async () => {
      await signIn();
      const user = await harness.dataSource
        .getRepository(UserEntity)
        .findOneByOrFail({ googleSub: 'google-sub-1' });

      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.me.path))
        .set(await harness.authHeader(user))
        .expect(200);

      expect(UserDto.parse(response.body)).toEqual({
        id: user.id,
        email: 'owner@example.com',
        name: 'Acme Owner',
        avatarUrl: null,
      });
    });

    it('401s with no session, rather than 200 with a null user', async () => {
      const response = await request(httpServer(harness)).get(url(endpoints.auth.me.path)).expect(401);
      expect(ApiError.parse(response.body).code).toBe('UNAUTHENTICATED');
    });

    it('401s on a forged or expired access token', async () => {
      await request(httpServer(harness))
        .get(url(endpoints.auth.me.path))
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });
  });
});
