import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

/** One minute, ten requests — the limit `/shared/:token` is served under (SPEC-05). */
export const SHARE_THROTTLER = 'share';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule.forRoot({
      pinoHttp: {
        // The request id is echoed in every ApiError, so a user-visible failure can be grepped
        // straight to its log line.
        genReqId: (req, res) => {
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
    // Only `/shared/:token` is throttled; it is the one endpoint reachable with no session at all.
    ThrottlerModule.forRoot({
      throttlers: [{ name: SHARE_THROTTLER, ttl: 60_000, limit: 10 }],
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
})
export class AppModule {}
