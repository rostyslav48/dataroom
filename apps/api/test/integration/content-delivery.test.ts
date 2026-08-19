import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE, ApiError, SHARE_TOKEN_HEADER, endpoints, fixtures } from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { READ_URL_TTL_SECONDS } from '../../src/storage/storage.service';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const contentPath = (id: string): string =>
  `${API_BASE}${endpoints.nodes.content.path.replace(':id', id)}`;
const downloadPath = (id: string): string =>
  `${API_BASE}${endpoints.nodes.download.path.replace(':id', id)}`;

/**
 * Content delivery: two redirects, and the security property that makes them safe.
 *
 * Every denial case here asserts on `harness.storage.minted` as well as on the status code. A 403
 * returned *after* a URL was minted is not a denial — the URL is already valid for sixty seconds
 * and nothing about the response body takes it back. The order of operations is the whole feature,
 * so it is what the tests are about.
 */
describe('content delivery — /content and /download', () => {
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
    harness.storage.reset();
    owner = { id: seeded.ownerId, email: fixtures.users.owner.email };
    viewer = { id: seeded.viewerId, email: fixtures.users.viewer.email };
    stranger = { id: seeded.strangerId, email: fixtures.users.stranger.email };
  });

  /** The key the seeded `ready` version actually points at, read back rather than reconstructed. */
  const storageKeyOf = async (nodeId: string): Promise<string> => {
    const rows = (await harness.dataSource.query(
      `SELECT v.storage_key AS "storageKey"
         FROM nodes n JOIN file_versions v ON v.id = n.current_version_id
        WHERE n.id = $1`,
      [nodeId],
    )) as Array<{ storageKey: string }>;
    expect(rows, 'the node has a current version').toHaveLength(1);
    return (rows[0] as { storageKey: string }).storageKey;
  };

  const asOwner = async (url: string): Promise<request.Response> =>
    request(httpServer(harness)).get(url).set(await harness.authHeader(owner));

  describe('GET /nodes/:id/content', () => {
    it('302s to a 60-second inline URL for the node’s current version', async () => {
      const response = await asOwner(contentPath(seeded.ndaId));

      expect(response.status).toBe(302);
      const minted = harness.storage.minted;
      expect(minted).toHaveLength(1);
      expect(minted[0]).toEqual({
        key: await storageKeyOf(seeded.ndaId),
        kind: 'download',
        ttlSeconds: READ_URL_TTL_SECONDS,
        disposition: 'inline',
        filename: 'NDA.pdf',
      });
      expect(minted[0]?.ttlSeconds).toBe(60);
      expect(response.headers.location).toContain('https://storage.test/object/');
    });

    it('downgrades a non-previewable type to attachment, whatever the caller asked for', async () => {
      // The containment layer for a spoofed upload. `complete` already refuses to promote a
      // version whose stored bytes are not the declared type, so this is the second of two
      // independent failures that would both have to happen before arbitrary markup could be
      // rendered in a browsing context on the storage origin.
      //
      // `inline` is granted only to PREVIEWABLE_MIME_TYPES — today, PDF alone. Everything else is
      // served as a download even when the viewer route asks to embed it.
      await harness.dataSource.query(`UPDATE file_versions SET mime_type = 'text/html' WHERE id = (
        SELECT current_version_id FROM nodes WHERE id = $1)`, [seeded.ndaId]);

      const response = await asOwner(contentPath(seeded.ndaId));

      expect(response.status).toBe(302);
      expect(harness.storage.lastMinted('download')?.disposition).toBe('attachment');
    });

    it('never lets a signed URL be cached by an intermediary', async () => {
      // The Location header *is* the credential for the next sixty seconds. A shared cache holding
      // this 302 would hand one user's URL to the next.
      const response = await asOwner(contentPath(seeded.ndaId));
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('serves a share recipient, because reads are one code path for owner and viewer', async () => {
      // `NDA.pdf` sits under `Legal`, which is the permissioned share's root.
      const response = await request(httpServer(harness))
        .get(contentPath(seeded.ndaId))
        .set(await harness.authHeader(viewer));

      expect(response.status).toBe(302);
      expect(harness.storage.lastMinted('download')?.disposition).toBe('inline');
    });

    it('serves an anonymous caller holding a live public link', async () => {
      // `balance-sheet.pdf` sits under `Financials`, the public link's root.
      const response = await request(httpServer(harness))
        .get(contentPath(seeded.balanceId))
        .set(SHARE_TOKEN_HEADER, seeded.publicToken);

      expect(response.status).toBe(302);
      expect(harness.storage.minted).toHaveLength(1);
    });
  });

  describe('GET /nodes/:id/download', () => {
    it('302s to a 60-second attachment URL carrying the node’s name', async () => {
      const response = await asOwner(downloadPath(seeded.ndaId));

      expect(response.status).toBe(302);
      expect(harness.storage.minted).toEqual([
        {
          key: await storageKeyOf(seeded.ndaId),
          kind: 'download',
          ttlSeconds: 60,
          disposition: 'attachment',
          filename: 'NDA.pdf',
        },
      ]);
      expect(response.headers.location).toContain('download=NDA.pdf');
    });

    it('sanitises the filename, so a node name can never inject a header', async () => {
      // `ResourceName` forbids only `/` and `\`, so a quote or a CRLF is a perfectly legal node
      // name — and it reaches `Content-Disposition` at the far end of a redirect the API does not
      // write itself. Sanitising in the service rather than in one storage implementation is what
      // makes this true for every implementation of the interface.
      const hostile = 'quarterly"report\r\nX-Injected: yes.pdf';
      await request(httpServer(harness))
        .patch(`${API_BASE}${endpoints.nodes.rename.path.replace(':id', seeded.ndaId)}`)
        .set(await harness.authHeader(owner))
        .send({ name: hostile })
        .expect(200);

      const response = await asOwner(downloadPath(seeded.ndaId));

      expect(response.status).toBe(302);
      const filename = harness.storage.lastMinted('download')?.filename ?? '';
      expect(filename).toBe('quarterlyreportX-Injected: yes.pdf');
      expect(filename).not.toMatch(/["\\\r\n]/);
      expect(response.headers.location).not.toMatch(/[\r\n]/);
    });
  });

  describe('access is decided before anything is minted', () => {
    it('mints nothing for a stranger', async () => {
      const response = await request(httpServer(harness))
        .get(contentPath(seeded.overviewId))
        .set(await harness.authHeader(stranger));

      expect(response.status).toBe(403);
      expect(ApiError.parse(response.body).code).toBe('FORBIDDEN');
      expect(harness.storage.minted).toEqual([]);
    });

    it('mints nothing for a viewer reading outside their share root', async () => {
      // `overview.pdf` hangs off the room root, outside both seeded shares.
      const response = await request(httpServer(harness))
        .get(downloadPath(seeded.overviewId))
        .set(await harness.authHeader(viewer));

      expect(response.status).toBe(403);
      expect(harness.storage.minted).toEqual([]);
    });

    it('mints nothing for a caller holding the wrong Google profile', async () => {
      // `NDA.pdf` is under a live invitation addressed to somebody else, which is its own screen.
      const response = await request(httpServer(harness))
        .get(contentPath(seeded.ndaId))
        .set(await harness.authHeader(stranger));

      expect(ApiError.parse(response.body).code).toBe('WRONG_ACCOUNT');
      expect(harness.storage.minted).toEqual([]);
    });

    it('mints nothing for an anonymous caller with no token', async () => {
      const response = await request(httpServer(harness)).get(contentPath(seeded.ndaId));

      expect(response.status).toBe(401);
      expect(harness.storage.minted).toEqual([]);
    });

    it('mints nothing once the granting share is revoked', async () => {
      await harness.dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [
        seeded.permissionedShareId,
      ]);

      const response = await request(httpServer(harness))
        .get(contentPath(seeded.ndaId))
        .set(await harness.authHeader(viewer));

      expect(response.status).toBe(403);
      expect(ApiError.parse(response.body).code).toBe('ACCESS_REVOKED');
      expect(harness.storage.minted).toEqual([]);
    });
  });

  describe('nodes with no bytes behind them', () => {
    it('404s on a folder without minting', async () => {
      const response = await asOwner(contentPath(seeded.legalId));

      expect(response.status).toBe(404);
      expect(harness.storage.minted).toEqual([]);
    });

    it('404s on a file still uploading, whose version is pending', async () => {
      const init = await request(httpServer(harness))
        .post(`${API_BASE}${endpoints.uploads.init.path}`)
        .set(await harness.authHeader(owner))
        .send({
          parentId: seeded.legalId,
          name: 'in-flight.pdf',
          sizeBytes: 128,
          mimeType: 'application/pdf',
        })
        .expect(201);
      harness.storage.reset();

      const response = await asOwner(contentPath((init.body as { nodeId: string }).nodeId));

      expect(response.status).toBe(404);
      expect(harness.storage.minted).toEqual([]);
    });

    it('404s on a soft-deleted file without minting', async () => {
      await harness.dataSource.query(`UPDATE nodes SET deleted_at = now() WHERE id = $1`, [
        seeded.ndaId,
      ]);

      const response = await asOwner(downloadPath(seeded.ndaId));

      expect(response.status).toBe(410);
      expect(harness.storage.minted).toEqual([]);
    });
  });
});
