import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Uuid } from '@dataroom/contracts';
import type { Identity } from '../auth/identity';
import { selectRows } from '../database/sql';
import { selfAndAncestorIds } from '../nodes/path.util';
import { denied, maskEmail, type Access } from './access';

interface NodeRow {
  id: string;
  dataRoomId: string;
  path: string;
  deletedAt: Date | null;
  ownerId: string;
  rootNodeId: string | null;
  roomDeletedAt: Date | null;
}

interface GrantRow {
  shareId: string;
  shareRootId: string;
  role: 'viewer';
}

interface DiagnosticRow {
  type: 'public_link' | 'permissioned';
  token: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  rootDeletedAt: Date | null;
  recipientEmail: string | null;
  recipientUserId: string | null;
  recipientRevokedAt: Date | null;
}

/**
 * The security boundary, in one file.
 *
 * Two properties are non-negotiable:
 *
 * 1. **Nothing is cached.** No grant table, no in-memory map, no claim baked into the access
 *    token. Revocation has to take effect on the very next request, and a cache is exactly how
 *    that promise gets quietly broken.
 * 2. **A share whose own root node is soft-deleted is dead**, even when the requested node still
 *    exists — enforced by joining `nodes` on the share root and filtering `deleted_at IS NULL`.
 *
 * The ancestor set comes from `nodes.path`, which is already in memory after the first query, so
 * "is there a share on this node or any of its ancestors" is an indexed `= ANY(...)` rather than a
 * recursive walk.
 */
@Injectable()
export class PermissionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(identity: Identity, nodeId: string): Promise<Access> {
    if (!Uuid.safeParse(nodeId).success) return denied('NOT_FOUND');

    const [node] = await selectRows<NodeRow>(
      this.dataSource,
      `SELECT n.id,
              n.data_room_id AS "dataRoomId",
              n.path,
              n.deleted_at   AS "deletedAt",
              r.owner_id     AS "ownerId",
              r.root_node_id AS "rootNodeId",
              r.deleted_at   AS "roomDeletedAt"
         FROM nodes n
         JOIN data_rooms r ON r.id = n.data_room_id
        WHERE n.id = $1`,
      [nodeId],
    );

    if (!node) return denied('NOT_FOUND');
    // Distinct from NOT_FOUND on purpose: this is the "deleted while you were looking at it" case,
    // and it gets an honest message plus a route back to the share root.
    if (node.deletedAt !== null || node.roomDeletedAt !== null) return denied('ITEM_GONE');

    if (identity.kind === 'user' && identity.userId === node.ownerId) {
      return {
        granted: true,
        role: 'owner',
        shareRootId: node.rootNodeId ?? node.id,
        shareId: null,
      };
    }

    const candidateIds = selfAndAncestorIds(node.path);
    const token = identity.kind === 'anonymous' ? identity.shareToken : null;
    const userId = identity.kind === 'user' ? identity.userId : null;
    const email = identity.kind === 'user' ? identity.email : null;

    const [grant] = await selectRows<GrantRow>(
      this.dataSource,
      `SELECT s.id      AS "shareId",
              s.node_id AS "shareRootId",
              s.role
         FROM shares s
         JOIN nodes sn ON sn.id = s.node_id AND sn.deleted_at IS NULL
         LEFT JOIN share_recipients rec ON rec.share_id = s.id AND rec.revoked_at IS NULL
        WHERE s.node_id = ANY($1::uuid[])
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND (
                (s.type = 'public_link'  AND $2::text IS NOT NULL AND s.token = $2::text)
             OR (s.type = 'permissioned' AND (
                      ($3::uuid IS NOT NULL AND rec.user_id = $3::uuid)
                   OR ($4::text IS NOT NULL AND rec.email   = $4::text)
                 ))
          )
        ORDER BY s.role DESC
        LIMIT 1`,
      [candidateIds, token, userId, email],
    );

    if (grant) {
      return {
        granted: true,
        role: 'viewer',
        shareRootId: grant.shareRootId,
        shareId: grant.shareId,
      };
    }

