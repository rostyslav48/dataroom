import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtures } from '@dataroom/contracts';
import type { Identity } from '../../src/auth/identity';
import { seedFixtures, type SeededFixtures } from '../../src/database/seed-fixtures';
import { buildPath, rootPath } from '../../src/nodes/path.util';
import { PermissionService } from '../../src/permissions/permission.service';
import type { Access } from '../../src/permissions/access';
import { createTestDataSource, resetDatabase } from '../support/database';

/**
 * The permission matrix — the highest-value test in the project, and written before the module it
 * describes, because the matrix *is* the specification of correct behaviour. Written afterwards it
 * would only assert whatever was built.
 *
 * Exhaustive over four axes: identity × the requested node's relationship to the share root ×
 * share state × share type. Every cell asserts an **exact** `Access`, including the failure reason,
 * because the reason is part of the contract — the UI branches on it.
 */
/** Tokens are 256-bit base64url in production; the schema enforces a minimum length. */
const ROOM_WIDE_TOKEN = 'ROOMWIDETOKEN000000000000000000000000000000';
const REVOKED_TOKEN = 'REVOKEDTOKEN0000000000000000000000000000000';

describe('permission matrix', () => {
  let dataSource: DataSource;
  let permissions: PermissionService;
  let seeded: SeededFixtures;
  let otherRoomNodeId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    permissions = new PermissionService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    seeded = await seedFixtures(dataSource);

    // A second room, owned by the stranger: the "different data room entirely" relationship.
    const otherRoomId = randomUUID();
    otherRoomNodeId = randomUUID();
    await dataSource.query(`INSERT INTO data_rooms (id, owner_id, name) VALUES ($1, $2, 'Other')`, [
      otherRoomId,
      seeded.strangerId,
    ]);
    await dataSource.query(
      `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
       VALUES ($1, $2, NULL, 'folder', 'Other', $3, 0, $4)`,
      [otherRoomNodeId, otherRoomId, rootPath(otherRoomNodeId), seeded.strangerId],
    );
  });

  // ── identities ───────────────────────────────────────────────────────────────
  const identities = (): Record<string, Identity> => ({
    owner: {
      kind: 'user',
      userId: seeded.ownerId,
      email: fixtures.users.owner.email,
      shareToken: null,
    },
    recipient: {
      kind: 'user',
      userId: seeded.viewerId,
      email: fixtures.users.viewer.email,
      shareToken: null,
    },
    stranger: {
      kind: 'user',
      userId: seeded.strangerId,
      email: fixtures.users.stranger.email,
      shareToken: null,
    },
    // A signed-in visitor who followed a public link: the ordinary case, since most people are
    // signed into something.
    strangerWithLink: {
      kind: 'user',
      userId: seeded.strangerId,
      email: fixtures.users.stranger.email,
      shareToken: fixtures.PUBLIC_LINK_TOKEN,
    },
    anonymousWithToken: { kind: 'anonymous', shareToken: fixtures.PUBLIC_LINK_TOKEN },
    anonymousBadToken: { kind: 'anonymous', shareToken: 'not-a-real-token' },
    anonymousNoToken: { kind: 'anonymous', shareToken: null },
  });

  // ── share states ─────────────────────────────────────────────────────────────
  const states: Record<string, (shareId: string, shareRootId: string) => Promise<void>> = {
    live: async () => {},
    revoked: async (shareId) => {
      await dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [shareId]);
    },
    expired: async (shareId) => {
      await dataSource.query(
        `UPDATE shares SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [shareId],
      );
    },
    shareRootDeleted: async (_shareId, shareRootId) => {
      await dataSource.query(`UPDATE nodes SET deleted_at = now() WHERE id = $1`, [shareRootId]);
    },
  };

  const granted = (role: 'owner' | 'viewer', shareRootId: string, shareId: string | null = null) =>
    ({ granted: true, role, shareRootId, shareId }) satisfies Access;

  /**
   * `toEqual`, not `toMatchObject`: SPEC-05 requires every cell to assert an *exact* `Access`. A
   * subset match would let an extra field — a leaked email hint, a stale shareId — ride along
   * unnoticed, which is the class of bug this matrix exists to catch.
   */
  const expectAccess = async (identity: Identity, nodeId: string, expected: Access) => {
    const access = await permissions.resolve(identity, nodeId);
    expect(access).toEqual(expected);
  };

  describe('public link on Financials', () => {
    describe('live', () => {
      it('grants the anonymous holder the share root and every descendant', async () => {
        const anon = identities().anonymousWithToken as Identity;
        await expectAccess(anon, seeded.financialsId, granted('viewer', seeded.financialsId, seeded.publicShareId));
        await expectAccess(anon, seeded.q3Id, granted('viewer', seeded.financialsId, seeded.publicShareId));
        await expectAccess(anon, seeded.balanceId, granted('viewer', seeded.financialsId, seeded.publicShareId));
      });

      it('denies the share root’s parent — ancestor names must not leak', async () => {
        await expectAccess(identities().anonymousWithToken as Identity, seeded.rootNodeId, {
          granted: false as const,
          reason: 'FORBIDDEN',
        });
      });

      it('denies a sibling subtree and a file outside the share', async () => {
        const anon = identities().anonymousWithToken as Identity;
        await expectAccess(anon, seeded.legalId, { granted: false, reason: 'FORBIDDEN' });
        await expectAccess(anon, seeded.overviewId, { granted: false, reason: 'FORBIDDEN' });
      });

      it('denies another data room entirely', async () => {
        await expectAccess(identities().anonymousWithToken as Identity, otherRoomNodeId, {
          granted: false as const,
          reason: 'FORBIDDEN',
        });
      });

      it.each(['anonymousBadToken', 'anonymousNoToken'] as const)(
        'denies %s even on the share root',
        async (key) => {
          await expectAccess(identities()[key] as Identity, seeded.financialsId, {
            granted: false,
            reason: 'FORBIDDEN',
          });
        },
      );

      it('grants a signed-in visitor who followed the link', async () => {
        // Most people are signed into something, so this is the ordinary way a public link is
        // opened — not an exotic case. Dropping the token for authenticated callers would deny them
        // a link that works fine in a private window.
        const signedIn = identities().strangerWithLink as Identity;
        await expectAccess(
          signedIn,
          seeded.q3Id,
          granted('viewer', seeded.financialsId, seeded.publicShareId),
        );
        // …and it grants exactly what the link grants, nothing wider.
        await expectAccess(signedIn, seeded.overviewId, { granted: false, reason: 'FORBIDDEN' });
      });

      it('grants the owner everything regardless of the share', async () => {
        const owner = identities().owner as Identity;
        for (const nodeId of [
          seeded.rootNodeId,
          seeded.legalId,
          seeded.financialsId,
          seeded.q3Id,
          seeded.ndaId,
          seeded.balanceId,
          seeded.overviewId,
        ]) {
          await expectAccess(owner, nodeId, granted('owner', seeded.rootNodeId, null));
        }
      });

      it('denies the owner in someone else’s room', async () => {
        await expectAccess(identities().owner as Identity, otherRoomNodeId, {
          granted: false as const,
          reason: 'FORBIDDEN',
        });
      });
    });

    describe('revoked', () => {
      beforeEach(async () => {
        await states.revoked!(seeded.publicShareId, seeded.financialsId);
      });

      it('tells the holder their access was revoked, not merely forbidden', async () => {
        const anon = identities().anonymousWithToken as Identity;
        await expectAccess(anon, seeded.financialsId, {
          granted: false as const,
          reason: 'ACCESS_REVOKED',
        });
        await expectAccess(anon, seeded.balanceId, { granted: false, reason: 'ACCESS_REVOKED' });
      });

      it('takes effect on the very next request — nothing is cached', async () => {
        // Re-grant, confirm, revoke again, confirm: same service instance, no restart.
        await dataSource.query(`UPDATE shares SET revoked_at = NULL WHERE id = $1`, [
          seeded.publicShareId,
        ]);
        await expectAccess(
          identities().anonymousWithToken as Identity,
          seeded.q3Id,
          granted('viewer', seeded.financialsId, seeded.publicShareId),
        );

        await dataSource.query(`UPDATE shares SET revoked_at = now() WHERE id = $1`, [
          seeded.publicShareId,
        ]);
        await expectAccess(identities().anonymousWithToken as Identity, seeded.q3Id, {
          granted: false as const,
          reason: 'ACCESS_REVOKED',
        });
      });

      it('still grants the owner', async () => {
        await expectAccess(
          identities().owner as Identity,
          seeded.financialsId,
          granted('owner', seeded.rootNodeId, null),
        );
      });
    });

    describe('expired', () => {
      beforeEach(async () => {
        await states.expired!(seeded.publicShareId, seeded.financialsId);
      });

      it('is distinct from revoked, because the user needs to know which happened', async () => {
        const anon = identities().anonymousWithToken as Identity;
        await expectAccess(anon, seeded.financialsId, { granted: false, reason: 'SHARE_EXPIRED' });
        await expectAccess(anon, seeded.q3Id, { granted: false, reason: 'SHARE_EXPIRED' });
      });
    });

    describe('share root soft-deleted', () => {
      beforeEach(async () => {
        await states.shareRootDeleted!(seeded.publicShareId, seeded.financialsId);
      });

      it('kills the share even for a descendant that still exists', async () => {
        const anon = identities().anonymousWithToken as Identity;
        await expectAccess(anon, seeded.financialsId, { granted: false, reason: 'ITEM_GONE' });
        await expectAccess(anon, seeded.q3Id, { granted: false, reason: 'ITEM_GONE' });
        await expectAccess(anon, seeded.balanceId, { granted: false, reason: 'ITEM_GONE' });
      });
    });

    describe('requested node soft-deleted', () => {
      beforeEach(async () => {
        await dataSource.query(`UPDATE nodes SET deleted_at = now() WHERE id = $1`, [seeded.q3Id]);
      });

      it.each(['owner', 'anonymousWithToken'] as const)('is ITEM_GONE for %s', async (key) => {
        await expectAccess(identities()[key] as Identity, seeded.q3Id, {
          granted: false as const,
          reason: 'ITEM_GONE',
        });
      });
    });
  });

  describe('permissioned share on Legal', () => {
    describe('live', () => {
      it('grants the recipient the share root and its descendants', async () => {
        const recipient = identities().recipient as Identity;
        await expectAccess(recipient, seeded.legalId, granted('viewer', seeded.legalId, seeded.permissionedShareId));
        await expectAccess(recipient, seeded.ndaId, granted('viewer', seeded.legalId, seeded.permissionedShareId));
      });

      it('denies the recipient the parent, a sibling subtree, and a loose file', async () => {
        const recipient = identities().recipient as Identity;
        for (const nodeId of [seeded.rootNodeId, seeded.financialsId, seeded.overviewId]) {
          await expectAccess(recipient, nodeId, { granted: false, reason: 'FORBIDDEN' });
        }
      });

      it('matches by email when the invitation has not been claimed yet', async () => {
        await dataSource.query(`UPDATE share_recipients SET user_id = NULL WHERE share_id = $1`, [
          seeded.permissionedShareId,
        ]);
        await expectAccess(
          identities().recipient as Identity,
          seeded.legalId,
          granted('viewer', seeded.legalId, seeded.permissionedShareId),
        );
      });

      it('tells a signed-in stranger it is the wrong account, and nothing more', async () => {
        const access = await permissions.resolve(identities().stranger as Identity, seeded.legalId);
        // The reason is disclosed so the UI can offer "switch account"; the invited address is not,
        // even masked — reaching here needs only a node id and any session, so returning it would
        // turn a forwarded link into an address-harvesting oracle.
        expect(access).toEqual({ granted: false, reason: 'WRONG_ACCOUNT' });
      });

      it('does not accept a link token for a permissioned share', async () => {
        await expectAccess(identities().anonymousWithToken as Identity, seeded.legalId, {
          granted: false as const,
          reason: 'FORBIDDEN',
        });
      });

      it('denies an anonymous caller outright', async () => {
        await expectAccess(identities().anonymousNoToken as Identity, seeded.ndaId, {
          granted: false as const,
          reason: 'FORBIDDEN',
        });
      });
    });

    describe('revoked', () => {
      it('reports ACCESS_REVOKED when the share is revoked', async () => {
        await states.revoked!(seeded.permissionedShareId, seeded.legalId);
        await expectAccess(identities().recipient as Identity, seeded.ndaId, {
          granted: false as const,
          reason: 'ACCESS_REVOKED',
        });
      });

      it('reports ACCESS_REVOKED when only that one recipient is revoked', async () => {
        await dataSource.query(
          `UPDATE share_recipients SET revoked_at = now() WHERE share_id = $1`,
          [seeded.permissionedShareId],
        );
        await expectAccess(identities().recipient as Identity, seeded.legalId, {
          granted: false as const,
          reason: 'ACCESS_REVOKED',
        });
      });
    });

    describe('expired', () => {
      it('reports SHARE_EXPIRED', async () => {
        await states.expired!(seeded.permissionedShareId, seeded.legalId);
        await expectAccess(identities().recipient as Identity, seeded.ndaId, {
          granted: false as const,
          reason: 'SHARE_EXPIRED',
        });
      });
    });

    describe('share root soft-deleted', () => {
      it('reports ITEM_GONE for a surviving descendant', async () => {
        await states.shareRootDeleted!(seeded.permissionedShareId, seeded.legalId);
        await expectAccess(identities().recipient as Identity, seeded.ndaId, {
          granted: false as const,
          reason: 'ITEM_GONE',
        });
      });
    });
  });

  describe('composition', () => {
    it('resolves overlapping shares to the one that granted, reporting its root', async () => {
      // A second, room-wide public link: the deeper share root wins for a node under both only if
      // it is the row the query returns — assert the resolved shareRootId explicitly.
      const roomWideId = randomUUID();
      await dataSource.query(
        `INSERT INTO shares (id, node_id, data_room_id, type, role, token, created_by)
         VALUES ($1, $2, $3, 'public_link', 'viewer', $4, $5)`,
        [roomWideId, seeded.rootNodeId, seeded.roomId, ROOM_WIDE_TOKEN, seeded.ownerId],
      );

      const roomWide: Identity = { kind: 'anonymous', shareToken: ROOM_WIDE_TOKEN };
      await expectAccess(
        roomWide,
        seeded.overviewId,
        granted('viewer', seeded.rootNodeId, roomWideId),
      );
      await expectAccess(
        roomWide,
        seeded.balanceId,
        granted('viewer', seeded.rootNodeId, roomWideId),
      );

      // The narrower link still resolves to its own root, so breadcrumbs stay truncated there.
      await expectAccess(
        identities().anonymousWithToken as Identity,
        seeded.balanceId,
        granted('viewer', seeded.financialsId, seeded.publicShareId),
      );
    });

    it('keeps the live share granting when a second share on the same node is revoked', async () => {
      const secondId = randomUUID();
      await dataSource.query(
        `INSERT INTO shares (id, node_id, data_room_id, type, role, token, created_by, revoked_at)
         VALUES ($1, $2, $3, 'public_link', 'viewer', $4, $5, now())`,
        [secondId, seeded.financialsId, seeded.roomId, REVOKED_TOKEN, seeded.ownerId],
      );

      await expectAccess(
        identities().anonymousWithToken as Identity,
        seeded.q3Id,
        granted('viewer', seeded.financialsId, seeded.publicShareId),
      );
      await expectAccess({ kind: 'anonymous', shareToken: REVOKED_TOKEN }, seeded.q3Id, {
        granted: false,
        reason: 'ACCESS_REVOKED',
      });
    });

    it('follows the node when a shared folder is moved, because it targets an id not a path', async () => {
      // Move Financials under Legal: paths change, the share does not.
      const newPath = buildPath(
        buildPath(rootPath(seeded.rootNodeId), seeded.legalId),
        seeded.financialsId,
      );
      await dataSource.query(
        `UPDATE nodes SET parent_id = $2, path = $3, depth = 2 WHERE id = $1`,
        [seeded.financialsId, seeded.legalId, newPath],
      );
      await dataSource.query(
        `UPDATE nodes SET path = $2, depth = 3 WHERE id = $1`,
        [seeded.q3Id, buildPath(newPath, seeded.q3Id)],
      );

      await expectAccess(
        identities().anonymousWithToken as Identity,
        seeded.q3Id,
        granted('viewer', seeded.financialsId, seeded.publicShareId),
      );
    });

    it('returns NOT_FOUND for an unknown id and for a malformed one, never a 500', async () => {
      await expectAccess(identities().owner as Identity, randomUUID(), {
        granted: false,
        reason: 'NOT_FOUND',
      });
      await expectAccess(identities().owner as Identity, 'not-a-uuid', {
        granted: false,
        reason: 'NOT_FOUND',
      });
    });

    it('denies everything in a soft-deleted data room', async () => {
      await dataSource.query(`UPDATE data_rooms SET deleted_at = now() WHERE id = $1`, [
        seeded.roomId,
      ]);
      await expectAccess(identities().owner as Identity, seeded.legalId, {
        granted: false,
        reason: 'ITEM_GONE',
      });
    });
  });
});
