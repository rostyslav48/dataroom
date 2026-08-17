import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { GlobalSetupContext } from 'vitest/node';
import { ALL_ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migrations';

/**
 * One Postgres container for the whole run, created from the same image the compose file uses, with
 * the migrations applied from empty before any test connects.
 *
 * Testcontainers rather than a shared development database, because applying migrations from empty
 * on every run means the migrations themselves are under test. A long-lived dev database silently
 * stops testing them after the first run, and the failure then shows up on deploy.
 */
let container: StartedPostgreSqlContainer | undefined;

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('dataroom_test')
    .withUsername('dataroom')
    .withPassword('dataroom')
    .start();

  const databaseUrl = container.getConnectionUri();

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: ALL_ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  await dataSource.destroy();

  provide('databaseUrl', databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
