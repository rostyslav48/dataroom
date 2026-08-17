import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ApiError,
  ListChildrenResponse,
  NodeDetailResponse,
  NodeDto,
  endpoints,
  fixtures,
} from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { ancestorIds, buildPath, depthOf, rootPath } from '../../src/nodes/path.util';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

const url = (path: string, id?: string): string =>
  `${API_BASE}${id ? path.replace(':id', id) : path}`;

interface RawNode {
  id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number;
  type: 'folder' | 'file';
  deleted_at: Date | null;
  subtree_size_bytes: string;
  subtree_file_count: number;
}

describe('nodes', () => {
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

  const allNodes = (): Promise<RawNode[]> =>
    harness.dataSource.query(`SELECT * FROM nodes ORDER BY id`) as Promise<RawNode[]>;

  /** Every invariant the data model rests on, asserted against the database itself. */
  const assertPathInvariants = async (): Promise<void> => {
    const rows = await allNodes();
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const row of rows) {
      expect(row.path.startsWith('/'), `${row.name} path starts with /`).toBe(true);
      expect(row.path.endsWith(`/${row.id}/`), `${row.name} path ends with its own id`).toBe(true);
      expect(depthOf(row.path), `${row.name} depth matches path`).toBe(row.depth);

      if (row.parent_id === null) {
        expect(row.depth).toBe(0);
        continue;
      }
      const parent = byId.get(row.parent_id);
      expect(parent, `${row.name} has a parent row`).toBeDefined();
      expect(row.path.startsWith(parent!.path), `${row.name} extends its parent's path`).toBe(true);
      expect(ancestorIds(row.path).at(-1)).toBe(parent!.id);
    }
  };

  /** Recomputed from the authoritative rows — what the cached rollups must equal. */
  const recomputeRollups = async (): Promise<Map<string, { size: number; files: number }>> => {
    const rows: Array<{ id: string; size: string; files: string }> = await harness.dataSource.query(
      `SELECT f.id,
              COALESCE(sum(d.size_bytes) FILTER (WHERE d.type = 'file'), 0)::text AS size,
              count(*) FILTER (WHERE d.type = 'file')::text                       AS files
         FROM nodes f
         LEFT JOIN nodes d
           ON d.data_room_id = f.data_room_id
          AND d.path LIKE f.path || '%'
          AND d.id <> f.id
          AND d.deleted_at IS NULL
          AND d.current_version_id IS NOT NULL
        WHERE f.type = 'folder' AND f.deleted_at IS NULL
        GROUP BY f.id`,
    );
    return new Map(rows.map((row) => [row.id, { size: Number(row.size), files: Number(row.files) }]));
  };

  const assertRollupsMatchReality = async (): Promise<void> => {
    const expected = await recomputeRollups();
    const rows = await allNodes();
    for (const row of rows.filter((r) => r.type === 'folder' && r.deleted_at === null)) {
      const truth = expected.get(row.id) ?? { size: 0, files: 0 };
      expect(Number(row.subtree_size_bytes), `${row.name} subtree size`).toBe(truth.size);
      expect(row.subtree_file_count, `${row.name} subtree file count`).toBe(truth.files);
    }
  };

  describe('GET /nodes/:id', () => {
    it('returns the node, full breadcrumbs and owner access for the owner', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.balanceId))
        .set(await harness.authHeader(owner))
        .expect(200);

      const body = NodeDetailResponse.parse(response.body);
      expect(body.access).toBe('owner');
      expect(body.shareRootId).toBe(seeded.rootNodeId);
      expect(body.dataRoomName).toBe(fixtures.dataRoom.name);
      expect(body.breadcrumbs.map((crumb) => crumb.name)).toEqual([
        'Project Atlas',
        'Financials',
        'Q3',
        'balance-sheet.pdf',
      ]);
    });

    it('truncates breadcrumbs at the share root for a viewer', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.balanceId))
        .set('X-Share-Token', seeded.publicToken)
        .expect(200);

      const body = NodeDetailResponse.parse(response.body);
      expect(body.access).toBe('viewer');
      expect(body.shareRootId).toBe(seeded.financialsId);
      // "Project Atlas" must NOT appear: ancestor folder names are confidential.
      expect(body.breadcrumbs.map((crumb) => crumb.name)).toEqual([
        'Financials',
        'Q3',
        'balance-sheet.pdf',
      ]);
    });

    it('denies a node outside the share, and says why', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.overviewId))
        .set('X-Share-Token', seeded.publicToken)
        .expect(403);
      expect(ApiError.parse(response.body).code).toBe('FORBIDDEN');
    });

    it('is 410 ITEM_GONE once the owner deletes it', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.q3Id))
        .set(await harness.authHeader(owner))
        .expect(204);

      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.q3Id))
        .set(await harness.authHeader(owner))
        .expect(410);
      expect(ApiError.parse(response.body).code).toBe('ITEM_GONE');
    });

    it('is 401 with no session at all', async () => {
      await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.rootNodeId))
        .expect(401);
    });
  });

  describe('GET /nodes/:id/children', () => {
    /** Files are only visible once they have a ready version — exactly as `complete` leaves them. */
    const promoteToReady = async (nodeId: string, sizeBytes: number): Promise<void> => {
      const versionId = randomUUID();
      await harness.dataSource.query(
        `INSERT INTO file_versions
           (id, node_id, version, storage_key, size_bytes, mime_type, status, uploaded_by)
         VALUES ($1, $2, 1, $3, $4, 'application/pdf', 'ready', $5)`,
        [versionId, nodeId, `${seeded.roomId}/${nodeId}/${versionId}`, sizeBytes, seeded.ownerId],
      );
      await harness.dataSource.query(
        `UPDATE nodes SET current_version_id = $2, size_bytes = $3, mime_type = 'application/pdf'
          WHERE id = $1`,
        [nodeId, versionId, sizeBytes],
      );
    };

    const seedSiblings = async (count: number): Promise<string> => {
      const parentId = randomUUID();
      const parentPath = buildPath(rootPath(seeded.rootNodeId), parentId);
      await harness.dataSource.query(
        `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, $2, $3, 'folder', 'Many', $4, 1, $5)`,
        [parentId, seeded.roomId, seeded.rootNodeId, parentPath, seeded.ownerId],
      );

      for (let i = 0; i < count; i += 1) {
        const id = randomUUID();
        const isFolder = i % 2 === 0;
        const name = `${isFolder ? 'folder' : 'file'}-${String(i).padStart(3, '0')}`;
        await harness.dataSource.query(
          `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 2, $7)`,
          [
            id,
            seeded.roomId,
            parentId,
            isFolder ? 'folder' : 'file',
            name,
            buildPath(parentPath, id),
            seeded.ownerId,
          ],
        );
        if (!isFolder) await promoteToReady(id, 1000 + i);
      }
      return parentId;
    };

    const pageThrough = async (
      parentId: string,
      query: Record<string, string | number> = {},
    ): Promise<{ ids: string[]; types: string[]; pages: number }> => {
      const ids: string[] = [];
      const types: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const response: request.Response = await request(httpServer(harness))
          .get(url(endpoints.nodes.children.path, parentId))
          .query({ ...query, ...(cursor ? { cursor } : {}) })
          .set(await harness.authHeader(owner))
          .expect(200);

        const body = ListChildrenResponse.parse(response.body);
        ids.push(...body.items.map((item) => item.id));
        types.push(...body.items.map((item) => item.type));
        cursor = body.nextCursor;
        pages += 1;
        expect(pages, 'pagination terminated').toBeLessThan(50);
      } while (cursor !== null);

      return { ids, types, pages };
    };

    it('paginates 200 siblings with no duplicate and no skipped row', async () => {
      const parentId = await seedSiblings(200);
      const { ids, pages } = await pageThrough(parentId, { limit: 25 });

      expect(ids).toHaveLength(200);
      expect(new Set(ids).size).toBe(200);
      // Eight pages of 25, and the last one reports the end itself rather than costing a ninth
      // round trip — `hasMore` is decided by fetching limit + 1 rows, not by a count query.
      expect(pages).toBe(8);
    });

    it('puts every folder before every file, across page boundaries', async () => {
      const parentId = await seedSiblings(60);
      const { types } = await pageThrough(parentId, { limit: 7 });

      const firstFile = types.indexOf('file');
      expect(firstFile).toBeGreaterThan(0);
      expect(types.slice(0, firstFile).every((type) => type === 'folder')).toBe(true);
      expect(types.slice(firstFile).every((type) => type === 'file')).toBe(true);
    });

    it('does not skip or repeat when a sibling is inserted mid-scroll', async () => {
      const parentId = await seedSiblings(40);

      const first = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, parentId))
        .query({ limit: 10 })
        .set(await harness.authHeader(owner))
        .expect(200);
      const firstPage = ListChildrenResponse.parse(first.body);

      // Insert a folder that sorts *before* the page boundary — the case an OFFSET would skip on.
      await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId, name: 'folder-000-inserted' })
        .set(await harness.authHeader(owner))
        .expect(201);

      const second = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, parentId))
        .query({ limit: 10, cursor: firstPage.nextCursor })
        .set(await harness.authHeader(owner))
        .expect(200);
      const secondPage = ListChildrenResponse.parse(second.body);

      const overlap = secondPage.items.filter((item) =>
        firstPage.items.some((seen) => seen.id === item.id),
      );
      expect(overlap, 'no row appears on two pages').toEqual([]);
    });

    it.each(['name', 'size', 'updatedAt'] as const)('paginates correctly sorted by %s', async (sort) => {
      const parentId = await seedSiblings(30);
      for (const dir of ['asc', 'desc'] as const) {
        const { ids } = await pageThrough(parentId, { limit: 4, sort, dir });
        expect(new Set(ids).size, `${sort}/${dir} unique`).toBe(30);
      }
    });

    it('reports the end only through nextCursor === null', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, seeded.legalId))
        .set(await harness.authHeader(owner))
        .expect(200);
      const body = ListChildrenResponse.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.nextCursor).toBeNull();
    });

    it('hides a file whose upload never completed', async () => {
      const pendingId = randomUUID();
      await harness.dataSource.query(
        `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, $2, $3, 'file', 'half-uploaded.pdf', $4, 2, $5)`,
        [
          pendingId,
          seeded.roomId,
          seeded.legalId,
          buildPath(buildPath(rootPath(seeded.rootNodeId), seeded.legalId), pendingId),
          seeded.ownerId,
        ],
      );

      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, seeded.legalId))
        .set(await harness.authHeader(owner))
        .expect(200);
      const body = ListChildrenResponse.parse(response.body);
      expect(body.items.map((item) => item.name)).toEqual(['NDA.pdf']);
    });

    it('rejects a malformed cursor with 400, not 500', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.children.path, seeded.legalId))
        .query({ cursor: 'not-a-cursor' })
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /folders', () => {
    it('creates a folder with a correct path and depth', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.legalId, name: 'Contracts' })
        .set(await harness.authHeader(owner))
        .expect(201);

      const node = NodeDto.parse(response.body);
      expect(node.parentId).toBe(seeded.legalId);
      expect(node.subtreeFileCount).toBe(0);
      await assertPathInvariants();
    });

    it.each([
      ['an identical name', 'Legal'],
      ['a name differing only in case', 'legal'],
    ])('rejects %s with 409 NAME_CONFLICT', async (_label, name) => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.rootNodeId, name })
        .set(await harness.authHeader(owner))
        .expect(409);
      expect(ApiError.parse(response.body).code).toBe('NAME_CONFLICT');
    });

    it('lets exactly one of two concurrent identical creates win', async () => {
      const attempts = await Promise.all(
        [1, 2].map(() =>
          harness
            .authHeader(owner)
            .then((header) =>
              request(httpServer(harness))
                .post(url(endpoints.nodes.createFolder.path))
                .send({ parentId: seeded.legalId, name: 'Race' })
                .set(header),
            ),
        ),
      );

      const statuses = attempts.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);

      const rows: unknown[] = await harness.dataSource.query(
        `SELECT id FROM nodes WHERE parent_id = $1 AND name = 'Race' AND deleted_at IS NULL`,
        [seeded.legalId],
      );
      expect(rows).toHaveLength(1);
    });

    it.each([
      ['an empty name', '   '],
      ['a name with a slash', 'a/b'],
      ['a 256-character name', 'x'.repeat(256)],
    ])('rejects %s with 400', async (_label, name) => {
      await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.rootNodeId, name })
        .set(await harness.authHeader(owner))
        .expect(400);
    });

    it('refuses a viewer, and a stranger, without disclosing more to either', async () => {
      const asViewer = await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.legalId, name: 'Nope' })
        .set(await harness.authHeader(viewer))
        .expect(403);
      expect(ApiError.parse(asViewer.body).code).toBe('FORBIDDEN');

      await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.legalId, name: 'Nope' })
        .set(await harness.authHeader(stranger))
        .expect(403);
    });
  });

  describe('PATCH /nodes/:id — rename', () => {
    it('renames and keeps the path stable, because a path is ids not names', async () => {
      const before = await allNodes();
      const response = await request(httpServer(harness))
        .patch(url(endpoints.nodes.rename.path, seeded.legalId))
        .send({ name: 'Legal & Compliance' })
        .set(await harness.authHeader(owner))
        .expect(200);

      expect(NodeDto.parse(response.body).name).toBe('Legal & Compliance');
      const after = await allNodes();
      expect(after.find((n) => n.id === seeded.legalId)?.path).toBe(
        before.find((n) => n.id === seeded.legalId)?.path,
      );
      await assertPathInvariants();
    });

    it.each([
      ['an existing sibling name', 'Financials'],
      ['the same name in different case', 'financials'],
    ])('rejects %s with 409 — never a silent auto-suffix', async (_label, name) => {
      const response = await request(httpServer(harness))
        .patch(url(endpoints.nodes.rename.path, seeded.legalId))
        .send({ name })
        .set(await harness.authHeader(owner))
        .expect(409);
      expect(ApiError.parse(response.body).code).toBe('NAME_CONFLICT');

      const rows = await allNodes();
      expect(rows.find((n) => n.id === seeded.legalId)?.name).toBe('Legal');
    });

    it('accepts a rename to its own current name as a no-op', async () => {
      await request(httpServer(harness))
        .patch(url(endpoints.nodes.rename.path, seeded.legalId))
        .send({ name: 'Legal' })
        .set(await harness.authHeader(owner))
        .expect(200);
    });

    it('frees a name once the holder is deleted', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.legalId))
        .set(await harness.authHeader(owner))
        .expect(204);

      await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.rootNodeId, name: 'Legal' })
        .set(await harness.authHeader(owner))
        .expect(201);
    });
  });

  describe('POST /nodes/:id/move', () => {
    it('rewrites every descendant path and depth in one transaction', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.financialsId))
        .send({ parentId: seeded.legalId })
        .set(await harness.authHeader(owner))
        .expect(200);

      const rows = await allNodes();
      const financials = rows.find((n) => n.id === seeded.financialsId)!;
      const q3 = rows.find((n) => n.id === seeded.q3Id)!;
      const balance = rows.find((n) => n.id === seeded.balanceId)!;

      expect(financials.parent_id).toBe(seeded.legalId);
      expect(financials.depth).toBe(2);
      expect(q3.depth).toBe(3);
      expect(balance.depth).toBe(4);
      expect(q3.path.startsWith(financials.path)).toBe(true);
      expect(balance.path.startsWith(q3.path)).toBe(true);
      await assertPathInvariants();
      await assertRollupsMatchReality();
    });

    it.each([
      ['into its own descendant', () => [seeded.financialsId, seeded.q3Id]],
      ['into itself', () => [seeded.financialsId, seeded.financialsId]],
    ])('rejects a move %s with CYCLE_NOT_ALLOWED', async (_label, ids) => {
      const [nodeId, targetId] = ids();
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, nodeId as string))
        .send({ parentId: targetId })
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('CYCLE_NOT_ALLOWED');
    });

    it('rejects a file as the destination', async () => {
      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.legalId))
        .send({ parentId: seeded.overviewId })
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('INVALID_MOVE_TARGET');
    });

    it('rejects a destination in another data room', async () => {
      const otherRoomId = randomUUID();
      const otherRootId = randomUUID();
      await harness.dataSource.query(
        `INSERT INTO data_rooms (id, owner_id, name) VALUES ($1, $2, 'Second')`,
        [otherRoomId, seeded.ownerId],
      );
      await harness.dataSource.query(
        `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, $2, NULL, 'folder', 'Second', $3, 0, $4)`,
        [otherRootId, otherRoomId, rootPath(otherRootId), seeded.ownerId],
      );

      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.legalId))
        .send({ parentId: otherRootId })
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('INVALID_MOVE_TARGET');
    });

    it('treats a move to the current parent as a no-op', async () => {
      const before = await allNodes();
      await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.legalId))
        .send({ parentId: seeded.rootNodeId })
        .set(await harness.authHeader(owner))
        .expect(200);
      const after = await allNodes();
      expect(after.map((n) => n.path)).toEqual(before.map((n) => n.path));
    });

    it('leaves the tree byte-identical when the move would collide on name', async () => {
      // A folder called "Financials" already exists under Legal, so moving the real one collides.
      await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.legalId, name: 'Financials' })
        .set(await harness.authHeader(owner))
        .expect(201);

      const before = await allNodes();

      const response = await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.financialsId))
        .send({ parentId: seeded.legalId })
        .set(await harness.authHeader(owner))
        .expect(409);
      expect(ApiError.parse(response.body).code).toBe('NAME_CONFLICT');

      const after = await allNodes();
      expect(after).toEqual(before);
    });

    it('carries the share with the node, because a share targets an id not a path', async () => {
      await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.financialsId))
        .send({ parentId: seeded.legalId })
        .set(await harness.authHeader(owner))
        .expect(200);

      await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.q3Id))
        .set('X-Share-Token', seeded.publicToken)
        .expect(200);
    });
  });

  describe('DELETE /nodes/:id', () => {
    it('soft-deletes the whole subtree and revokes the shares inside it', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.financialsId))
        .set(await harness.authHeader(owner))
        .expect(204);

      const rows = await allNodes();
      for (const id of [seeded.financialsId, seeded.q3Id, seeded.balanceId]) {
        expect(rows.find((n) => n.id === id)?.deleted_at, id).not.toBeNull();
      }
      // Untouched siblings stay live.
      expect(rows.find((n) => n.id === seeded.legalId)?.deleted_at).toBeNull();

      const shares: Array<{ revoked_at: Date | null }> = await harness.dataSource.query(
        `SELECT revoked_at FROM shares WHERE id = $1`,
        [seeded.publicShareId],
      );
      expect(shares[0]?.revoked_at).not.toBeNull();

      // And the link stops working immediately.
      const denied = await request(httpServer(harness))
        .get(url(endpoints.nodes.get.path, seeded.q3Id))
        .set('X-Share-Token', seeded.publicToken)
        .expect(410);
      expect(ApiError.parse(denied.body).code).toBe('ITEM_GONE');
    });

    it('subtracts the deleted subtree from surviving ancestors', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.q3Id))
        .set(await harness.authHeader(owner))
        .expect(204);
      await assertRollupsMatchReality();
    });

    it('refuses to delete a data room root through the node endpoint', async () => {
      const response = await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.rootNodeId))
        .set(await harness.authHeader(owner))
        .expect(400);
      expect(ApiError.parse(response.body).code).toBe('VALIDATION_FAILED');
    });

    it('refuses a viewer', async () => {
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.ndaId))
        .set(await harness.authHeader(viewer))
        .expect(403);
    });
  });

  describe('GET /nodes/:id/stats and delete-preview', () => {
    it('counts the subtree, excluding the node itself', async () => {
      const response = await request(httpServer(harness))
        .get(url(endpoints.nodes.stats.path, seeded.financialsId))
        .set(await harness.authHeader(owner))
        .expect(200);

      expect(response.body).toEqual({
        sizeBytes: fixtures.nodes.balance.sizeBytes,
        fileCount: 1,
        folderCount: 1,
      });
    });

    it('previews exactly what a delete would remove, including the shares it revokes', async () => {
      const preview = await request(httpServer(harness))
        .get(url(endpoints.nodes.deletePreview.path, seeded.financialsId))
        .set(await harness.authHeader(owner))
        .expect(200);

      expect(preview.body).toEqual({
        sizeBytes: fixtures.nodes.balance.sizeBytes,
        fileCount: 1,
        folderCount: 1,
        affectedShareCount: 1,
      });

      const before = (await allNodes()).filter((n) => n.deleted_at === null).length;
      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.financialsId))
        .set(await harness.authHeader(owner))
        .expect(204);
      const after = (await allNodes()).filter((n) => n.deleted_at === null).length;

      // 1 folder + 1 file below it, plus the node itself.
      expect(before - after).toBe(preview.body.fileCount + preview.body.folderCount + 1);
    });

    it('is not available to a viewer', async () => {
      await request(httpServer(harness))
        .get(url(endpoints.nodes.deletePreview.path, seeded.legalId))
        .set(await harness.authHeader(viewer))
        .expect(403);
    });
  });

  describe('rollups across a sequence of mutations', () => {
    it('still equal a full recomputation after create, move and delete', async () => {
      const created = await request(httpServer(harness))
        .post(url(endpoints.nodes.createFolder.path))
        .send({ parentId: seeded.rootNodeId, name: 'Diligence' })
        .set(await harness.authHeader(owner))
        .expect(201);
      const folderId = NodeDto.parse(created.body).id;

      await request(httpServer(harness))
        .post(url(endpoints.nodes.move.path, seeded.legalId))
        .send({ parentId: folderId })
        .set(await harness.authHeader(owner))
        .expect(200);
      await assertRollupsMatchReality();

      await request(httpServer(harness))
        .delete(url(endpoints.nodes.remove.path, seeded.ndaId))
        .set(await harness.authHeader(owner))
        .expect(204);
      await assertRollupsMatchReality();
      await assertPathInvariants();
    });
  });
});
