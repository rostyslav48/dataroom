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

  const signIn = async (
    identity: GoogleIdentity = googleIdentity(),
    state?: string,
  ): Promise<{ cookie: string; location: string }> => {
    harness.googleProfile.current = identity;
    const response = await request(httpServer(harness))
      .get(url(endpoints.auth.googleCallback.path))
      .query(state ? { state } : {})
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
      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleCallback.path))
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
      const state = Buffer.from(JSON.stringify({ returnTo: '/rooms/abc' })).toString('base64url');
      const { location } = await signIn(googleIdentity(), state);
      expect(location).toBe('http://localhost:5173/rooms/abc');
    });

    it.each([
      ['an absolute url', 'https://evil.com'],
      ['a protocol-relative url', '//evil.com'],
      ['garbage', 'not-base64'],
      ['a json non-string', JSON.stringify({ returnTo: 42 })],
    ])('falls back to the default when state carries %s', async (_label, returnTo) => {
      const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');
      const { location } = await signIn(googleIdentity(), state);
      expect(location).toBe('http://localhost:5173/rooms');
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

      // Replay of the already-exchanged token.
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
