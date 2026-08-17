import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ApiError,
  DataRoomDto,
  ListDataRoomsResponse,
  NodeDetailResponse,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const url = (path: string, id?: string): string =>
  `${API_BASE}${id ? path.replace(':id', id) : path}`;

describe('data rooms', () => {
  let harness: TestHarness;
  let seeded: SeededFixtures;
  let owner: { id: string; email: string };
  let viewer: { id: string; email: string };
  let stranger: { id: string; email: string };

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
    viewer = { id: seeded.viewerId, email: fixtures.users.viewer.email };
    stranger = { id: seeded.strangerId, email: fixtures.users.stranger.email };
  });

  describe('GET /data-rooms', () => {
    it('lists the owner’s rooms with room-wide rollups', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(owner))
        .expect(200);

      const body = ListDataRoomsResponse.parse(response.body);
      expect(body.sharedWithMe).toEqual([]);
      expect(body.owned).toHaveLength(1);
      expect(body.owned[0]).toMatchObject({
        id: seeded.roomId,
        name: fixtures.dataRoom.name,
        rootNodeId: seeded.rootNodeId,
        access: 'owner',
        fileCount: fixtures.dataRoom.fileCount,
        sizeBytes: fixtures.dataRoom.sizeBytes,
      });
    });

    it('lists a shared room entered at the share root, with only that subtree’s totals', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(viewer))
        .expect(200);

      const body = ListDataRoomsResponse.parse(response.body);
      expect(body.owned).toEqual([]);
      expect(body.sharedWithMe).toHaveLength(1);

      const shared = body.sharedWithMe[0]!;
      expect(shared.access).toBe('viewer');
      // Entering at the room root would produce a sidebar link that 403s on click.
      expect(shared.rootNodeId).toBe(seeded.legalId);
      // And the room's own totals would disclose the size of content outside the grant.
      expect(shared.fileCount).toBe(1);
      expect(shared.sizeBytes).toBe(fixtures.nodes.nda.sizeBytes);
      expect(shared.ownerName).toBe(fixtures.users.owner.name);
    });

    it('shows a stranger nothing at all', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(stranger))
        .expect(200);

      expect(ListDataRoomsResponse.parse(response.body)).toEqual({ owned: [], sharedWithMe: [] });
    });

    it('drops a room from sharedWithMe the moment the share is revoked', async () => {
      await harness.dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [
        seeded.permissionedShareId,
      ]);

      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(viewer))
        .expect(200);
      expect(ListDataRoomsResponse.parse(response.body).sharedWithMe).toEqual([]);
    });

    it('matches an invitation by email before the invitee has ever signed in', async () => {
      await harness.dataSource.query(`UPDATE share_recipients SET user_id = NULL WHERE share_id = $1`, [
        seeded.permissionedShareId,
      ]);

      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(viewer))
        .expect(200);
      expect(ListDataRoomsResponse.parse(response.body).sharedWithMe).toHaveLength(1);
    });

    it('requires a session', async () => {
      await request(httpServer(harness)).get(url(endpoints.dataRooms.list.path)).expect(401);
    });
  });

  describe('POST /data-rooms', () => {
    it('creates the room and its root node atomically', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.dataRooms.create.path))
        .send({ name: 'Project Beta' })
        .set(await harness.authHeader(owner))
        .expect(201);

      const room = DataRoomDto.parse(response.body);
      expect(room.access).toBe('owner');
      expect(room.fileCount).toBe(0);
      expect(room.sizeBytes).toBe(0);

      const rows: Array<{ id: string; parent_id: string | null; path: string; name: string }> =
        await harness.dataSource.query(`SELECT id, parent_id, path, name FROM nodes WHERE id = $1`, [
          room.rootNodeId,
        ]);
      expect(rows[0]).toMatchObject({ parent_id: null, name: 'Project Beta' });
      expect(rows[0]?.path).toBe(`/${room.rootNodeId}/`);

      // And it is immediately browsable.
      const detail = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, room.rootNodeId))
        .set(await harness.authHeader(owner))
        .expect(200);
      expect(NodeDetailResponse.parse(detail.body).breadcrumbs).toHaveLength(1);
    });

    it('allows an owner several rooms, and keeps their names independent', async () => {
      for (const name of ['One', 'Two']) {
        await request(httpServer(harness))
          .post(url(endpoints.dataRooms.create.path))
          .send({ name })
          .set(await harness.authHeader(owner))
          .expect(201);
      }

      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(owner))
        .expect(200);
      expect(ListDataRoomsResponse.parse(response.body).owned).toHaveLength(3);
    });

    it.each([
      ['an empty name', '  '],
      ['a name with a slash', 'a/b'],
    ])('rejects %s', async (_label, name) => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.dataRooms.create.path))
        .send({ name })
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /data-rooms/:id', () => {
    it('returns the room to its owner', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.get.path, seeded.roomId))
        .set(await harness.authHeader(owner))
        .expect(200);
      expect(DataRoomDto.parse(response.body).access).toBe('owner');
    });

    it('returns it to a link holder, scoped to their share root', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.get.path, seeded.roomId))
        .set('X-Share-Token', seeded.publicToken)
        .expect(200);

      const room = DataRoomDto.parse(response.body);
      expect(room.access).toBe('viewer');
      expect(room.rootNodeId).toBe(seeded.financialsId);
      expect(room.fileCount).toBe(1);
    });

    it('refuses a stranger', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.get.path, seeded.roomId))
        .set(await harness.authHeader(stranger))
        .expect(403);
      expect(ApiError.parse(response.body).code).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /data-rooms/:id', () => {
    it('renames the room and its root node together', async () => {
      await request(httpServer(harness))
        .patch(url(endpoints.dataRooms.update.path, seeded.roomId))
        .send({ name: 'Project Atlas II' })
        .set(await harness.authHeader(owner))
        .expect(200);

      const rows: Array<{ name: string }> = await harness.dataSource.query(
        `SELECT name FROM nodes WHERE id = $1`,
        [seeded.rootNodeId],
      );
      expect(rows[0]?.name).toBe('Project Atlas II');
    });

    it.each([
      ['a viewer', () => viewer],
      ['a stranger', () => stranger],
    ])('refuses %s', async (_label, who) => {
      await request(httpServer(harness))
        .patch(url(endpoints.dataRooms.update.path, seeded.roomId))
        .send({ name: 'Hijacked' })
        .set(await harness.authHeader(who()))
        .expect(403);
    });
  });

  describe('DELETE /data-rooms/:id', () => {
    it('soft-deletes every node and revokes every share in the room', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.dataRooms.remove.path, seeded.roomId))
        .set(await harness.authHeader(owner))
        .expect(204);

      const live: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM nodes WHERE data_room_id = $1 AND deleted_at IS NULL`,
        [seeded.roomId],
      );
      expect(live[0]?.count).toBe('0');

      const shares: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM shares WHERE data_room_id = $1 AND revoked_at IS NULL`,
        [seeded.roomId],
      );
      expect(shares[0]?.count).toBe('0');

      // The link dies with it.
      const denied = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.q3Id))
        .set('X-Share-Token', seeded.publicToken)
        .expect(410);
      expect(ApiError.parse(denied.body).code).toBe('ITEM_GONE');
    });

    it('disappears from the owner’s list', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.dataRooms.remove.path, seeded.roomId))
        .set(await harness.authHeader(owner))
        .expect(204);

      const response = await request(httpServer(harness))
        .get(url(endpoints.dataRooms.list.path))
        .set(await harness.authHeader(owner))
        .expect(200);
      expect(ListDataRoomsResponse.parse(response.body).owned).toEqual([]);
    });

    it('refuses a viewer', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.dataRooms.remove.path, seeded.roomId))
        .set(await harness.authHeader(viewer))
        .expect(403);
    });
  });
});
