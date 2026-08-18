import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE, InitUploadResponse, endpoints, fixtures } from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { UploadsService } from '../../src/uploads/uploads.service';
import { ABANDONED_AFTER_HOURS, UploadsSweeper } from '../../src/uploads/uploads.sweeper';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

interface Reservation {
  nodeId: string;
  versionId: string;
  storageKey: string;
}

/**
 * The sweeper is what makes a closed browser tab a non-event: the reservation it left behind holds
 * a name in its folder and an object in the bucket, and nothing else will ever come back for it.
 *
 * Every test here drives the sweep method directly. The `@Cron` decorator is asserted once, as
 * *registration* — a sweep that runs correctly but is never scheduled is the same bug as one that
 * does not run at all — but no test waits on a clock.
 */
describe('pending-version sweeper', () => {
  let harness: TestHarness;
  let sweeper: UploadsSweeper;
  let seeded: SeededFixtures;
  let owner: { id: string; email: string };

  beforeAll(async () => {
    harness = await createTestHarness();
    sweeper = harness.app.get(UploadsSweeper);
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

  /** An upload that got as far as `init` and then stopped — a real reservation, made over HTTP. */
  const reserve = async (name: string, sizeBytes = 512): Promise<Reservation> => {
    const response = await request(httpServer(harness))
      .post(`${API_BASE}${endpoints.uploads.init.path}`)
      .set(await harness.authHeader(owner))
      .send({ parentId: seeded.legalId, name, sizeBytes, mimeType: 'application/pdf' })
      .expect(201);

    const body = InitUploadResponse.parse(response.body);
    const rows = (await harness.dataSource.query(
      `SELECT storage_key AS "storageKey" FROM file_versions WHERE id = $1`,
      [body.versionId],
    )) as Array<{ storageKey: string }>;

    return {
      nodeId: body.nodeId,
      versionId: body.versionId,
      storageKey: (rows[0] as { storageKey: string }).storageKey,
    };
  };

  const ageBy = (versionId: string, hours: number): Promise<unknown> =>
    harness.dataSource.query(
      `UPDATE file_versions SET created_at = now() - ($2 || ' hours')::interval WHERE id = $1`,
      [versionId, String(hours)],
    );

  const versionExists = async (versionId: string): Promise<boolean> => {
    const rows = (await harness.dataSource.query(`SELECT 1 FROM file_versions WHERE id = $1`, [
      versionId,
    ])) as unknown[];
    return rows.length === 1;
  };

  const nodeExists = async (nodeId: string): Promise<boolean> => {
    const rows = (await harness.dataSource.query(`SELECT 1 FROM nodes WHERE id = $1`, [
      nodeId,
    ])) as unknown[];
    return rows.length === 1;
  };

  it('removes a version abandoned longer ago than the cutoff, with its node and its object', async () => {
    const stale = await reserve('abandoned.pdf');
    harness.storage.putObject(stale.storageKey, 512);
    await ageBy(stale.versionId, ABANDONED_AFTER_HOURS + 1);

    const swept = await sweeper.sweep();

    expect(swept).toBe(1);
    expect(await versionExists(stale.versionId)).toBe(false);
    expect(await nodeExists(stale.nodeId)).toBe(false);
    expect(harness.storage.has(stale.storageKey)).toBe(false);
  });

  it('leaves an upload that is merely slow', async () => {
    // An hour old is a big file on a poor connection, not an abandoned tab. Sweeping it would
    // delete the node out from under a `complete` that is still coming.
    const inFlight = await reserve('slow.pdf');
    harness.storage.putObject(inFlight.storageKey, 512);
    await ageBy(inFlight.versionId, 1);

    expect(await sweeper.sweep()).toBe(0);
    expect(await versionExists(inFlight.versionId)).toBe(true);
    expect(await nodeExists(inFlight.nodeId)).toBe(true);
    expect(harness.storage.has(inFlight.storageKey)).toBe(true);
  });

  it('never touches a ready version, however old', async () => {
    // The seeded fixture files are `ready` and their rows are backdated well past the cutoff.
    await harness.dataSource.query(
      `UPDATE file_versions SET created_at = now() - interval '400 days' WHERE status = 'ready'`,
    );
    const before = (await harness.dataSource.query(
      `SELECT id FROM file_versions WHERE status = 'ready' ORDER BY id`,
    )) as Array<{ id: string }>;
    expect(before.length).toBeGreaterThan(0);

    // Asserted on what the sweep *selects*, not only on what it deletes. A sweeper that picks up
    // ready versions and then fails to delete them — the foreign key from `nodes.current_version_id`
    // sees to that — leaves the database identical and returns zero, so a test that only compared
    // rows before and after would pass while the query was wrong.
    expect(
      await harness.app.get(UploadsService).findAbandonedVersions(ABANDONED_AFTER_HOURS),
    ).toEqual([]);
    expect(await sweeper.sweep()).toBe(0);

    const after = (await harness.dataSource.query(
      `SELECT id FROM file_versions WHERE status = 'ready' ORDER BY id`,
    )) as Array<{ id: string }>;
    expect(after).toEqual(before);
    expect(await nodeExists(seeded.ndaId)).toBe(true);
  });

  it('keeps a node that already holds a real file when a later version is abandoned', async () => {
    // A second version of an existing file: the reservation is dead, the file underneath it is
    // not. Deleting the node here would destroy a document because a re-upload was cancelled.
    const versionId = randomUUID();
    const storageKey = `${seeded.roomId}/${seeded.ndaId}/${versionId}`;
    await harness.dataSource.query(
      `INSERT INTO file_versions
         (id, node_id, version, storage_key, size_bytes, mime_type, status, uploaded_by, created_at)
       VALUES ($1, $2, 2, $3, 1024, 'application/pdf', 'pending', $4, now() - interval '48 hours')`,
      [versionId, seeded.ndaId, storageKey, seeded.ownerId],
    );
    harness.storage.putObject(storageKey, 1024);

    expect(await sweeper.sweep()).toBe(1);

    expect(await versionExists(versionId)).toBe(false);
    expect(harness.storage.has(storageKey)).toBe(false);
    expect(await nodeExists(seeded.ndaId)).toBe(true);
    const [node] = (await harness.dataSource.query(
      `SELECT current_version_id AS "currentVersionId" FROM nodes WHERE id = $1`,
      [seeded.ndaId],
    )) as Array<{ currentVersionId: string | null }>;
    expect(node?.currentVersionId).not.toBeNull();
  });

  it('sweeps several reservations in one pass and reports the count', async () => {
    const stale = [await reserve('one.pdf'), await reserve('two.pdf'), await reserve('three.pdf')];
    const kept = await reserve('four.pdf');
    for (const reservation of stale) {
      harness.storage.putObject(reservation.storageKey, 512);
      await ageBy(reservation.versionId, ABANDONED_AFTER_HOURS + 2);
    }
    harness.storage.putObject(kept.storageKey, 512);

    expect(await sweeper.sweep()).toBe(3);

    for (const reservation of stale) {
      expect(await nodeExists(reservation.nodeId)).toBe(false);
    }
    expect(await nodeExists(kept.nodeId)).toBe(true);
    expect(harness.storage.keys).toEqual([kept.storageKey]);
  });

  it('is a no-op when nothing has been abandoned', async () => {
    expect(await sweeper.sweep()).toBe(0);
  });

  it('frees the name the abandoned reservation was holding', async () => {
    // The reason `abort` deletes rather than marks (CCP-7), and the reason the sweeper must do the
    // same: a cancelled upload that keeps its name silently renames the next honest one.
    const stale = await reserve('quarterly.pdf');
    await ageBy(stale.versionId, ABANDONED_AFTER_HOURS + 1);
    await sweeper.sweep();

    const again = await reserve('quarterly.pdf');

    const [row] = (await harness.dataSource.query(`SELECT name FROM nodes WHERE id = $1`, [
      again.nodeId,
    ])) as Array<{ name: string }>;
    expect(row?.name).toBe('quarterly.pdf');
  });

  it('is registered with the scheduler, so it actually runs in production', async () => {
    // Registration, not scheduling: nothing here waits on a clock. But a sweep method that is
    // correct and never called is the same outage as one that is broken.
    const jobs = harness.app.get(SchedulerRegistry).getCronJobs();
    expect([...jobs.keys()]).toContain(UploadsSweeper.JOB_NAME);
  });
});
