import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UploadsService } from './uploads.service';

/**
 * How long a `pending` version is given before it is treated as abandoned.
 *
 * Comfortably longer than any upload can plausibly take — the write URL itself lives only fifteen
 * minutes — so the sweeper can never race a `complete` that is still coming.
 */
export const ABANDONED_AFTER_HOURS = 24;

/**
 * Collects the reservations nobody came back for.
 *
 * An `init` that is never completed leaves three things behind: a `pending` version row, an
 * invisible placeholder node, and possibly an object in the bucket. The placeholder is the one that
 * matters — it holds a **name** in its folder, so a closed tab would silently turn the next upload
 * of `report.pdf` into `report (2).pdf`. `abort` handles the case where the user is still there to
 * click cancel; this handles the browser that was simply closed.
 */
@Injectable()
export class UploadsSweeper {
  /** Named so the scheduler registry can be asked whether the job exists at all. */
  static readonly JOB_NAME = 'uploads.sweepAbandoned';

  private readonly logger = new Logger(UploadsSweeper.name);

  constructor(private readonly uploads: UploadsService) {}

  /**
   * Returns how many reservations were discarded, which is what makes this testable without going
   * anywhere near the clock — every test calls this method directly.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: UploadsSweeper.JOB_NAME })
  async sweep(): Promise<number> {
    const abandoned = await this.uploads.findAbandonedVersions(ABANDONED_AFTER_HOURS);
    if (abandoned.length === 0) return 0;

    let discarded = 0;
    for (const version of abandoned) {
      // One at a time, and each in its own transaction: a single failure — a row another request
      // has just deleted, an object storage refuses to remove — must not abandon the rest of the
      // sweep for another hour.
      try {
        await this.uploads.discardVersion(version.id, version.nodeId, version.storageKey);
        discarded += 1;
      } catch (error) {
        this.logger.warn(
          { err: error, versionId: version.id },
          'could not discard an abandoned upload; it will be retried next hour',
        );
      }
    }

    // The count reported is what was actually removed, not what was found: a log line that counts
    // attempts reads as a clean sweep on the hour a sweep is failing.
    this.logger.log({ found: abandoned.length, discarded }, 'swept abandoned uploads');
    return discarded;
  }
}
