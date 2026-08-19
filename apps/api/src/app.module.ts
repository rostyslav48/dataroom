import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { RATE_LIMIT_WINDOW_MS } from './common/rate-limits';
import { AppConfig } from './config/app.config';
import { ConfigModule } from './config/config.module';
import { DataRoomsModule } from './data-rooms/data-rooms.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { NodesModule } from './nodes/nodes.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SharesModule } from './shares/shares.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          // The request id is echoed in every ApiError, so a user-visible failure can be grepped
          // straight to its log line.
          genReqId: (_req, res) => {
            const id = randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.headers["x-share-token"]',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
        },
      }),
    }),
    // Every route is throttled, with the abuse-sensitive ones narrowed at the handler. Registered
    // async so the ceiling is deployment-configurable; see `AppConfig.rateLimitPerMinute`.
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: RATE_LIMIT_WINDOW_MS, limit: config.rateLimitPerMinute }],
      }),
    }),
    ScheduleModule.forRoot(),

    UsersModule,
    AuthModule,
    PermissionsModule,
    StorageModule,
    DataRoomsModule,
    NodesModule,
    UploadsModule,
    SharesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global, so a new endpoint is limited by default rather than by whoever remembers the
    // decorator. Unthrottled-by-default is how `/health` and `/auth/refresh` ended up open.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
