import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ApiError,
  InitUploadResponse,
  ListChildrenResponse,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { storageKeyFor } from '../../src/storage/storage.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const initPath = `${API_BASE}${endpoints.uploads.init.path}`;
const versionPath = (path: string, versionId: string): string =>
  `${API_BASE}${path.replace(':versionId', versionId)}`;
const childrenPath = (id: string): string =>
  `${API_BASE}${endpoints.nodes.children.path.replace(':id', id)}`;

interface VersionRow {
  id: string;
  node_id: string;
  storage_key: string;
  size_bytes: string;
  mime_type: string;
  status: 'pending' | 'ready';
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
 * `init` and `abort` — the two ends of an upload that never delivered any bytes.
 *
 * The through-line of every test here is that validation happens *before* a URL is minted. A 413
 * returned after the signed URL was already handed out is not a rejection, it is a rejection
 * message attached to a working upload permit, so each failure case asserts against the fake
 * store's mint record as well as against the status code.
 */
describe('uploads — init and abort', () => {
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
    harness.storage.reset();
    owner = { id: seeded.ownerId, email: fixtures.users.owner.email };
    viewer = { id: seeded.viewerId, email: fixtures.users.viewer.email };
  });

  const init = async (
    body: Record<string, unknown>,
    as: { id: string; email: string } = owner,
  ): Promise<request.Response> =>
    request(httpServer(harness))
      .post(initPath)
      .set(await harness.authHeader(as))
      .send(body);

