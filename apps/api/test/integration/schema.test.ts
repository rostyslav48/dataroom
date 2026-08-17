import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestDataSource, resetDatabase } from '../support/database';

/**
 * BE-1: the migration is the schema. These assertions are deliberately about the *database*, not
 * about the application — a constraint that exists only in service code is a constraint two
 * concurrent requests can walk straight through.
 */
describe('initial migration', () => {
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

  const indexDefinition = async (name: string): Promise<string | undefined> => {
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
      [name],
    );
    return rows[0]?.indexdef;
  };

  it.each([
    'ux_nodes_one_root',
    'ux_nodes_sibling_name',
    'ix_nodes_listing',
    'ix_nodes_path',
    'ix_nodes_room',
    'ix_rooms_owner',
    'ix_versions_pending',
    'ix_shares_node',
    'ix_shares_active',
    'ix_recipients_user',
    'ix_recipients_email',
  ])('creates %s', async (name) => {
    expect(await indexDefinition(name)).toBeTypeOf('string');
  });

  it('builds ix_nodes_path with text_pattern_ops', async () => {
    // Without this operator class, `LIKE 'prefix%'` cannot use the index under a non-C collation
    // and every subtree query silently becomes a sequential scan.
    expect(await indexDefinition('ix_nodes_path')).toContain('text_pattern_ops');
  });

  it('scopes the sibling-name index to live rows and lowercased names', async () => {
    const definition = await indexDefinition('ux_nodes_sibling_name');
    expect(definition).toContain('lower(name)');
    expect(definition).toContain('deleted_at IS NULL');
  });

  it('applies every migration and can revert to an empty schema', async () => {
    const isolated = await createTestDataSource();
    try {
      await isolated.undoLastMigration({ transaction: 'all' });
      const tables: Array<{ table_name: string }> = await isolated.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name <> 'migrations'`,
      );
      expect(tables).toEqual([]);
      // Put it back for the rest of the suite.
      await isolated.runMigrations({ transaction: 'all' });
    } finally {
      await isolated.destroy();
    }
  });
});

describe('schema constraints', () => {
  let dataSource: DataSource;
  let userId: string;
  let roomId: string;
  let rootId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    const [user]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO users (google_sub, email, name) VALUES ('sub-1', 'owner@example.com', 'Owner')
       RETURNING id`,
    );
    userId = user!.id;
    const [room]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO data_rooms (owner_id, name) VALUES ($1, 'Room') RETURNING id`,
      [userId],
    );
    roomId = room!.id;
    const [root]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
       VALUES ($1, NULL, 'folder', 'Room', '/placeholder/', 0, $2) RETURNING id`,
      [roomId, userId],
    );
    rootId = root!.id;
    await dataSource.query(`UPDATE nodes SET path = $2 WHERE id = $1`, [rootId, `/${rootId}/`]);
    await dataSource.query(`UPDATE data_rooms SET root_node_id = $2 WHERE id = $1`, [
      roomId,
      rootId,
    ]);
  });

  const insertChild = (name: string, parentId = rootId): Promise<unknown> =>
    dataSource.query(
      `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
       VALUES ($1, $2, 'folder', $3, $4, 1, $5)`,
      [roomId, parentId, name, `/${rootId}/x-${name}/`, userId],
    );

  it('rejects two siblings whose names differ only in case', async () => {
    await insertChild('Report');
    await expect(insertChild('report')).rejects.toThrow(/ux_nodes_sibling_name/);
  });

  it('lets a soft-deleted sibling free its name', async () => {
    await insertChild('Report');
    await dataSource.query(`UPDATE nodes SET deleted_at = now() WHERE name = 'Report'`);
    await expect(insertChild('report')).resolves.toBeDefined();
  });

  it('allows one root per room but not two', async () => {
    const [otherRoom]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO data_rooms (owner_id, name) VALUES ($1, 'Other') RETURNING id`,
      [userId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, NULL, 'folder', 'Other', '/other/', 0, $2)`,
        [otherRoom!.id, userId],
      ),
    ).resolves.toBeDefined();

    await expect(
      dataSource.query(
        `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, NULL, 'folder', 'Second root', '/second/', 0, $2)`,
        [roomId, userId],
      ),
    ).rejects.toThrow(/ux_nodes_one_root/);
  });

  it.each([
    ['an empty name', '   '],
    ['a name containing a forward slash', 'a/b'],
    ['a name containing a backslash', 'a\\b'],
    ['a name over 255 characters', 'x'.repeat(256)],
  ])('rejects %s', async (_label, name) => {
    await expect(insertChild(name)).rejects.toThrow(/ck_name_/);
  });

  it('rejects file columns on a folder', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by, size_bytes)
         VALUES ($1, $2, 'folder', 'Bad', '/bad/', 1, $3, 10)`,
        [roomId, rootId, userId],
      ),
    ).rejects.toThrow(/ck_folder_columns/);
  });

  it('rejects a root node that is a file', async () => {
    const [otherRoom]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO data_rooms (owner_id, name) VALUES ($1, 'Other') RETURNING id`,
      [userId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO nodes (data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, NULL, 'file', 'Bad', '/bad/', 0, $2)`,
        [otherRoom!.id, userId],
      ),
    ).rejects.toThrow(/ck_root_is_folder/);
  });

  it('requires a token on a public link and forbids one on a permissioned share', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO shares (node_id, data_room_id, type, created_by) VALUES ($1, $2, 'public_link', $3)`,
        [rootId, roomId, userId],
      ),
    ).rejects.toThrow(/ck_token_iff_link/);

    await expect(
      dataSource.query(
        `INSERT INTO shares (node_id, data_room_id, type, token, created_by)
         VALUES ($1, $2, 'permissioned', 'tok', $3)`,
        [rootId, roomId, userId],
      ),
    ).rejects.toThrow(/ck_token_iff_link/);
  });

  it('treats recipient emails case-insensitively via citext', async () => {
    const [share]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO shares (node_id, data_room_id, type, created_by)
       VALUES ($1, $2, 'permissioned', $3) RETURNING id`,
      [rootId, roomId, userId],
    );
    await dataSource.query(`INSERT INTO share_recipients (share_id, email) VALUES ($1, $2)`, [
      share!.id,
      'Viewer@Example.com',
    ]);

    const found: unknown[] = await dataSource.query(
      `SELECT id FROM share_recipients WHERE email = $1`,
      ['viewer@example.com'],
    );
    expect(found).toHaveLength(1);

    await expect(
      dataSource.query(`INSERT INTO share_recipients (share_id, email) VALUES ($1, $2)`, [
        share!.id,
        'VIEWER@EXAMPLE.COM',
      ]),
    ).rejects.toThrow();
  });
});
