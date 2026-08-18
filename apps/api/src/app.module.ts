import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { AppConfig } from './config/app.config';
import { ConfigModule } from './config/config.module';
import { DataRoomsModule } from './data-rooms/data-rooms.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { NodesModule } from './nodes/nodes.module';
import { PermissionsModule } from './permissions/permissions.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

/** One minute, ten requests — the limit `/shared/:token` is served under (SPEC-05). */
export const SHARE_THROTTLER = 'share';

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
    // Only `/shared/:token` is throttled; it is the one endpoint reachable with no session at all.
    ThrottlerModule.forRoot({
      throttlers: [{ name: SHARE_THROTTLER, ttl: 60_000, limit: 10 }],
    }),
    ScheduleModule.forRoot(),

    UsersModule,
    AuthModule,
    PermissionsModule,
    StorageModule,
    DataRoomsModule,
    NodesModule,
    UploadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
