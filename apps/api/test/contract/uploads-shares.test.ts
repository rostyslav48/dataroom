import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  AddRecipientsBody,
  CompleteUploadResponse,
  InitUploadResponse,
  ListSharesResponse,
  ResolveShareResponse,
  RetryUploadResponse,
  ShareDto,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import type { ZodType } from 'zod';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { storageKeyFor } from '../../src/storage/storage.service';
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

describe('contract — uploads and shares', () => {
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
    harness.storage.reset();
    owner = { id: seeded.ownerId, email: fixtures.users.owner.email };
  });

  const reserve = async (): Promise<InitUploadResponse & { storageKey: string }> => {
    const response = await request(httpServer(harness))
      .post(url(endpoints.uploads.init.path))
      .set(await harness.authHeader(owner))
      .send({
        parentId: seeded.q3Id,
        name: 'contract-upload.pdf',
        sizeBytes: 2048,
        mimeType: 'application/pdf',
      })
      .expect(201);
    const body = parseStrict(InitUploadResponse, response.body);
    return {
      ...body,
      storageKey: storageKeyFor(seeded.roomId, body.nodeId, body.versionId),
    };
  };

  describe('upload endpoints', () => {
    it('init returns a strict InitUploadResponse', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.uploads.init.path))
        .set(await harness.authHeader(owner))
        .send({
          parentId: seeded.q3Id,
          name: 'contract-init.pdf',
          sizeBytes: 1024,
          mimeType: 'application/pdf',
        })
        .expect(201);

      parseStrict(InitUploadResponse, response.body);
    });

    it('complete returns a strict CompleteUploadResponse', async () => {
      const reserved = await reserve();
      harness.storage.putObject(reserved.storageKey, 2048);

      const response = await request(httpServer(harness))
        .post(url(endpoints.uploads.complete.path, { versionId: reserved.versionId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(CompleteUploadResponse, response.body);
    });

    it('retry returns a strict RetryUploadResponse', async () => {
      const reserved = await reserve();

      const response = await request(httpServer(harness))
        .post(url(endpoints.uploads.retry.path, { versionId: reserved.versionId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(RetryUploadResponse, response.body);
    });

    it('abort returns the documented empty response', async () => {
      const reserved = await reserve();

      const response = await request(httpServer(harness))
        .post(url(endpoints.uploads.abort.path, { versionId: reserved.versionId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      expect(response.text).toBe('');
    });
  });

  describe('share endpoints', () => {
    it('listForNode returns a strict ListSharesResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.shares.listForNode.path, { id: seeded.financialsId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(ListSharesResponse, response.body);
    });

    it('create returns a strict ShareDto', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.create.path, { id: seeded.q3Id }))
        .set(await harness.authHeader(owner))
        .send({ type: 'public_link', recipients: [], expiresAt: null })
        .expect(201);

      parseStrict(ShareDto, response.body);
    });

    it('listForRoom returns a strict ListSharesResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.shares.listForRoom.path, { id: seeded.roomId }))
        .set(await harness.authHeader(owner))
        .expect(200);

      parseStrict(ListSharesResponse, response.body);
    });

    it('addRecipients returns a strict ShareDto', async () => {
      const body = AddRecipientsBody.parse({ emails: ['new-recipient@example.com'] });
      const response = await request(httpServer(harness))
        .post(url(endpoints.shares.addRecipients.path, { id: seeded.permissionedShareId }))
        .set(await harness.authHeader(owner))
        .send(body)
        .expect(200);

      parseStrict(ShareDto, response.body);
    });

    it('revokeRecipient returns the documented empty response', async () => {
      const rows = (await harness.dataSource.query(
        `SELECT id FROM share_recipients WHERE share_id = $1`,
        [seeded.permissionedShareId],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(1);

      const response = await request(httpServer(harness))
        .delete(
          url(endpoints.shares.revokeRecipient.path, {
            id: seeded.permissionedShareId,
            recipientId: (rows[0] as { id: string }).id,
          }),
        )
        .set(await harness.authHeader(owner))
        .expect(204);

      expect(response.text).toBe('');
    });

    it('revoke returns the documented empty response', async () => {
      const response = await request(httpServer(harness))
        .delete(url(endpoints.shares.revoke.path, { id: seeded.publicShareId }))
        .set(await harness.authHeader(owner))
        .expect(204);

      expect(response.text).toBe('');
    });

    it('resolve returns a strict ResolveShareResponse', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.shares.resolve.path, { token: seeded.publicToken }))
        .expect(200);

      parseStrict(ResolveShareResponse, response.body);
    });
  });
});
