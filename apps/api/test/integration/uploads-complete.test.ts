import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ApiError,
  CompleteUploadResponse,
  InitUploadResponse,
  ListChildrenResponse,
  RetryUploadResponse,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { ancestorIds } from '../../src/nodes/path.util';
import { storageKeyFor } from '../../src/storage/storage.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const initPath = `${API_BASE}${endpoints.uploads.init.path}`;
const versionPath = (path: string, versionId: string): string =>
  `${API_BASE}${path.replace(':versionId', versionId)}`;
const childrenPath = (id: string): string =>
  `${API_BASE}${endpoints.nodes.children.path.replace(':id', id)}`;

interface Rollup {
  size: string;
  count: number;
}

/**
 * Exactly one row, or a failed assertion. Reaching into `rows[0]` and finding `undefined` would
 * otherwise make an empty result set read as a pass on every field that follows.
 */
const only = <T>(rows: T[], what: string): T => {
  expect(rows, what).toHaveLength(1);
  return rows[0] as T;
};

/**
 * `complete` and `retry` — the paths where the API decides whether the bytes it never saw are real.
 *
 * Two properties carry the whole module and are asserted repeatedly here: the recorded size is
 * **storage's**, never the client's declaration; and both endpoints are safe to call twice, because
 * a dropped response on a flaky connection is the ordinary case rather than the exceptional one.
 */
