import { resolve } from 'node:path';
import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

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

/**
 * The CLI runs migrations against the same database the app queries, so it needs the same TLS
 * posture. `AppConfig` is unavailable out here (see above), so the rule is restated rather than
 * imported — it is two lines, and a migration that connects in plaintext is the same leak.
 */
const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false;

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  ssl,
  entities: ALL_ENTITIES,
  migrations: MIGRATIONS,
  // Entities are a typed view over the migrations, never the source of truth.
  synchronize: false,
  logging: ['error', 'warn'],
};

export default new DataSource(dataSourceOptions);
