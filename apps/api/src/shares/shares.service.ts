import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  AddRecipientsBody,
  CreateShareBody,
  ListSharesResponse,
  ResolveShareResponse,
  ShareDto,
  ShareRecipientDto,
} from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import { selectRows, updateReturning, type Queryable } from '../database/sql';

interface ShareRow {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'file';
  type: 'public_link' | 'permissioned';
  role: 'viewer';
  token: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

interface RecipientRow {
  id: string;
  shareId: string;
  email: string;
  userId: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

interface NodeForShare {
  id: string;
  dataRoomId: string;
}

interface ResolveRow {
  shareId: string;
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'file';
  role: 'viewer';
  expiresAt: Date | null;
  revokedAt: Date | null;
  nodeDeletedAt: Date | null;
  roomDeletedAt: Date | null;
  ownerName: string;
}

const sameStrings = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort();

@Injectable()
export class SharesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: AppConfig,
  ) {}

  async create(nodeId: string, createdBy: string, input: CreateShareBody): Promise<ShareDto> {
    const recipientEmails = uniqueSorted(input.recipients);
    const expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);

    const shareId = await this.dataSource.transaction(async (manager) => {
      // Serialising on the target node makes "return the identical live share" true even when two
      // owner requests arrive together. Without this lock, both could observe no match and mint.
      const [node] = await selectRows<NodeForShare>(
        manager,
        `SELECT id, data_room_id AS "dataRoomId"
           FROM nodes
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [nodeId],
      );
      if (!node) throw errors.itemGone();
      await this.rejectOwnAddress(manager, node.dataRoomId, recipientEmails);

      const existing = await this.findIdenticalLiveShare(
        manager,
        nodeId,
        input.type,
        expiresAt,
        recipientEmails,
      );
      if (existing !== null) return existing;

      const token = input.type === 'public_link' ? randomBytes(32).toString('base64url') : null;
      const [created] = await selectRows<{ id: string }>(
        manager,
        `INSERT INTO shares
           (node_id, data_room_id, type, role, token, expires_at, created_by)
         VALUES ($1, $2, $3, 'viewer', $4, $5, $6)
         RETURNING id`,
        [node.id, node.dataRoomId, input.type, token, expiresAt, createdBy],
      );
      if (!created) throw errors.internal();

      for (const email of recipientEmails) {
        await manager.query(
          `INSERT INTO share_recipients (share_id, email, user_id, accepted_at)
           SELECT $1, $2::citext, u.id, CASE WHEN u.id IS NULL THEN NULL ELSE now() END
             FROM (SELECT 1) AS singleton
             LEFT JOIN users u ON u.email = $2::citext`,
          [created.id, email],
        );
      }

      return created.id;
    });

    return this.getById(shareId);
  }

  async listForNode(nodeId: string): Promise<ListSharesResponse> {
    return { shares: await this.list(`s.node_id = $1::uuid`, [nodeId]) };
  }

  async listForRoom(roomId: string): Promise<ListSharesResponse> {
    return { shares: await this.list(`s.data_room_id = $1::uuid`, [roomId]) };
  }

  async addRecipients(shareId: string, input: AddRecipientsBody): Promise<ShareDto> {
    const emails = uniqueSorted(input.emails);

    await this.dataSource.transaction(async (manager) => {
      const [share] = await selectRows<{
        type: 'public_link' | 'permissioned';
        dataRoomId: string;
      }>(
        manager,
        `SELECT type, data_room_id AS "dataRoomId" FROM shares WHERE id = $1 FOR UPDATE`,
        [shareId],
      );
      if (!share) throw errors.notFound();
      if (share.type !== 'permissioned') {
        throw errors.validationFailed({
          emails: ['Recipients can only be added to a permissioned share.'],
        });
      }
      await this.rejectOwnAddress(manager, share.dataRoomId, emails);

      for (const email of emails) {
        await manager.query(
          `INSERT INTO share_recipients (share_id, email, user_id, accepted_at)
           SELECT $1, $2::citext, u.id, CASE WHEN u.id IS NULL THEN NULL ELSE now() END
             FROM (SELECT 1) AS singleton
             LEFT JOIN users u ON u.email = $2::citext
           ON CONFLICT (share_id, email) DO UPDATE
             SET revoked_at = NULL,
                 user_id = COALESCE(share_recipients.user_id, EXCLUDED.user_id),
                 accepted_at = COALESCE(share_recipients.accepted_at, EXCLUDED.accepted_at)`,
          [shareId, email],
        );
      }
    });

    return this.getById(shareId);
  }

  async revokeRecipient(shareId: string, recipientId: string): Promise<void> {
    const rows = await updateReturning<{ id: string }>(
      this.dataSource,
      `UPDATE share_recipients
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $2 AND share_id = $1
        RETURNING id`,
      [shareId, recipientId],
    );
    if (rows.length === 0) throw errors.notFound();
  }

  async revoke(shareId: string): Promise<void> {
    const rows = await updateReturning<{ id: string }>(
      this.dataSource,
      `UPDATE shares
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1
        RETURNING id`,
      [shareId],
    );
    if (rows.length === 0) throw errors.notFound();
  }

  async resolve(token: string): Promise<ResolveShareResponse> {
    const [row] = await selectRows<ResolveRow>(
      this.dataSource,
      `SELECT s.id          AS "shareId",
              n.id          AS "nodeId",
              n.name        AS "nodeName",
              n.type        AS "nodeType",
              s.role,
              s.expires_at  AS "expiresAt",
              s.revoked_at  AS "revokedAt",
              n.deleted_at  AS "nodeDeletedAt",
              r.deleted_at  AS "roomDeletedAt",
              u.name        AS "ownerName"
         FROM shares s
         JOIN nodes n      ON n.id = s.node_id
         JOIN data_rooms r ON r.id = s.data_room_id
         JOIN users u      ON u.id = r.owner_id
        WHERE s.type = 'public_link' AND s.token = $1`,
      [token],
    );
    if (!row) throw errors.notFound("This link isn't valid.");
    if (row.revokedAt !== null) throw errors.accessRevoked();
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw errors.shareExpired();
    }
    if (row.nodeDeletedAt !== null || row.roomDeletedAt !== null) throw errors.itemGone();

    return {
      shareId: row.shareId,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      nodeType: row.nodeType,
      role: row.role,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      ownerName: row.ownerName,
    };
  }

  /**
   * The room's owner reads every node in it through ownership, so a recipient row for their own
   * address grants nothing. Left in, it shows the owner to themselves as a stranger on the share
   * and survives a revoke, which reads as a live grant that cannot be taken away.
   *
   * This is a validity rule about the recipient list, not an access decision: who may call this
   * endpoint at all is still `OwnerGuard`'s answer alone.
   */
  private async rejectOwnAddress(
    source: Queryable,
    dataRoomId: string,
    emails: string[],
  ): Promise<void> {
    if (emails.length === 0) return;

    const [owner] = await selectRows<{ email: string }>(
      source,
      `SELECT u.email::text AS email
         FROM data_rooms d
         JOIN users u ON u.id = d.owner_id
        WHERE d.id = $1`,
      [dataRoomId],
    );
    if (!owner) throw errors.internal();

    // `Email` lowercases on the way in and `users.email` is citext, so compare case-insensitively
    // rather than letting the column type decide.
    if (emails.some((email) => email.toLowerCase() === owner.email.toLowerCase())) {
      throw errors.validationFailed({
        emails: ['You already have access to this as its owner, so you cannot invite yourself.'],
      });
    }
  }

  private async findIdenticalLiveShare(
    manager: EntityManager,
    nodeId: string,
    type: CreateShareBody['type'],
    expiresAt: Date | null,
    recipientEmails: string[],
  ): Promise<string | null> {
    const candidates = await selectRows<{ id: string }>(
      manager,
      `SELECT s.id
         FROM shares s
        WHERE s.node_id = $1
          AND s.type = $2
          AND s.expires_at IS NOT DISTINCT FROM $3::timestamptz
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
        ORDER BY s.created_at, s.id`,
      [nodeId, type, expiresAt],
    );

    if (type === 'public_link') return candidates[0]?.id ?? null;
    if (candidates.length === 0) return null;

    const rows = await selectRows<{ shareId: string; email: string }>(
      manager,
      `SELECT share_id AS "shareId", email::text AS email
         FROM share_recipients
        WHERE share_id = ANY($1::uuid[]) AND revoked_at IS NULL
        ORDER BY email`,
      [candidates.map(({ id }) => id)],
    );

    const byShare = new Map<string, string[]>();
    for (const row of rows) {
      const emails = byShare.get(row.shareId) ?? [];
      emails.push(row.email.toLowerCase());
      byShare.set(row.shareId, emails);
    }

    return (
      candidates.find(({ id }) => sameStrings(byShare.get(id) ?? [], recipientEmails))?.id ?? null
    );
  }

  private async getById(id: string): Promise<ShareDto> {
    const shares = await this.list(`s.id = $1::uuid`, [id]);
    const share = shares[0];
    if (!share) throw errors.notFound();
    return share;
  }

  private async list(scope: string, parameters: unknown[]): Promise<ShareDto[]> {
    const rows = await selectRows<ShareRow>(
      this.dataSource,
      `SELECT s.id,
              s.node_id    AS "nodeId",
              n.name       AS "nodeName",
              n.type       AS "nodeType",
              s.type,
              s.role,
              s.token,
              s.expires_at AS "expiresAt",
              s.revoked_at AS "revokedAt",
              s.created_at AS "createdAt"
         FROM shares s
         JOIN nodes n ON n.id = s.node_id
        WHERE ${scope}
        ORDER BY s.created_at DESC, s.id`,
      parameters,
    );
    if (rows.length === 0) return [];

    const recipients = await this.recipientsFor(
      this.dataSource,
      rows.map(({ id }) => id),
    );
    const byShare = new Map<string, ShareRecipientDto[]>();
    for (const recipient of recipients) {
      const items = byShare.get(recipient.shareId) ?? [];
      items.push(this.toRecipientDto(recipient));
      byShare.set(recipient.shareId, items);
    }

    return rows.map((row) => this.toShareDto(row, byShare.get(row.id) ?? []));
  }

  private recipientsFor(source: Queryable, shareIds: string[]): Promise<RecipientRow[]> {
    return selectRows<RecipientRow>(
      source,
      `SELECT id,
              share_id    AS "shareId",
              email::text AS email,
              user_id     AS "userId",
              invited_at  AS "invitedAt",
              accepted_at AS "acceptedAt",
              revoked_at  AS "revokedAt"
         FROM share_recipients
        WHERE share_id = ANY($1::uuid[])
        ORDER BY invited_at, id`,
      [shareIds],
    );
  }

  private toShareDto(row: ShareRow, recipients: ShareRecipientDto[]): ShareDto {
    return {
      id: row.id,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      nodeType: row.nodeType,
      type: row.type,
      role: row.role,
      url:
        row.type === 'public_link' && row.revokedAt === null && row.token !== null
          ? new URL(`/s/${row.token}`, this.config.webOrigin).toString()
          : null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      recipients,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRecipientDto(row: RecipientRow): ShareRecipientDto {
    return {
      id: row.id,
      email: row.email.toLowerCase(),
      userId: row.userId,
      invitedAt: row.invitedAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }
}
