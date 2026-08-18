import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ApiError,
  ListSharesResponse,
  NodeDetailResponse,
  ResolveShareResponse,
  ShareDto,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import { UserEntity } from '../../src/database/entities';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { SharesService } from '../../src/shares/shares.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const url = (path: string, params: Record<string, string>): string =>
  `${API_BASE}${Object.entries(params).reduce(
    (resolved, [name, value]) => resolved.replace(`:${name}`, value),
    path,
  )}`;

describe('shares', () => {
  let harness: TestHarness;
  let seeded: SeededFixtures;
  let owner: { id: string; email: string };
  let viewer: { id: string; email: string };

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
  });

  describe('POST /nodes/:id/shares', () => {
    it('creates a public link from 32 random bytes and returns only its absolute web URL', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(owner))
        .send({ type: 'public_link', recipients: [] })
        .expect(201);

      const share = ShareDto.parse(response.body);
      expect(share).toMatchObject({
        nodeId: seeded.q3Id,
        nodeName: fixtures.nodes.q3.name,
        nodeType: 'folder',
        type: 'public_link',
        role: 'viewer',
        expiresAt: null,
        revokedAt: null,
        recipients: [],
      });

      const publicUrl = new URL(share.url ?? '');
      expect(publicUrl.origin).toBe(harness.config.webOrigin);
      expect(publicUrl.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);

      const token = publicUrl.pathname.slice('/s/'.length);
      const rows: Array<{ token: string | null }> = await harness.dataSource.query(
        `SELECT token FROM shares WHERE id = $1`,
        [share.id],
      );
      expect(rows[0]?.token).toBe(token);
      expect(response.body).not.toHaveProperty('token');
    });

    it('creates a permissioned share with normalized recipients who need not have accounts', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(owner))
        .send({
          type: 'permissioned',
          recipients: ['NEW.PERSON@Example.COM', fixtures.users.stranger.email],
        })
        .expect(201);

      const share = ShareDto.parse(response.body);
      expect(share.type).toBe('permissioned');
      expect(share.url).toBeNull();
      expect(share.recipients).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: 'new.person@example.com',
            userId: null,
            acceptedAt: null,
            revokedAt: null,
          }),
          expect.objectContaining({
            email: fixtures.users.stranger.email,
            userId: seeded.strangerId,
            acceptedAt: expect.any(String),
            revokedAt: null,
          }),
        ]),
      );
    });

    it('returns an identical live public link instead of minting another token', async () => {
      const endpoint = url(endpoints.shares.create.path, { id: seeded.q3Id });
      const first = await request(httpServer(harness))
        .post(endpoint)
        .set(await harness.authHeader(owner))
        .send({ type: 'public_link' })
        .expect(201);
      const second = await request(httpServer(harness))
        .post(endpoint)
        .set(await harness.authHeader(owner))
        .send({ type: 'public_link' })
        .expect(201);

      expect(ShareDto.parse(second.body)).toEqual(ShareDto.parse(first.body));
      const rows: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM shares WHERE node_id = $1`,
        [seeded.q3Id],
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('deduplicates a permissioned share by its case-insensitive recipient set, not input order', async () => {
      const endpoint = url(endpoints.shares.create.path, { id: seeded.q3Id });
      const first = await request(httpServer(harness))
        .post(endpoint)
        .set(await harness.authHeader(owner))
        .send({
          type: 'permissioned',
          recipients: ['alpha@example.com', 'BETA@example.com'],
        })
        .expect(201);
      const second = await request(httpServer(harness))
        .post(endpoint)
        .set(await harness.authHeader(owner))
        .send({
          type: 'permissioned',
          recipients: ['beta@example.com', 'ALPHA@example.com'],
        })
        .expect(201);

      expect(ShareDto.parse(second.body).id).toBe(ShareDto.parse(first.body).id);
      const rows: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM shares WHERE node_id = $1`,
        [seeded.q3Id],
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('does not deduplicate a revoked or expired share', async () => {
      const endpoint = url(endpoints.shares.create.path, { id: seeded.q3Id });
      const first = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(endpoint)
            .set(await harness.authHeader(owner))
            .send({ type: 'public_link' })
            .expect(201)
        ).body,
      );
      await harness.dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [
        first.id,
      ]);

      const afterRevocation = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(endpoint)
            .set(await harness.authHeader(owner))
            .send({ type: 'public_link' })
            .expect(201)
        ).body,
      );
      expect(afterRevocation.id).not.toBe(first.id);

      await harness.dataSource.query(
        `UPDATE shares SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [afterRevocation.id],
      );
      const afterExpiry = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(endpoint)
            .set(await harness.authHeader(owner))
            .send({ type: 'public_link' })
            .expect(201)
        ).body,
      );
      expect(afterExpiry.id).not.toBe(afterRevocation.id);
    });

    it.each([
      ['a permissioned share without recipients', { type: 'permissioned', recipients: [] }],
      ['a public link with recipients', { type: 'public_link', recipients: ['a@example.com'] }],
    ])('lets the contract reject %s', async (_label, body) => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(owner))
        .send(body)
        .expect(400);

      expect(ApiError.parse(response.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('is owner-only and does not write after denial', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.legalId }))
        .set(await harness.authHeader(viewer))
        .send({ type: 'public_link' })
        .expect(403);

      const rows: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM shares WHERE node_id = $1`,
        [seeded.legalId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('GET share lists', () => {
    it('lists every share for one node, retaining revoked rows with a null URL', async () => {
      await harness.dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [
        seeded.publicShareId,
      ]);

      const response = await request(httpServer(harness))
        .get(url(endpoints.shares.listForNode.path, { id: seeded.financialsId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      const body = ListSharesResponse.parse(response.body);
      expect(body.shares).toHaveLength(1);
      expect(body.shares[0]).toMatchObject({
        id: seeded.publicShareId,
        nodeId: seeded.financialsId,
        revokedAt: expect.any(String),
        url: null,
      });
    });

    it('lists shares across one room with their node projections and recipients', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.shares.listForRoom.path, { id: seeded.roomId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      const body = ListSharesResponse.parse(response.body);
      expect(body.shares).toHaveLength(2);
      expect(body.shares).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: seeded.publicShareId,
            nodeName: fixtures.nodes.financials.name,
            nodeType: 'folder',
            recipients: [],
          }),
          expect.objectContaining({
            id: seeded.permissionedShareId,
            nodeName: fixtures.nodes.legal.name,
            recipients: [expect.objectContaining({ email: fixtures.users.viewer.email })],
          }),
        ]),
      );
    });

    it.each([
      ['node list', endpoints.shares.listForNode.path, () => seeded.legalId],
      ['room list', endpoints.shares.listForRoom.path, () => seeded.roomId],
    ])('keeps the %s owner-only', async (_label, path, id) => {
      await request(httpServer(harness))
        .get(url(path, { id: id() }))
        .set(await harness.authHeader(viewer))
        .expect(403);
    });
  });

  describe('POST /shares/:id/recipients', () => {
    it('adds normalized known and unknown invitees and returns the complete share', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.addRecipients.path, { id: seeded.permissionedShareId }))
        .set(await harness.authHeader(owner))
        .send({ emails: ['FUTURE@Example.com', fixtures.users.stranger.email] })
        .expect(200);

      const share = ShareDto.parse(response.body);
      expect(share.recipients).toHaveLength(3);
      expect(share.recipients).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: 'future@example.com',
            userId: null,
            acceptedAt: null,
            revokedAt: null,
          }),
          expect.objectContaining({
            email: fixtures.users.stranger.email,
            userId: seeded.strangerId,
            acceptedAt: expect.any(String),
            revokedAt: null,
          }),
        ]),
      );
    });

    it('is idempotent for an existing email and restores a previously revoked recipient', async () => {
      const recipientRows: Array<{ id: string }> = await harness.dataSource.query(
        `SELECT id FROM share_recipients WHERE share_id = $1`,
        [seeded.permissionedShareId],
      );
      const recipientId = recipientRows[0]?.id;
      expect(recipientId).toBeDefined();
      await harness.dataSource.query(
        `UPDATE share_recipients SET revoked_at = now() WHERE id = $1`,
        [recipientId],
      );

      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.addRecipients.path, { id: seeded.permissionedShareId }))
        .set(await harness.authHeader(owner))
        .send({ emails: [fixtures.users.viewer.email, fixtures.users.viewer.email.toUpperCase()] })
        .expect(200);

      const share = ShareDto.parse(response.body);
      expect(share.recipients).toHaveLength(1);
      expect(share.recipients[0]).toMatchObject({ id: recipientId, revokedAt: null });
    });

    it('rejects recipients on a public link without changing it', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.addRecipients.path, { id: seeded.publicShareId }))
        .set(await harness.authHeader(owner))
        .send({ emails: ['person@example.com'] })
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('VALIDATION_FAILED');

      const rows: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM share_recipients WHERE share_id = $1`,
        [seeded.publicShareId],
      );
      expect(rows[0]?.count).toBe('0');
    });

    it('is owner-only and does not add a recipient after denial', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.shares.addRecipients.path, { id: seeded.permissionedShareId }))
        .set(await harness.authHeader(viewer))
        .send({ emails: ['person@example.com'] })
        .expect(403);

      const rows: Array<{ count: string }> = await harness.dataSource.query(
        `SELECT count(*)::text AS count FROM share_recipients WHERE share_id = $1`,
        [seeded.permissionedShareId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('DELETE /shares/:id/recipients/:recipientId', () => {
    it('revokes without deleting and denies that recipient on the very next request', async () => {
      const recipientRows: Array<{ id: string }> = await harness.dataSource.query(
        `SELECT id FROM share_recipients WHERE share_id = $1`,
        [seeded.permissionedShareId],
      );
      const recipientId = recipientRows[0]?.id ?? '';

      await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(viewer))
        .expect(200);

      await request(httpServer(harness))
        .delete(
          url(endpoints.shares.revokeRecipient.path, {
            id: seeded.permissionedShareId,
            recipientId,
          }),
        )
        .set(await harness.authHeader(owner))
        .expect(204);

      const denied = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(viewer))
        .expect(403);
      expect(ApiError.parse(denied.body).code).toBe('ACCESS_REVOKED');

      const rows: Array<{ revokedAt: Date | null }> = await harness.dataSource.query(
        `SELECT revoked_at AS "revokedAt" FROM share_recipients WHERE id = $1`,
        [recipientId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
    });

    it('does not revoke a recipient through a different share id', async () => {
      const recipientRows: Array<{ id: string }> = await harness.dataSource.query(
        `SELECT id FROM share_recipients WHERE share_id = $1`,
        [seeded.permissionedShareId],
      );
      const recipientId = recipientRows[0]?.id ?? '';

      await request(httpServer(harness))
        .delete(
          url(endpoints.shares.revokeRecipient.path, {
            id: seeded.publicShareId,
            recipientId,
          }),
        )
        .set(await harness.authHeader(owner))
        .expect(404);

      const rows: Array<{ revokedAt: Date | null }> = await harness.dataSource.query(
        `SELECT revoked_at AS "revokedAt" FROM share_recipients WHERE id = $1`,
        [recipientId],
      );
      expect(rows[0]?.revokedAt).toBeNull();

      await request(httpServer(harness))
        .delete(
          url(endpoints.shares.revokeRecipient.path, {
            id: seeded.permissionedShareId,
            recipientId,
          }),
        )
        .set(await harness.authHeader(owner))
        .expect(204);
    });
  });

  describe('DELETE /shares/:id', () => {
    it('revokes without deleting, nulls its listed URL, and denies the next link request', async () => {
      await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.balanceId }))
        .set('X-Share-Token', seeded.publicToken)
        .expect(200);

      await request(httpServer(harness))
        .delete(url(endpoints.shares.revoke.path, { id: seeded.publicShareId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      const denied = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.balanceId }))
        .set('X-Share-Token', seeded.publicToken)
        .expect(403);
      expect(ApiError.parse(denied.body).code).toBe('ACCESS_REVOKED');

      const listed = await request(httpServer(harness))
        .get(url(endpoints.shares.listForNode.path, { id: seeded.financialsId }))
        .set(await harness.authHeader(owner))
        .expect(200);
      expect(ListSharesResponse.parse(listed.body).shares[0]).toMatchObject({
        id: seeded.publicShareId,
        url: null,
        revokedAt: expect.any(String),
      });

      const rows: Array<{ revokedAt: Date | null }> = await harness.dataSource.query(
        `SELECT revoked_at AS "revokedAt" FROM shares WHERE id = $1`,
        [seeded.publicShareId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
    });

    it('is owner-only and leaves the share live after denial', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.shares.revoke.path, { id: seeded.permissionedShareId }))
        .set(await harness.authHeader(viewer))
        .expect(403);

      const rows: Array<{ revokedAt: Date | null }> = await harness.dataSource.query(
        `SELECT revoked_at AS "revokedAt" FROM shares WHERE id = $1`,
        [seeded.permissionedShareId],
      );
      expect(rows[0]?.revokedAt).toBeNull();
    });
  });

  describe('GET /shared/:token', () => {
    it('reveals only the entry point, sends noindex, and throttles the eleventh request by IP', async () => {
      const endpoint = url(endpoints.shares.resolve.path, { token: seeded.publicToken });

      for (let requestNumber = 1; requestNumber <= 10; requestNumber += 1) {
        const response = await request(httpServer(harness)).get(endpoint).expect(200);
        const resolved = ResolveShareResponse.parse(response.body);

        expect(resolved).toEqual({
          shareId: seeded.publicShareId,
          nodeId: seeded.financialsId,
          nodeName: fixtures.nodes.financials.name,
          nodeType: 'folder',
          role: 'viewer',
          expiresAt: null,
          ownerName: fixtures.users.owner.name,
        });
        expect(response.headers['x-robots-tag']).toBe('noindex');
        expect(JSON.stringify(response.body)).not.toContain(fixtures.dataRoom.name);
        expect(JSON.stringify(response.body)).not.toContain(fixtures.nodes.legal.name);
        expect(JSON.stringify(response.body)).not.toContain(fixtures.nodes.overview.name);
        expect(response.body).not.toHaveProperty('path');
        expect(response.body).not.toHaveProperty('breadcrumbs');
        expect(response.body).not.toHaveProperty('fileCount');
        expect(response.body).not.toHaveProperty('sizeBytes');
      }

      const throttled = await request(httpServer(harness)).get(endpoint).expect(429);
      expect(ApiError.parse(throttled.body).code).toBe('RATE_LIMITED');
    });
  });

  describe('SPEC-05 share lifecycle acceptance', () => {
    it('auto-revokes every share rooted in a subtree when that subtree is deleted', async () => {
      const nestedShare = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
            .set(await harness.authHeader(owner))
            .send({ type: 'public_link' })
            .expect(201)
        ).body,
      );

      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, { id: seeded.financialsId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      const rows: Array<{ id: string; revokedAt: Date | null }> = await harness.dataSource.query(
        `SELECT id, revoked_at AS "revokedAt" FROM shares WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[seeded.publicShareId, nestedShare.id]],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every(({ revokedAt }) => revokedAt instanceof Date)).toBe(true);
    });

    it('keeps a share attached to its node after the owner moves that node', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, { id: seeded.financialsId }))
        .set(await harness.authHeader(owner))
        .send({ parentId: seeded.legalId })
        .expect(200);

      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.q3Id }))
        .set('X-Share-Token', seeded.publicToken)
        .expect(200);
      const detail = NodeDetailResponse.parse(response.body);
      expect(detail.shareRootId).toBe(seeded.financialsId);
      expect(detail.breadcrumbs.map(({ id }) => id)).toEqual([
        seeded.financialsId,
        seeded.q3Id,
      ]);
      expect(detail.breadcrumbs.map(({ id }) => id)).not.toContain(seeded.legalId);
    });

    it('keeps a second link on the same node granting after the first is revoked', async () => {
      const second = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(url(endpoints.shares.create.path, { id: seeded.financialsId }))
            .set(await harness.authHeader(owner))
            .send({
              type: 'public_link',
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            })
            .expect(201)
        ).body,
      );
      const secondToken = new URL(second.url ?? '').pathname.slice('/s/'.length);

      await request(httpServer(harness))
        .delete(url(endpoints.shares.revoke.path, { id: seeded.publicShareId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.balanceId }))
        .set('X-Share-Token', secondToken)
        .expect(200);
      const denied = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.balanceId }))
        .set('X-Share-Token', seeded.publicToken)
        .expect(403);
      expect(ApiError.parse(denied.body).code).toBe('ACCESS_REVOKED');
    });

    it('chooses the widest overlapping grant and reports the share root that granted it', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.rootNodeId }))
        .set(await harness.authHeader(owner))
        .send({ type: 'permissioned', recipients: [fixtures.users.viewer.email] })
        .expect(201);

      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.ndaId }))
        .set(await harness.authHeader(viewer))
        .expect(200);
      const detail = NodeDetailResponse.parse(response.body);
      expect(detail.access).toBe('viewer');
      expect(detail.shareRootId).toBe(seeded.rootNodeId);
      expect(detail.breadcrumbs.map(({ id }) => id)).toEqual([
        seeded.rootNodeId,
        seeded.legalId,
        seeded.ndaId,
      ]);
    });

    it('generates 1,000 unique 256-bit tokens with a balanced bit distribution', async () => {
      const shares = harness.app.get(SharesService);
      const baseExpiry = Date.now() + 7 * 86_400_000;
      const tokens: string[] = [];

      for (let offset = 0; offset < 1_000; offset += 25) {
        const batch = await Promise.all(
          Array.from({ length: 25 }, (_, batchIndex) =>
            shares.create(seeded.q3Id, seeded.ownerId, {
              type: 'public_link',
              recipients: [],
              expiresAt: new Date(baseExpiry + offset + batchIndex).toISOString(),
            }),
          ),
        );
        tokens.push(
          ...batch.map((share) => new URL(share.url ?? '').pathname.slice('/s/'.length)),
        );
      }

      expect(new Set(tokens).size).toBe(1_000);
      const bytes = tokens.map((token) => Buffer.from(token, 'base64url'));
      expect(bytes.every((tokenBytes) => tokenBytes.length === 32)).toBe(true);

      const oneBits = bytes.reduce(
        (total, tokenBytes) =>
          total +
          tokenBytes.reduce(
            (tokenTotal, byte) => tokenTotal + byte.toString(2).replaceAll('0', '').length,
            0,
          ),
        0,
      );
      const oneBitRatio = oneBits / (1_000 * 32 * 8);
      expect(oneBitRatio).toBeGreaterThan(0.45);
      expect(oneBitRatio).toBeLessThan(0.55);
    });

    it('grants an invited email after that person signs in for the first time', async () => {
      const inviteeEmail = 'first.login@example.com';
      const share = ShareDto.parse(
        (
          await request(httpServer(harness))
            .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
            .set(await harness.authHeader(owner))
            .send({ type: 'permissioned', recipients: [inviteeEmail] })
            .expect(201)
        ).body,
      );
      expect(share.recipients[0]).toMatchObject({
        email: inviteeEmail,
        userId: null,
        acceptedAt: null,
      });

      harness.googleProfile.current = {
        googleSub: 'first-login-google-sub',
        email: inviteeEmail,
        name: 'First Login',
        avatarUrl: null,
      };
      const start = await request(httpServer(harness))
        .get(url(endpoints.auth.googleStart.path, {}))
        .expect(200);
      const stateCookie = (start.headers['set-cookie'] as unknown as string[]).find((cookie) =>
        cookie.startsWith('oauth_state='),
      );
      expect(stateCookie).toBeDefined();
      const cookie = (stateCookie ?? '').split(';')[0] ?? '';
      const nonce = cookie.slice('oauth_state='.length);
      const state = Buffer.from(JSON.stringify({ returnTo: null, nonce })).toString('base64url');

      await request(httpServer(harness))
        .get(url(endpoints.auth.googleCallback.path, {}))
        .query({ state })
        .set('Cookie', cookie)
        .expect(302);

      const invitee = await harness.dataSource
        .getRepository(UserEntity)
        .findOneByOrFail({ googleSub: 'first-login-google-sub' });
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(invitee))
        .expect(200);
      expect(NodeDetailResponse.parse(response.body)).toMatchObject({
        access: 'viewer',
        shareRootId: seeded.q3Id,
      });

      const recipients: Array<{ userId: string | null; acceptedAt: Date | null }> =
        await harness.dataSource.query(
          `SELECT user_id AS "userId", accepted_at AS "acceptedAt"
             FROM share_recipients WHERE share_id = $1`,
          [share.id],
        );
      expect(recipients[0]).toMatchObject({
        userId: invitee.id,
        acceptedAt: expect.any(Date),
      });
    });
  });
});
