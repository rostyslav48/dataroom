import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/app.config';
import { ALL_ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        entities: ALL_ENTITIES,
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
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
