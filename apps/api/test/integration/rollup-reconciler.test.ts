import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, InitUploadResponse, endpoints, fixtures } from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { RollupReconciler } from '../../src/nodes/rollup-reconciler';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

describe('nightly rollup reconciliation', () => {
  let harness: TestHarness;
  let reconciler: RollupReconciler;
  let seeded: SeededFixtures;
  let owner: { id: string; email: string };

  beforeAll(async () => {
    harness = await createTestHarness();
    reconciler = harness.app.get(RollupReconciler);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.dataSource);
    seeded = await seedFixtures(harness.dataSource);
    owner = { id: seeded.ownerId, email: fixtures.users.owner.email };
    vi.restoreAllMocks();
  });

  it('reports no drift for the canonical fixture tree', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await reconciler.reconcile()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('detects and logs an injected rollup drift without erasing the evidence', async () => {
    await harness.dataSource.query(
      `UPDATE nodes
          SET subtree_size_bytes = subtree_size_bytes + 17,
              subtree_file_count = subtree_file_count + 1
        WHERE id = $1`,
      [seeded.rootNodeId],
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await reconciler.reconcile()).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        driftCount: 1,
        nodes: [expect.objectContaining({ id: seeded.rootNodeId })],
      }),
      'folder rollups differ from the authoritative subtree aggregate',
    );

    const rows = (await harness.dataSource.query(
      `SELECT subtree_size_bytes::text AS size FROM nodes WHERE id = $1`,
      [seeded.rootNodeId],
    )) as Array<{ size: string }>;
    expect(rows[0]?.size).toBe(String((fixtures.nodes.root.subtreeSizeBytes ?? 0) + 17));
  });

  it('reports each drifted folder exactly once', async () => {
    await harness.dataSource.query(
      `UPDATE nodes SET subtree_file_count = subtree_file_count + 1 WHERE id = ANY($1::uuid[])`,
      [[seeded.rootNodeId, seeded.legalId]],
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await reconciler.reconcile()).toBe(2);
  });

  it('does not count a pending upload that is intentionally invisible', async () => {
    await request(httpServer(harness))
      .post(`${API_BASE}${endpoints.uploads.init.path}`)
      .set(await harness.authHeader(owner))
      .send({
        parentId: seeded.legalId,
        name: 'still-uploading.pdf',
        sizeBytes: 512,
        mimeType: 'application/pdf',
      })
      .expect(201)
      .expect((response) => InitUploadResponse.parse(response.body));

    expect(await reconciler.reconcile()).toBe(0);
  });

  it('is registered with the nightly scheduler', () => {
    const jobs = harness.app.get(SchedulerRegistry).getCronJobs();
    expect([...jobs.keys()]).toContain(RollupReconciler.JOB_NAME);
  });
});