describe('uploads — complete and retry', () => {
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

  /** Reserve an upload the way the frontend does, and hand back everything the tests need. */
  const reserve = async (
    overrides: Record<string, unknown> = {},
  ): Promise<InitUploadResponse & { storageKey: string }> => {
    const response = await request(httpServer(harness))
      .post(initPath)
      .set(await harness.authHeader(owner))
      .send({
        parentId: seeded.q3Id,
        name: 'forecast.pdf',
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        ...overrides,
      })
      .expect(201);

    const body = InitUploadResponse.parse(response.body);
    return { ...body, storageKey: storageKeyFor(seeded.roomId, body.nodeId, body.versionId) };
  };

  const complete = async (versionId: string): Promise<request.Response> =>
    request(httpServer(harness))
      .post(versionPath(endpoints.uploads.complete.path, versionId))
      .set(await harness.authHeader(owner))
      .send();

  const retry = async (versionId: string): Promise<request.Response> =>
    request(httpServer(harness))
      .post(versionPath(endpoints.uploads.retry.path, versionId))
      .set(await harness.authHeader(owner))
      .send();

  const versionRow = async (
    versionId: string,
  ): Promise<{ status: string; size_bytes: string }> => {
    return only(
      (await harness.dataSource.query(
        `SELECT status, size_bytes FROM file_versions WHERE id = $1`,
        [versionId],
      )) as Array<{ status: string; size_bytes: string }>,
      `version ${versionId}`,
    );
  };

  const rollup = async (nodeId: string): Promise<Rollup> => {
    return only(
      (await harness.dataSource.query(
        `SELECT subtree_size_bytes AS "size", subtree_file_count AS "count"
           FROM nodes WHERE id = $1`,
        [nodeId],
      )) as Rollup[],
      `rollup of ${nodeId}`,
    );
  };

  /**
   * What a node's rollup *should* be, computed from its subtree. Asserting against this rather than
   * a hardcoded number means the test still means something after the fixture tree changes.
   */
  const recomputedRollup = async (nodeId: string): Promise<Rollup> => {
    return only(
      (await harness.dataSource.query(
        `SELECT COALESCE(SUM(d.size_bytes), 0)::text AS "size", COUNT(*)::int AS "count"
           FROM nodes n
           JOIN nodes d ON d.path LIKE n.path || '%' AND d.id <> n.id
          WHERE n.id = $1
            AND d.type = 'file'
            AND d.deleted_at IS NULL
            AND d.current_version_id IS NOT NULL`,
        [nodeId],
      )) as Rollup[],
      `recomputed rollup of ${nodeId}`,
    );
  };

  const childCount = async (parentId: string): Promise<number> => {
    const row = only(
      (await harness.dataSource.query(
        `SELECT COUNT(*)::int AS "n" FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL`,
        [parentId],
      )) as Array<{ n: number }>,
      `child count of ${parentId}`,
    );
    return row.n;
  };

  describe('POST /uploads/:versionId/complete', () => {
    it('refuses when no object was ever written, and leaves the version pending', async () => {
      const reserved = await reserve();

      const response = await complete(reserved.versionId);
      expect(response.status).toBe(409);
      expect(ApiError.parse(response.body).code).toBe('UPLOAD_INCOMPLETE');

      // Pending, not deleted: the sweeper owns the cleanup, so a client that succeeds on a retry
      // still has its reservation.
      expect((await versionRow(reserved.versionId)).status).toBe('pending');
    });

    it('refuses when storage disagrees with the declared size', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4095);

      const response = await complete(reserved.versionId);
      expect(response.status).toBe(409);
      expect(ApiError.parse(response.body).code).toBe('UPLOAD_INCOMPLETE');
      expect((await versionRow(reserved.versionId)).status).toBe('pending');
    });

    it('refuses when storage holds more than was declared', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      // The attack the exact-equality check exists for: declare 4 KB to clear the cap, store 50 MB.
      harness.storage.putObject(reserved.storageKey, 50 * 1024 * 1024);

      expect((await complete(reserved.versionId)).status).toBe(409);
      expect((await versionRow(reserved.versionId)).status).toBe('pending');
    });

    /**
     * SPEC-04 asks for "records storage's size even when it differs from the declared size". Under
     * the exact-equality check CCP-5 settled on, that case cannot occur: `complete` only ever
     * succeeds when the two numbers are identical, so no HTTP-level test can tell "recorded
     * storage's number" apart from "recorded the client's". Asserting `4096` here and calling it
     * proof would be a test that passes whichever source the service reads.
     *
     * The property that criterion was protecting — a caller declaring 1 MB and storing 500 MB —
     * is real and is covered by `refuses when storage holds more than was declared` above. What
     * remains observable here is that the recorded size is the size of the object that actually
     * exists, which is what the rest of the system reads.
     */
    it('records a size equal to the object storage actually holds', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4096);

      const response = await complete(reserved.versionId);
      expect(response.status).toBe(200);

      const stored = await harness.storage.stat(reserved.storageKey);
      const { node } = CompleteUploadResponse.parse(response.body);
      expect(node.sizeBytes).toBe(stored.sizeBytes);
      expect((await versionRow(reserved.versionId)).size_bytes).toBe(String(stored.sizeBytes));
    });

    it('makes the node visible and points it at the ready version', async () => {
      const reserved = await reserve();
      harness.storage.putObject(reserved.storageKey, 4096);

      const { node } = CompleteUploadResponse.parse((await complete(reserved.versionId)).body);
      expect(node.id).toBe(reserved.nodeId);
      expect(node.type).toBe('file');
      expect(node.mimeType).toBe('application/pdf');

      const listing = await request(httpServer(harness))
        .get(childrenPath(seeded.q3Id))
        .set(await harness.authHeader(owner))
        .expect(200);

      const items = ListChildrenResponse.parse(listing.body).items;
      expect(items.map((item) => item.id)).toContain(reserved.nodeId);
      expect((await versionRow(reserved.versionId)).status).toBe('ready');
    });

    it('updates every ancestor rollup to match a recomputation', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4096);
      await complete(reserved.versionId).then((response) => expect(response.status).toBe(200));

      const uploaded = only(
        (await harness.dataSource.query(`SELECT path FROM nodes WHERE id = $1`, [
          reserved.nodeId,
        ])) as Array<{ path: string }>,
        'the uploaded node',
      );

      const ancestors = ancestorIds(uploaded.path);
      expect(ancestors).toContain(seeded.q3Id);
      expect(ancestors).toContain(seeded.financialsId);
      expect(ancestors).toContain(seeded.rootNodeId);

      for (const ancestorId of ancestors) {
        expect(await rollup(ancestorId), `rollup of ${ancestorId}`).toEqual(
          await recomputedRollup(ancestorId),
        );
      }
    });

    it('leaves a sibling branch’s rollup alone', async () => {
      const before = await rollup(seeded.legalId);

      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4096);
      await complete(reserved.versionId);

      expect(await rollup(seeded.legalId)).toEqual(before);
    });

    it('is idempotent — a second call returns the same node and does not double the rollup', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4096);

      const first = CompleteUploadResponse.parse((await complete(reserved.versionId)).body);
      const afterFirst = await rollup(seeded.q3Id);

      const second = await complete(reserved.versionId);
      expect(second.status).toBe(200);
      const again = CompleteUploadResponse.parse(second.body);

      expect(again.node.id).toBe(first.node.id);
      expect(again.node.sizeBytes).toBe(first.node.sizeBytes);
      // A client whose first response was lost retries; counting the file twice into every ancestor
      // would be silent and permanent.
      expect(await rollup(seeded.q3Id)).toEqual(afterFirst);
      expect(await rollup(seeded.q3Id)).toEqual(await recomputedRollup(seeded.q3Id));
    });

    it('completes a zero-byte file', async () => {
      const reserved = await reserve({ name: 'empty.txt', sizeBytes: 0, mimeType: 'text/plain' });
      harness.storage.putObject(reserved.storageKey, 0);

      const response = await complete(reserved.versionId);
      expect(response.status).toBe(200);

      const { node } = CompleteUploadResponse.parse(response.body);
      expect(node.sizeBytes).toBe(0);
      // The file count still moves even though the byte count does not — an empty file is a file.
      expect(await rollup(seeded.q3Id)).toEqual(await recomputedRollup(seeded.q3Id));
    });

    it('refuses a zero-byte declaration when no object was written at all', async () => {
      const reserved = await reserve({ name: 'empty.txt', sizeBytes: 0, mimeType: 'text/plain' });
      // The one case where "does the object exist?" is the only defence. For any non-zero
      // declaration the size check catches a missing object anyway, because `stat` reports 0 — so
      // without this test the existence branch could be deleted and the suite would stay green.
      const response = await complete(reserved.versionId);

      expect(response.status).toBe(409);
      expect(ApiError.parse(response.body).code).toBe('UPLOAD_INCOMPLETE');
      expect((await versionRow(reserved.versionId)).status).toBe('pending');
    });

    it('applies the rollup once when several completes land together', async () => {
      const reserved = await reserve({ sizeBytes: 4096 });
      harness.storage.putObject(reserved.storageKey, 4096);

      // Every one of these reads `pending` before any of them writes. The `status = 'ready'` check
      // at the top of `complete` cannot separate them, because `stat()` is a network round trip in
      // between — so the promotion has to be what serialises, not the read.
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => complete(reserved.versionId)),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);

      expect(await rollup(seeded.q3Id)).toEqual(await recomputedRollup(seeded.q3Id));
      expect(await rollup(seeded.financialsId)).toEqual(
        await recomputedRollup(seeded.financialsId),
      );
      expect(await rollup(seeded.rootNodeId)).toEqual(await recomputedRollup(seeded.rootNodeId));
    });

    it('404s on a version that never existed', async () => {
      const response = await complete('00000000-0000-4000-8000-0000000009ff');
      expect(response.status).toBe(404);
    });
  });

  /**
   * The controller claims an upload cannot be completed or retried by anyone but the owner of the
   * folder it was reserved in. That claim rests on `@Resource('version', 'versionId')` resolving a
   * version back to its node — one decorator away from being wrong, and nothing else in the suite
   * covers the `version` resource kind.
   */
  describe('who may finish an upload', () => {
    const as = async (
      path: string,
      versionId: string,
      user: { id: string; email: string },
    ): Promise<request.Response> =>
      request(httpServer(harness))
        .post(versionPath(path, versionId))
        .set(await harness.authHeader(user))
        .send();

    it('denies a viewer completing an upload inside a folder shared with them', async () => {
      const reserved = await reserve();
      harness.storage.putObject(reserved.storageKey, 4096);
      const viewer = { id: seeded.viewerId, email: fixtures.users.viewer.email };

      // Q3 is inside the folder the fixture share grants, so the viewer can *read* this node. The
      // denial has to come from the role, not from not finding it.
      const response = await as(endpoints.uploads.complete.path, reserved.versionId, viewer);
      expect(response.status).toBe(403);
      expect(ApiError.parse(response.body).code).toBe('FORBIDDEN');
      expect((await versionRow(reserved.versionId)).status).toBe('pending');
    });

    it('denies a viewer retrying an upload', async () => {
      const reserved = await reserve();
      const viewer = { id: seeded.viewerId, email: fixtures.users.viewer.email };

      const response = await as(endpoints.uploads.retry.path, reserved.versionId, viewer);
      expect(response.status).toBe(403);
      // Above all: no URL was minted for them. Only `init`'s own is on the record.
      expect(harness.storage.minted.filter((entry) => entry.kind === 'upload')).toHaveLength(1);
    });

    it('tells a stranger no more about a version than about the node it belongs to', async () => {
      const reserved = await reserve();
      harness.storage.putObject(reserved.storageKey, 4096);
      const stranger = { id: seeded.strangerId, email: fixtures.users.stranger.email };

      // The baseline: what this stranger already gets for the node itself. Whatever the permission
      // matrix decides that should be, the version routes must not be more revealing — resolving a
      // version to its node is the whole mechanism, so a divergence here means it was bypassed.
      const onNode = await request(httpServer(harness))
        .get(`${API_BASE}${endpoints.nodes.get.path.replace(':id', reserved.nodeId)}`)
        .set(await harness.authHeader(stranger));
      expect(onNode.status).not.toBe(200);

      for (const path of [endpoints.uploads.complete.path, endpoints.uploads.retry.path]) {
        const response = await as(path, reserved.versionId, stranger);
        expect(response.status, path).toBe(onNode.status);
        expect(ApiError.parse(response.body).code, path).toBe(ApiError.parse(onNode.body).code);
      }

      expect((await versionRow(reserved.versionId)).status).toBe('pending');
      expect(harness.storage.minted.filter((entry) => entry.kind === 'upload')).toHaveLength(1);
    });

    it('refuses an unauthenticated caller', async () => {
      const reserved = await reserve();

      const response = await request(httpServer(harness))
        .post(versionPath(endpoints.uploads.complete.path, reserved.versionId))
        .send();
      expect(response.status).toBe(401);
    });
  });

  describe('POST /uploads/:versionId/retry', () => {
    it('returns a fresh URL for the same reserved node and version', async () => {
      const reserved = await reserve();
      const firstUrl = reserved.uploadUrl;

      const response = await retry(reserved.versionId);
      expect(response.status).toBe(200);

      const body = RetryUploadResponse.parse(response.body);
      expect(body.uploadUrl).not.toBe(firstUrl);

      const minted = harness.storage.lastMinted('upload');
      expect(minted?.key).toBe(reserved.storageKey);
      expect(minted?.ttlSeconds).toBe(3600);
    });

    it('creates no second node — which is the entire reason it exists', async () => {
      const before = await childCount(seeded.q3Id);
      const reserved = await reserve();
      const afterInit = await childCount(seeded.q3Id);
      expect(afterInit).toBe(before + 1);

      await retry(reserved.versionId);
      await retry(reserved.versionId);
      await retry(reserved.versionId);

      // Three retries on a flaky connection. Re-running `init` instead would have left
      // `forecast (2).pdf`, `forecast (3).pdf`, `forecast (4).pdf` behind.
      expect(await childCount(seeded.q3Id)).toBe(afterInit);
      const pending = only(
        (await harness.dataSource.query(`SELECT id FROM file_versions WHERE node_id = $1`, [
          reserved.nodeId,
        ])) as Array<{ id: string }>,
        'one version for the reserved node',
      );
      expect(pending.id).toBe(reserved.versionId);
    });

    it('completes normally after a retry', async () => {
      const reserved = await reserve({ sizeBytes: 1024 });
      await retry(reserved.versionId);
      // The retried URL addresses the same key, so the bytes land where `complete` will look.
      harness.storage.putObject(reserved.storageKey, 1024);

      const response = await complete(reserved.versionId);
      expect(response.status).toBe(200);
      expect(CompleteUploadResponse.parse(response.body).node.id).toBe(reserved.nodeId);
    });

    it('refuses to retry an upload that already finished', async () => {
      const reserved = await reserve({ sizeBytes: 1024 });
      harness.storage.putObject(reserved.storageKey, 1024);
      await complete(reserved.versionId);

      const response = await retry(reserved.versionId);
      expect(response.status).toBe(404);
    });

    it('404s on a version that never existed', async () => {
      const response = await retry('00000000-0000-4000-8000-0000000009ff');
      expect(response.status).toBe(404);
    });
  });
});
