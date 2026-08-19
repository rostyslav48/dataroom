import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { TokensPruner } from '../../src/auth/tokens.pruner';
import { TokensService } from '../../src/auth/tokens.service';
import { createTestHarness, type TestHarness } from '../support/app';
import { resetDatabase } from '../support/database';

/**
 * Rotation writes a refresh-token row every fifteen minutes per active session, and nothing ever
 * removed one. The table only grew — an index of dead credential hashes that `POST /auth/refresh`
 * probes on every call, and a larger thing to lose in a database compromise than a table of live
 * rows.
 *
 * As with the upload sweeper, the job is driven directly here and its `@Cron` registration is
 * asserted separately: nothing in this file waits on a clock.
 */
describe('refresh-token pruner', () => {
  let harness: TestHarness;
  let pruner: TokensPruner;
  let seeded: SeededFixtures;

  beforeAll(async () => {
    harness = await createTestHarness();
    pruner = harness.app.get(TokensPruner);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.dataSource);
    seeded = await seedFixtures(harness.dataSource);
  });

  const insert = async (row: {
    expiresAt: string;
    revokedAt?: string | null;
    usedAt?: string | null;
  }): Promise<string> => {
    const id = randomUUID();
    await harness.dataSource.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, revoked_at, used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        seeded.ownerId,
        randomUUID(),
        `hash-${id}`,
        row.expiresAt,
        row.revokedAt ?? null,
        row.usedAt ?? null,
      ],
    );
    return id;
  };

  const survivors = async (): Promise<string[]> => {
    const rows = (await harness.dataSource.query(
      `SELECT id FROM refresh_tokens ORDER BY id`,
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  };

  const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 86_400_000).toISOString();

  const daysAhead = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  it('deletes rows that expired and were never revoked', async () => {
    const stale = await insert({ expiresAt: daysAgo(1) });

    expect(await pruner.prune()).toBe(1);
    expect(await survivors()).not.toContain(stale);
  });

  it('leaves a live session alone', async () => {
    const live = await insert({ expiresAt: daysAhead(30) });
    // Used-but-unexpired is the ordinary state of a rotated predecessor inside its grace window.
    const rotated = await insert({ expiresAt: daysAhead(30), usedAt: daysAgo(0) });

    expect(await pruner.prune()).toBe(0);
    expect(await survivors()).toEqual(expect.arrayContaining([live, rotated]));
  });

  it('keeps a recently revoked row, because it is what makes a replay detectable', async () => {
    // The subtle one. A revoked row is the evidence that a presented token was already spent;
    // deleting it early turns a detected replay back into "no such token", which reads as an
    // ordinary expiry and revokes nothing. Held for a full refresh lifetime past revocation.
    const revokedYesterday = await insert({ expiresAt: daysAgo(2), revokedAt: daysAgo(1) });

    expect(await pruner.prune()).toBe(0);
    expect(await survivors()).toContain(revokedYesterday);
  });

  it('deletes a revoked row once the detection window has passed', async () => {
    // REFRESH_TOKEN_TTL is 30d in the test environment, so 31 days past revocation is clear of it.
    const longGone = await insert({ expiresAt: daysAgo(40), revokedAt: daysAgo(31) });

    expect(await pruner.prune()).toBe(1);
    expect(await survivors()).not.toContain(longGone);
  });

  it('swallows a failed prune rather than crashing the scheduler', async () => {
    // Housekeeping, not an outage: the next run picks up the same rows. Throwing out of a `@Cron`
    // body surfaces as an unhandled rejection and takes the process's error budget with it.
    const tokens = harness.app.get(TokensService);
    const original = tokens.pruneExpired.bind(tokens);
    tokens.pruneExpired = () => Promise.reject(new Error('connection terminated'));
    try {
      await expect(pruner.prune()).resolves.toBe(0);
    } finally {
      tokens.pruneExpired = original;
    }
  });

  it('is registered with the scheduler, so it actually runs in production', () => {
    const jobs = harness.app.get(SchedulerRegistry).getCronJobs();
    expect([...jobs.keys()]).toContain(TokensPruner.JOB_NAME);
  });
});
