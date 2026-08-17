import { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { ALL_ENTITIES } from '../../src/database/entities';
import { MIGRATIONS } from '../../src/database/migrations';

/**
 * A DataSource against the throwaway container, with migrations applied from empty.
 *
 * Each test file gets its own connection to the same database; `resetDatabase` between tests keeps
 * them independent without paying for a container per file.
 */
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: inject('databaseUrl'),
    entities: ALL_ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  return dataSource;
}

const TABLES = [
  'refresh_tokens',
  'share_recipients',
  'shares',
  'file_versions',
  'nodes',
  'data_rooms',
  'users',
];

/**
 * `nodes.current_version_id` and `data_rooms.root_node_id` are circular with their targets, so the
 * truncate has to be one statement over every table rather than a per-table loop.
 */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
