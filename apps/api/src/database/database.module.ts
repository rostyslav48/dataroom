import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/app.config';
import { ALL_ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        // node-postgres speaks plaintext unless asked otherwise, and the database is external to
        // the API's host in every deployed topology. See `AppConfig.databaseSsl`.
        ssl: config.databaseSsl,
        entities: ALL_ENTITIES,
        migrations: MIGRATIONS,
        // Never true, including locally: a schema that drifts from its migrations is a schema
        // nobody can deploy.
        synchronize: false,
        migrationsRun: false,
        logging: config.isProduction ? (['error'] as const) : (['error', 'warn'] as const),
      }),
    }),
  ],
})
export class DatabaseModule {}
