import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtures } from '@dataroom/contracts';
import { seed } from '../../src/database/seed';
import { createTestDataSource, resetDatabase } from '../support/database';

interface NodeSnapshot {
  id: string;
  name: string;
  path: string;
  depth: number;
  parentId: string | null;
  sizeBytes: string | null;
  subtreeSizeBytes: string;
  subtreeFileCount: string;
  currentVersionId: string | null;
}

/**
 * `pnpm db:seed` is a hard dependency of the whole e2e suite, and its two failure modes are both
 * silent: a second run that duplicates or half-updates the tree, and rollups that were written
 * from the fixture constants rather than derived from the tree they describe.
 */
describe('db:seed', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  const snapshot = (): Promise<NodeSnapshot[]> =>
    dataSource.query(
      `SELECT id, name, path, depth,
              parent_id           AS "parentId",
              size_bytes          AS "sizeBytes",
              subtree_size_bytes  AS "subtreeSizeBytes",
              subtree_file_count  AS "subtreeFileCount",
              current_version_id  AS "currentVersionId"
         FROM nodes
        ORDER BY path`,
    ) as Promise<NodeSnapshot[]>;

  it('builds the fixture tree', async () => {
    const seeded = await seed(dataSource);

    expect(seeded.roomId).toBe(fixtures.IDS.room);
    const nodes = await snapshot();
    expect(nodes.map((node) => node.name).sort()).toEqual(
      Object.values(fixtures.nodes)
        .map((node) => node.name)
        .sort(),
    );
    // Every file points at a ready version; a file with none is invisible in every listing.
    const files = nodes.filter((node) => node.currentVersionId !== null);
    expect(files).toHaveLength(3);
  });

  it('leaves the same state when run twice', async () => {
    await seed(dataSource);
    const first = await snapshot();

    await seed(dataSource);
    const second = await snapshot();

    // Node ids are fixture constants, so a duplicated tree would show up as extra rows and a
    // doubled rollup as a changed number. Comparing the whole projection catches both.
    expect(second).toEqual(first);
    const rooms = (await dataSource.query(
      `SELECT count(*)::int AS count FROM data_rooms`,
    )) as Array<{ count: number }>;
    expect(rooms[0]?.count).toBe(1);
  });

  it('re-runs cleanly over a tree somebody has since modified', async () => {
    await seed(dataSource);
    // The state a demo leaves behind: a renamed folder, a new file, a drifted rollup.
    await dataSource.query(`UPDATE nodes SET name = 'Renamed' WHERE id = $1`, [
      fixtures.IDS.folderLegal,
    ]);
    await dataSource.query(`UPDATE nodes SET subtree_size_bytes = 999999 WHERE id = $1`, [
      fixtures.IDS.rootNode,
    ]);

    const clean = await seed(dataSource);

    expect(clean.roomId).toBe(fixtures.IDS.room);
    const nodes = await snapshot();
    expect(nodes.find((node) => node.id === fixtures.IDS.folderLegal)?.name).toBe('Legal');
    expect(nodes.find((node) => node.id === fixtures.IDS.rootNode)?.subtreeSizeBytes).not.toBe(
      '999999',
    );
  });

  it('writes rollups that equal a recomputation from the subtree', async () => {
    await seed(dataSource);

    // Derived from the rows, not from the fixture constants the seed was built from — otherwise
    // this asserts that a number equals itself.
    const drift = (await dataSource.query(
      `SELECT n.id,
              n.name,
              n.subtree_size_bytes AS "storedSize",
              n.subtree_file_count AS "storedCount",
              coalesce(sum(d.size_bytes), 0)                     AS "realSize",
              count(d.id) FILTER (WHERE d.type = 'file')         AS "realCount"
         FROM nodes n
         LEFT JOIN nodes d
                ON d.path LIKE n.path || '%'
               AND d.id <> n.id
               AND d.type = 'file'
               AND d.deleted_at IS NULL
        WHERE n.type = 'folder' AND n.deleted_at IS NULL
        GROUP BY n.id, n.name, n.subtree_size_bytes, n.subtree_file_count
       HAVING n.subtree_size_bytes <> coalesce(sum(d.size_bytes), 0)
           OR n.subtree_file_count <> count(d.id) FILTER (WHERE d.type = 'file')`,
    )) as unknown[];

    expect(drift).toEqual([]);
  });

  it('leaves a data room that is not the fixture room alone', async () => {
    await seed(dataSource);
    await dataSource.query(
      `INSERT INTO data_rooms (id, owner_id, name) VALUES ($1, $2, 'Somebody else''s room')`,
      ['00000000-0000-4000-8000-0000000009ff', fixtures.IDS.owner],
    );

    await seed(dataSource);

    const rooms = (await dataSource.query(`SELECT name FROM data_rooms ORDER BY name`)) as Array<{
      name: string;
    }>;
    expect(rooms.map((room) => room.name)).toContain("Somebody else's room");
  });
});