    return this.explainDenial(`s.node_id = ANY($1::uuid[])`, [candidateIds], token, userId, email, {
      // Node scope: reaching here means the caller already holds the exact id that was shared —
      // overwhelmingly "I opened the link they sent me, in the wrong browser profile".
      allowWrongAccount: true,
    });
  }

  /**
   * Access to a *room*, which is not the same question as access to its root node: a recipient
   * holding one nested folder has access to the room but not to its root, and resolving through the
   * root would deny them their own sidebar entry.
   */
  async resolveRoom(identity: Identity, roomId: string): Promise<Access> {
    if (!Uuid.safeParse(roomId).success) return denied('NOT_FOUND');

    const [room] = await selectRows<{
      ownerId: string;
      rootNodeId: string | null;
      deletedAt: Date | null;
    }>(
      this.dataSource,
      `SELECT owner_id AS "ownerId", root_node_id AS "rootNodeId", deleted_at AS "deletedAt"
         FROM data_rooms WHERE id = $1`,
      [roomId],
    );

    if (!room?.rootNodeId) return denied('NOT_FOUND');
    if (room.deletedAt !== null) return denied('ITEM_GONE');

    if (identity.kind === 'user' && identity.userId === room.ownerId) {
      return { granted: true, role: 'owner', shareRootId: room.rootNodeId, shareId: null };
    }

    const token = identity.kind === 'anonymous' ? identity.shareToken : null;
    const userId = identity.kind === 'user' ? identity.userId : null;
    const email = identity.kind === 'user' ? identity.email : null;

    const [grant] = await selectRows<GrantRow>(
      this.dataSource,
      `SELECT s.id      AS "shareId",
              s.node_id AS "shareRootId",
              s.role
         FROM shares s
         JOIN nodes sn ON sn.id = s.node_id AND sn.deleted_at IS NULL
         LEFT JOIN share_recipients rec ON rec.share_id = s.id AND rec.revoked_at IS NULL
        WHERE s.data_room_id = $1::uuid
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND (
                (s.type = 'public_link'  AND $2::text IS NOT NULL AND s.token = $2::text)
             OR (s.type = 'permissioned' AND (
                      ($3::uuid IS NOT NULL AND rec.user_id = $3::uuid)
                   OR ($4::text IS NOT NULL AND rec.email   = $4::text)
                 ))
          )
        -- Shallowest share first: it is the widest entry point the caller holds in this room.
        ORDER BY s.role DESC, sn.depth ASC
        LIMIT 1`,
      [roomId, token, userId, email],
    );

    if (grant) {
      return {
        granted: true,
        role: 'viewer',
        shareRootId: grant.shareRootId,
        shareId: grant.shareId,
      };
    }

    // Room scope deliberately never answers WRONG_ACCOUNT: a room id is a much weaker credential
    // than the id of the folder that was actually shared, and reporting whose address holds a share
    // *somewhere* in the room would disclose it to anyone who can name the room.
    return this.explainDenial(`s.data_room_id = $1::uuid`, [roomId], token, userId, email, {
      allowWrongAccount: false,
    });
  }

  /**
   * No grant matched. *Why* matters, so the caller is told whether to ask for access again, sign in
   * as someone else, or give up — which is the whole reason `Access` carries a reason.
   */
  private async explainDenial(
    scope: string,
    scopeParams: unknown[],
    token: string | null,
    userId: string | null,
    email: string | null,
    options: { allowWrongAccount: boolean },
  ): Promise<Access> {
    const rows = await selectRows<DiagnosticRow>(
      this.dataSource,
      `SELECT s.type,
              s.token,
              s.revoked_at   AS "revokedAt",
              s.expires_at   AS "expiresAt",
              sn.deleted_at  AS "rootDeletedAt",
              rec.email      AS "recipientEmail",
              rec.user_id    AS "recipientUserId",
              rec.revoked_at AS "recipientRevokedAt"
         FROM shares s
         JOIN nodes sn ON sn.id = s.node_id
         LEFT JOIN share_recipients rec ON rec.share_id = s.id
        WHERE ${scope}`,
      scopeParams,
    );

    const addressedToCaller = rows.filter((row) => {
      if (row.type === 'public_link') return token !== null && row.token === token;
      if (row.recipientUserId !== null && userId !== null) return row.recipientUserId === userId;
      if (row.recipientEmail !== null && email !== null) {
        return row.recipientEmail.toLowerCase() === email.toLowerCase();
      }
      return false;
    });

    const now = Date.now();
    if (
      addressedToCaller.some((row) => row.revokedAt !== null || row.recipientRevokedAt !== null)
    ) {
      return denied('ACCESS_REVOKED');
    }
    if (addressedToCaller.some((row) => row.expiresAt !== null && row.expiresAt.getTime() <= now)) {
      return denied('SHARE_EXPIRED');
    }
    if (addressedToCaller.some((row) => row.rootDeletedAt !== null)) {
      return denied('ITEM_GONE');
    }

    // A live invitation exists here, addressed to somebody else. If the caller is signed in, this
    // is overwhelmingly the "wrong Google profile in this browser" case, which deserves its own
    // screen rather than a bare 403.
    if (options.allowWrongAccount && userId !== null) {
      const otherInvite = rows.find(
        (row) =>
          row.type === 'permissioned' &&
          row.revokedAt === null &&
          row.recipientRevokedAt === null &&
          row.rootDeletedAt === null &&
          (row.expiresAt === null || row.expiresAt.getTime() > now) &&
          row.recipientEmail !== null,
      );
      if (otherInvite?.recipientEmail) {
        return denied('WRONG_ACCOUNT', maskEmail(otherInvite.recipientEmail));
      }
    }

    return denied('FORBIDDEN');
  }

  async nodeIdOfShare(shareId: string): Promise<string | null> {
    if (!Uuid.safeParse(shareId).success) return null;
    const [row] = await selectRows<{ nodeId: string }>(
      this.dataSource,
      `SELECT node_id AS "nodeId" FROM shares WHERE id = $1`,
      [shareId],
    );
    return row?.nodeId ?? null;
  }

  async nodeIdOfVersion(versionId: string): Promise<string | null> {
    if (!Uuid.safeParse(versionId).success) return null;
    const [row] = await selectRows<{ nodeId: string }>(
      this.dataSource,
      `SELECT node_id AS "nodeId" FROM file_versions WHERE id = $1`,
      [versionId],
    );
    return row?.nodeId ?? null;
  }
}
