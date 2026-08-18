import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { fixtures } from '@dataroom/contracts';
import { seedFixtures, type SeededFixtures } from './seed-fixtures';

/**
 * `pnpm db:seed` — the canonical fixture tree, in a real database.
 *
 * It seeds exactly what `seedFixtures` builds for the integration tests and exactly what the
 * frontend's MSW handlers serve, because all three read `@dataroom/contracts`' fixtures. That is
 * the whole point: a Playwright spec that asserts on `NDA.pdf` is asserting on the same document
 * the API tests and the mocked frontend use, so "green against mocks" says something about the
 * real stack.
 *
 * Idempotent by rebuild rather than by upsert. The fixture room is deleted and re-created, so a
 * second run cannot leave a half-updated tree — a rollup that was bumped twice, a node whose path
 * no longer matches its parent — which is the failure mode of seeding with `ON CONFLICT DO
 * UPDATE`. Only the fixture room is touched: a developer's own rooms in the same database survive.
 */
export async function seed(dataSource: DataSource): Promise<SeededFixtures> {
  await clearFixtureRoom(dataSource);
  return seedFixtures(dataSource);
}

/**
 * Delete order is FK order, and the two circular references have to be broken first:
 * `data_rooms.root_node_id` points at a node, and `nodes.current_version_id` points at a version
 * whose own row points back at the node.
 */
async function clearFixtureRoom(dataSource: DataSource): Promise<void> {
  const room = fixtures.IDS.room;

  await dataSource.transaction(async (manager) => {
    await manager.query(`UPDATE data_rooms SET root_node_id = NULL WHERE id = $1`, [room]);
    await manager.query(`UPDATE nodes SET current_version_id = NULL WHERE data_room_id = $1`, [
      room,
    ]);
    await manager.query(
      `DELETE FROM share_recipients
        WHERE share_id IN (SELECT id FROM shares WHERE data_room_id = $1)`,
      [room],
    );
    await manager.query(`DELETE FROM shares WHERE data_room_id = $1`, [room]);
    await manager.query(
      `DELETE FROM file_versions
        WHERE node_id IN (SELECT id FROM nodes WHERE data_room_id = $1)`,
      [room],
    );
    await manager.query(`DELETE FROM nodes WHERE data_room_id = $1`, [room]);
    await manager.query(`DELETE FROM data_rooms WHERE id = $1`, [room]);
  });

  // The three fixture users are deliberately *not* deleted: they are the identities Google signs
  // in as, and re-creating their rows would orphan every refresh token they hold, logging out a
  // browser mid-demo for no reason. `seedFixtures` inserts them with ON CONFLICT DO NOTHING.
}

async function main(): Promise<void> {
  // Imported here rather than at the top of the file: `data-source.ts` throws on a missing
  // DATABASE_URL at import time, and the test that exercises `seed()` supplies its own DataSource.
  const { default: dataSource } = await import('./data-source');
  await dataSource.initialize();

  try {
    const seeded = await seed(dataSource);
    process.stdout.write(
      `Seeded data room ${seeded.roomId} — owner ${fixtures.users.owner.email}, ` +
        `viewer ${fixtures.users.viewer.email}, public link token ${seeded.publicToken}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}\n` +
        `Is the database migrated? Run \`pnpm db:up && pnpm db:migrate\` first.\n`,
    );
    process.exitCode = 1;
  });
}