  const pdf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    parentId: seeded.legalId,
    name: 'diligence.pdf',
    sizeBytes: 2048,
    mimeType: 'application/pdf',
    ...overrides,
  });

  /**
   * Only the pending rows. The seeded fixture tree carries three `ready` versions of its own, so an
   * assertion that "nothing was created" has to be about reservations, not about the whole table.
   */
  const pendingVersions = (): Promise<VersionRow[]> =>
    harness.dataSource.query(
      `SELECT * FROM file_versions WHERE status = 'pending' ORDER BY created_at`,
    ) as Promise<VersionRow[]>;

  const childNames = async (parentId: string): Promise<string[]> => {
    const rows = (await harness.dataSource.query(
      `SELECT name FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [parentId],
    )) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  };

  describe('POST /uploads/init', () => {
    it('reserves a node and a pending version, then mints the URL', async () => {
      const response = await init(pdf());
      expect(response.status).toBe(201);

      const body = InitUploadResponse.parse(response.body);
      expect(body.finalName).toBe('diligence.pdf');

      const version = only(await pendingVersions(), 'one reserved version');
      expect(version.id).toBe(body.versionId);
      expect(version.node_id).toBe(body.nodeId);
      expect(version.status).toBe('pending');
      expect(version.storage_key).toBe(
        storageKeyFor(seeded.roomId, body.nodeId, body.versionId),
      );
    });

    it('rejects a file over the cap with 413, before anything is created', async () => {
      const before = await pendingVersions();

      const response = await init(pdf({ sizeBytes: harness.config.maxUploadBytes + 1 }));
      expect(response.status).toBe(413);
      expect(ApiError.parse(response.body).code).toBe('FILE_TOO_LARGE');

      // The whole point of checking the cap first: no reservation, and above all no upload permit.
      expect(await pendingVersions()).toEqual(before);
      expect(await childNames(seeded.legalId)).toEqual(['NDA.pdf']);
      expect(harness.storage.minted).toEqual([]);
    });

    it('accepts a file exactly at the cap', async () => {
      const response = await init(pdf({ sizeBytes: harness.config.maxUploadBytes }));
      expect(response.status).toBe(201);
    });

    it('rejects a disallowed mime with 415, before anything is created', async () => {
      const response = await init(pdf({ name: 'archive.zip', mimeType: 'application/zip' }));

      // 415, not the 400 the contract's mime enum would produce at the boundary: "we do not accept
      // .zip" is a different thing to tell a user than "your request was malformed".
      expect(response.status).toBe(415);
      expect(ApiError.parse(response.body).code).toBe('UNSUPPORTED_TYPE');

      expect(await pendingVersions()).toEqual([]);
      expect(await childNames(seeded.legalId)).toEqual(['NDA.pdf']);
      expect(harness.storage.minted).toEqual([]);
    });

    it('suffixes a name a live sibling already holds, and reserves the node under it', async () => {
      const response = await init(pdf({ name: 'NDA.pdf' }));
      expect(response.status).toBe(201);

      const body = InitUploadResponse.parse(response.body);
      expect(body.finalName).toBe('NDA (2).pdf');

      const row = only(
        (await harness.dataSource.query(`SELECT name FROM nodes WHERE id = $1`, [
          body.nodeId,
        ])) as Array<{ name: string }>,
        'the reserved node',
      );
      // The reserved row carries the name that was actually taken, not the one that was asked for —
      // otherwise the client shows `NDA (2).pdf` and the folder shows a duplicate.
      expect(row.name).toBe('NDA (2).pdf');
    });

    it('mints the write URL with a one-hour TTL, against the reserved version key', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);

      const minted = only(harness.storage.minted, 'one minted URL');
      expect(minted.kind).toBe('upload');
      expect(minted.ttlSeconds).toBe(3600);
      expect(minted.key).toBe(storageKeyFor(seeded.roomId, body.nodeId, body.versionId));

      const secondsAway = (Date.parse(body.uploadExpiresAt) - Date.now()) / 1000;
      expect(secondsAway).toBeGreaterThan(3400);
      expect(secondsAway).toBeLessThanOrEqual(3600);
    });

    it('accepts a zero-byte file', async () => {
      const response = await init(pdf({ name: 'empty.txt', sizeBytes: 0, mimeType: 'text/plain' }));
      expect(response.status).toBe(201);
      expect(InitUploadResponse.parse(response.body).finalName).toBe('empty.txt');
    });

    it('rejects an upload aimed at a file rather than a folder', async () => {
      const response = await init(pdf({ parentId: seeded.ndaId }));
      expect(response.status).toBe(400);
      expect(ApiError.parse(response.body).code).toBe('INVALID_MOVE_TARGET');
      expect(harness.storage.minted).toEqual([]);
    });

    it('denies a viewer, who is a read-only recipient by definition', async () => {
      const response = await init(pdf({ parentId: seeded.financialsId }), viewer);
      expect(response.status).toBe(403);
      expect(await pendingVersions()).toEqual([]);
      expect(harness.storage.minted).toEqual([]);
    });

    it('rejects a malformed body without reaching storage', async () => {
      const response = await init({ parentId: seeded.legalId, name: 'x.pdf', sizeBytes: -1 });
      expect(response.status).toBe(400);
      expect(harness.storage.minted).toEqual([]);
    });
  });

  describe('visibility of a reserved node', () => {
    it('never lists a node whose current_version_id is NULL', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);

      const response = await request(httpServer(harness))
        .get(childrenPath(seeded.legalId))
        .set(await harness.authHeader(owner))
        .expect(200);

      const listed = ListChildrenResponse.parse(response.body);
      expect(listed.items.map((item) => item.id)).not.toContain(body.nodeId);
      expect(listed.items.map((item) => item.name)).toEqual(['NDA.pdf']);

      // It is genuinely in the table — the filter is what hides it, not a missing row.
      const reserved = only(
        (await harness.dataSource.query(`SELECT current_version_id FROM nodes WHERE id = $1`, [
          body.nodeId,
        ])) as Array<{ current_version_id: string | null }>,
        'the reserved node',
      );
      expect(reserved.current_version_id).toBeNull();
    });

    it('keeps the parent rollup untouched until the upload completes', async () => {
      const before = (await harness.dataSource.query(
        `SELECT subtree_size_bytes AS "size", subtree_file_count AS "count" FROM nodes WHERE id = $1`,
        [seeded.legalId],
      )) as Array<{ size: string; count: number }>;

      await init(pdf({ sizeBytes: 4096 }));

      const after = (await harness.dataSource.query(
        `SELECT subtree_size_bytes AS "size", subtree_file_count AS "count" FROM nodes WHERE id = $1`,
        [seeded.legalId],
      )) as Array<{ size: string; count: number }>;
      expect(after).toEqual(before);
    });
  });

  describe('concurrent init for the same name', () => {
    it('gives each caller a distinct suffixed name', async () => {
      const [first, second] = await Promise.all([
        init(pdf({ name: 'race.pdf' })),
        init(pdf({ name: 'race.pdf' })),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const names = [
        InitUploadResponse.parse(first.body).finalName,
        InitUploadResponse.parse(second.body).finalName,
      ].sort();
      // Both computed `race.pdf` from the same sibling snapshot; the unique index decided which one
      // kept it, and the loser retried knowing the winner's name. A check-then-insert would have
      // handed both the same name and lost one upload.
      expect(names).toEqual(['race (2).pdf', 'race.pdf']);
      expect(new Set(names).size).toBe(2);

      expect(await childNames(seeded.legalId)).toEqual(['NDA.pdf', 'race (2).pdf', 'race.pdf']);
    });

    it('survives a whole multi-file drop landing on one name', async () => {
      // Eight, because the retry bound used to be five and four callers passed. The case SPEC-04
      // is actually about is a drag-and-drop of many identically named files, so the bound has to
      // clear the burst rather than sit just above the test.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => init(pdf({ name: 'burst.pdf' }))),
      );

      expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201));
      const names = responses.map((response) => InitUploadResponse.parse(response.body).finalName);
      expect(new Set(names).size).toBe(8);
      expect(await childNames(seeded.legalId)).toHaveLength(9);
    });
  });

  describe('POST /uploads/:versionId/abort', () => {
    const abort = async (
      versionId: string,
      as: { id: string; email: string } = owner,
    ): Promise<request.Response> =>
      request(httpServer(harness))
        .post(versionPath(endpoints.uploads.abort.path, versionId))
        .set(await harness.authHeader(as))
        .send();

    it('drops the reservation and deletes the object best-effort', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);
      const key = storageKeyFor(seeded.roomId, body.nodeId, body.versionId);
      // The user got far enough to push some bytes before cancelling.
      harness.storage.putObject(key, 2048);

      expect((await abort(body.versionId)).status).toBe(204);

      expect(await pendingVersions()).toEqual([]);
      // The placeholder must go too, or the folder carries an invisible reservation forever.
      expect(await childNames(seeded.legalId)).toEqual(['NDA.pdf']);
      expect(harness.storage.has(key)).toBe(false);
    });

    it('succeeds when no bytes were ever written', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);

      expect((await abort(body.versionId)).status).toBe(204);
      expect(await pendingVersions()).toEqual([]);
    });

    it('leaves a real file alone — a second abort is a 404, not a delete', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);
      expect((await abort(body.versionId)).status).toBe(204);

      const second = await abort(body.versionId);
      expect(second.status).toBe(404);
    });

    it('denies a viewer aborting the owner’s upload', async () => {
      const body = InitUploadResponse.parse((await init(pdf())).body);

      const response = await abort(body.versionId, viewer);
      // The viewer's share does not reach `Legal` at all, so this is a 404 rather than a 403 —
      // they are not told the upload exists.
      expect([403, 404]).toContain(response.status);
      expect(await pendingVersions()).toHaveLength(1);
    });

    it('404s on a version that never existed', async () => {
      const response = await abort('00000000-0000-4000-8000-0000000009ff');
      expect(response.status).toBe(404);
    });
  });
});
