import { join, resolve } from 'node:path';
import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

/**
 * The DataSource the TypeORM CLI uses for `migration:run` / `migration:revert`.
 *
 * The application itself builds its DataSource from `AppConfig` (see `database.module.ts`); this
 * file exists because the CLI runs outside Nest and therefore outside the config module. It is the
 * one place besides `config/` that touches `process.env`, and it loads the repo-root `.env` the
 * same way the app does.
 */
const envFile = resolve(__dirname, '../../../../.env');
try {
  process.loadEnvFile(envFile);
} catch {
  // No .env — the environment is expected to be populated already (CI, Render, a test container).
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(`DATABASE_URL is not set (looked for an .env at ${envFile})`);
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  entities: ALL_ENTITIES,
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  // Entities are a typed view over the migrations, never the source of truth.
  synchronize: false,
  logging: ['error', 'warn'],
};

export default new DataSource(dataSourceOptions);
