import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  DataRoomDto,
  DeletePreviewDto,
  ListChildrenResponse,
  ListDataRoomsResponse,
  MeResponse,
  NodeDetailResponse,
  NodeDto,
  NodeStatsDto,
  RefreshResponse,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import type { ZodType } from 'zod';
import { UserEntity } from '../../src/database/entities';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import type { GoogleIdentity } from '../../src/users/users.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const url = (path: string, params: Record<string, string> = {}): string => {
  const rendered = Object.entries(params).reduce(
    (current, [key, value]) => current.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );
  return `${API_BASE}${rendered}`;
};

const parseStrict = <T>(schema: ZodType<T>, body: unknown): T => schema.parse(body);

const cookieValue = (headers: Record<string, unknown>, name: string): string => {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cookie = cookies.find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie, `${name} cookie`).toBeDefined();
  return (cookie as string).split(';')[0] as string;
};

describe('contract — auth, data rooms and nodes', () => {
  let harness: TestHarness;
  let seeded: SeededFixtures;
  let owner: { id: string; email: string };

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.dataSource);
    seeded = await seedFixtures(harness.dataSource);
    owner = { id: seeded.ownerId, email: fixtures.users.owner.email };
  });

  const stateFor = (nonce: string): string =>
    Buffer.from(JSON.stringify({ returnTo: null, nonce })).toString('base64url');

  const signIn = async (): Promise<string> => {
    const identity: GoogleIdentity = {
      googleSub: 'contract-google-sub',
      email: 'contract-auth@example.com',
      name: 'Contract Auth',
      avatarUrl: null,
    };
    harness.googleProfile.current = identity;

    const start = await request(httpServer(harness))
      .get(url(endpoints.auth.googleStart.path))
      .expect(200);
    const stateCookie = cookieValue(start.headers as Record<string, unknown>, 'oauth_state');
    const nonce = stateCookie.slice('oauth_state='.length);

    const callback = await request(httpServer(harness))
      .get(url(endpoints.auth.googleCallback.path))
      .query({ state: stateFor(nonce) })
      .set('Cookie', stateCookie)
      .expect(302);
    return cookieValue(callback.headers as Record<string, unknown>, 'refresh_token');
  };

  describe('auth endpoints', () => {
    it('googleStart returns the documented bodyless OAuth start response', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleStart.path))
        .query({ returnTo: '/rooms' })
        .expect(200);

      expect(response.text).toBe('');
      expect(cookieValue(response.headers as Record<string, unknown>, 'oauth_state')).toMatch(
        /^oauth_state=.+/,
      );
    });

    it('googleCallback returns the documented bodyless redirect response', async () => {
      harness.googleProfile.current = {
        googleSub: 'contract-callback-sub',
        email: 'callback@example.com',
        name: 'Callback User',
        avatarUrl: null,
      };
      const start = await request(httpServer(harness))
        .get(url(endpoints.auth.googleStart.path))
        .expect(200);
      const stateCookie = cookieValue(start.headers as Record<string, unknown>, 'oauth_state');
      const nonce = stateCookie.slice('oauth_state='.length);

      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.googleCallback.path))
        .query({ state: stateFor(nonce) })
        .set('Cookie', stateCookie)
        .expect(302);

      expect(response.text).toContain('Found');
      expect(response.headers.location).toBe('http://localhost:5173/rooms');
      expect(cookieValue(response.headers as Record<string, unknown>, 'refresh_token')).toMatch(
        /^refresh_token=.+/,
      );
    });

    it('refresh returns a strict RefreshResponse', async () => {
      const refreshCookie = await signIn();
      const response = await request(httpServer(harness))
        .post(url(endpoints.auth.refresh.path))
        .set('Cookie', refreshCookie)
        .expect(200);

      parseStrict(RefreshResponse, response.body);
    });

    it('logout returns the documented empty response', async () => {
      const refreshCookie = await signIn();
      const user = await harness.dataSource
        .getRepository(UserEntity)
        .findOneByOrFail({ googleSub: 'contract-google-sub' });

      const response = await request(httpServer(harness))
        .post(url(endpoints.auth.logout.path))
        .set(await harness.authHeader(user))
        .set('Cookie', refreshCookie)
        .expect(204);

      expect(response.text).toBe('');
    });

    it('me returns a strict MeResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.auth.me.path))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(MeResponse, response.body);
    });
  });

  describe('data-room endpoints', () => {
    it('list returns a strict ListDataRoomsResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(ListDataRoomsResponse, response.body);
    });

    it('create returns a strict DataRoomDto', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.dataRooms.create.path))
        .set(await harness.authHeader(owner))
        .send({ name: 'Contract Room' })
        .expect(201);

      parseStrict(DataRoomDto, response.body);
    });

    it('get returns a strict DataRoomDto', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.get.path, { id: seeded.roomId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(DataRoomDto, response.body);
    });

    it('update returns a strict DataRoomDto', async () => {
      const response = await request(httpServer(harness))
        .patch(url(endpoints.dataRooms.update.path, { id: seeded.roomId }))
        .set(await harness.authHeader(owner))
        .send({ name: 'Contract Rename' })
        .expect(200);

      parseStrict(DataRoomDto, response.body);
    });

    it('remove returns the documented empty response', async () => {
      const response = await request(httpServer(harness))
        .delete(url(endpoints.dataRooms.remove.path, { id: seeded.roomId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      expect(response.text).toBe('');
    });
  });

  describe('node endpoints', () => {
    it('get returns a strict NodeDetailResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.legalId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(NodeDetailResponse, response.body);
    });

    it('children returns a strict ListChildrenResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, { id: seeded.rootNodeId }))
        .query({ limit: 2, sort: 'name', dir: 'asc' })
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(ListChildrenResponse, response.body);
    });

    it('stats returns a strict NodeStatsDto', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.stats.path, { id: seeded.rootNodeId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(NodeStatsDto, response.body);
    });

    it('deletePreview returns a strict DeletePreviewDto', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.deletePreview.path, { id: seeded.legalId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(DeletePreviewDto, response.body);
    });

    it('createFolder returns a strict NodeDto', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .set(await harness.authHeader(owner))
        .send({ parentId: seeded.legalId, name: 'Contract Folder' })
        .expect(201);

      parseStrict(NodeDto, response.body);
    });

    it('rename returns a strict NodeDto', async () => {
      const response = await request(httpServer(harness))
        .patch(url(endpoints.nodes.rename.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(owner))
        .send({ name: 'Contract NDA.pdf' })
        .expect(200);

      parseStrict(NodeDto, response.body);
    });

    it('move returns a strict NodeDto', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(owner))
        .send({ parentId: seeded.q3Id })
        .expect(200);

      parseStrict(NodeDto, response.body);
    });

    it('remove returns the documented empty response', async () => {
      const response = await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(owner))
        .expect(204);

      expect(response.text).toBe('');
    });

    it('content returns the documented bodyless redirect', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.content.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(owner))
        .expect(302);

      expect(response.headers.location).toMatch(/^https:\/\/storage\.test\/object\//);
      expect(response.text).toContain('Found');
    });

    it('download returns the documented bodyless redirect', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.download.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(owner))
        .expect(302);

      expect(response.headers.location).toMatch(/^https:\/\/storage\.test\/object\//);
      expect(response.text).toContain('Found');
    });
  });
});
