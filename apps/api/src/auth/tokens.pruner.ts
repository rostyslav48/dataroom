import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokensService } from './tokens.service';

/**
 * Removes refresh-token rows that can no longer authenticate anything.
 *
 * Every sign-in and every refresh writes a row, and rotation means an active user writes one every
 * fifteen minutes. Without this the table only ever grows: rows that expired months ago sit in the
 * index that `POST /auth/refresh` probes on every call, and a table of dead credential hashes is
 * also a larger thing to lose in a database compromise than a table of live ones.
 *
 * Daily rather than hourly: nothing depends on the collection being prompt — an expired row is
 * already refused by `expires_at` — so this is housekeeping, and housekeeping should be cheap.
 */
@Injectable()
export class TokensPruner {
  /** Named so the scheduler registry can be asked whether the job exists at all. */
  static readonly JOB_NAME = 'auth.pruneExpiredRefreshTokens';

  private readonly logger = new Logger(TokensPruner.name);

  constructor(private readonly tokens: TokensService) {}

  /** Returns how many rows went, which is what makes this testable without going near the clock. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: TokensPruner.JOB_NAME })
  async prune(): Promise<number> {
    try {
      const deleted = await this.tokens.pruneExpired();
      if (deleted > 0) this.logger.log({ deleted }, 'pruned expired refresh tokens');
      return deleted;
    } catch (error) {
      // A failed prune is a housekeeping miss, not an outage: the next run picks up the same rows.
      // Throwing here would surface as an unhandled rejection in the scheduler.
      this.logger.warn({ err: error }, 'could not prune expired refresh tokens');
      return 0;
    }
  }
}
