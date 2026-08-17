import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DataRoomDto, ListDataRoomsResponse } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { selectRows } from '../database/sql';
import { rootPath } from '../nodes/path.util';
import type { AccessGranted } from '../permissions/access';

interface RoomRow {
  id: string;
  name: string;
  rootNodeId: string;
  ownerId: string;
  ownerName: string;
  sizeBytes: string;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (row: RoomRow, access: 'owner' | 'viewer'): DataRoomDto => ({
  id: row.id,
  name: row.name,
  rootNodeId: row.rootNodeId,
  ownerId: row.ownerId,
  ownerName: row.ownerName,
  access,
  fileCount: Number(row.fileCount),
  sizeBytes: Number(row.sizeBytes),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class DataRoomsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Two queries, one response, each row flagged by `access`.
   *
   * A room shared with you enters at **your share root**, not at the room's root — you cannot read
   * the room root, so pointing the sidebar there would produce a link that 403s. Its counts are the
   * share root's counts for the same reason: the room's totals would disclose the size of content
   * outside your grant.
   */
  async list(userId: string, email: string): Promise<ListDataRoomsResponse> {
    const owned = await selectRows<RoomRow>(
      this.dataSource,
      `SELECT r.id,
              r.name,
              r.root_node_id             AS "rootNodeId",
              r.owner_id                 AS "ownerId",
              u.name                     AS "ownerName",
              root.subtree_size_bytes::text AS "sizeBytes",
              root.subtree_file_count    AS "fileCount",
              r.created_at               AS "createdAt",
              r.updated_at               AS "updatedAt"
         FROM data_rooms r
         JOIN users u   ON u.id = r.owner_id
         JOIN nodes root ON root.id = r.root_node_id AND root.deleted_at IS NULL
        WHERE r.owner_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC`,
      [userId],
    );

    const sharedWithMe = await selectRows<RoomRow>(
      this.dataSource,
      `SELECT DISTINCT ON (r.id)
              r.id,
              r.name,
              sn.id        AS "rootNodeId",
              r.owner_id   AS "ownerId",
              u.name       AS "ownerName",
              (CASE WHEN sn.type = 'file' THEN COALESCE(sn.size_bytes, 0)
                    ELSE sn.subtree_size_bytes END)::text AS "sizeBytes",
              (CASE WHEN sn.type = 'file' THEN 1 ELSE sn.subtree_file_count END) AS "fileCount",
              r.created_at AS "createdAt",
              r.updated_at AS "updatedAt"
         FROM shares s
         JOIN share_recipients rec ON rec.share_id = s.id AND rec.revoked_at IS NULL
         JOIN nodes sn      ON sn.id = s.node_id AND sn.deleted_at IS NULL
         JOIN data_rooms r  ON r.id = s.data_room_id AND r.deleted_at IS NULL
         JOIN users u       ON u.id = r.owner_id
        WHERE s.type = 'permissioned'
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND (rec.user_id = $1::uuid OR rec.email = $2::text)
          AND r.owner_id <> $1::uuid
        -- Several shares in one room collapse to a single entry at the shallowest of them; a room
        -- listed twice under the same id would be a duplicate the UI cannot key apart.
        ORDER BY r.id, sn.depth ASC, sn.name ASC`,
      [userId, email],
    );

    return {
      owned: owned.map((row) => toDto(row, 'owner')),
      sharedWithMe: sharedWithMe.map((row) => toDto(row, 'viewer')),
    };
  }

  async get(roomId: string, access: AccessGranted): Promise<DataRoomDto> {
    const [row] = await selectRows<RoomRow>(
      this.dataSource,
      `SELECT r.id,
              r.name,
              entry.id                     AS "rootNodeId",
              r.owner_id                   AS "ownerId",
              u.name                       AS "ownerName",
              (CASE WHEN entry.type = 'file' THEN COALESCE(entry.size_bytes, 0)
                    ELSE entry.subtree_size_bytes END)::text AS "sizeBytes",
              (CASE WHEN entry.type = 'file' THEN 1 ELSE entry.subtree_file_count END) AS "fileCount",
              r.created_at                 AS "createdAt",
              r.updated_at                 AS "updatedAt"
         FROM data_rooms r
         JOIN users u    ON u.id = r.owner_id
         JOIN nodes entry ON entry.id = $2 AND entry.deleted_at IS NULL
        WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [roomId, access.shareRootId],
    );

    if (!row) throw errors.itemGone();
    return toDto(row, access.role);
  }

  /**
   * Room and root node are created together or not at all.
   *
   * Three statements because the reference is circular — the room points at its root node and the
   * node points back at the room — which is also the only place in the schema that needs this.
   */
  async create(userId: string, name: string): Promise<DataRoomDto> {
    const roomId = randomUUID();
    const nodeId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`INSERT INTO data_rooms (id, owner_id, name) VALUES ($1, $2, $3)`, [
        roomId,
        userId,
        name,
      ]);
      await manager.query(
        `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, $2, NULL, 'folder', $3, $4, 0, $5)`,
        [nodeId, roomId, name, rootPath(nodeId), userId],
      );
      await manager.query(`UPDATE data_rooms SET root_node_id = $2 WHERE id = $1`, [
        roomId,
        nodeId,
      ]);
    });

    return this.get(roomId, { granted: true, role: 'owner', shareRootId: nodeId, shareId: null });
  }

  /** The room and its root node share a name; renaming one renames both. */
  async rename(roomId: string, name: string): Promise<DataRoomDto> {
    const rootNodeId = await this.dataSource.transaction(async (manager) => {
      const rows = await selectRows<{ rootNodeId: string | null }>(
        manager,
        `SELECT root_node_id AS "rootNodeId" FROM data_rooms WHERE id = $1 AND deleted_at IS NULL`,
        [roomId],
      );
      const id = rows[0]?.rootNodeId;
      if (!id) throw errors.itemGone();

      await manager.query(`UPDATE data_rooms SET name = $2, updated_at = now() WHERE id = $1`, [
        roomId,
        name,
      ]);
      await manager.query(`UPDATE nodes SET name = $2, updated_at = now() WHERE id = $1`, [
        id,
        name,
      ]);
      return id;
    });

    return this.get(roomId, {
      granted: true,
      role: 'owner',
      shareRootId: rootNodeId,
      shareId: null,
    });
  }

  /** Soft delete: every share in the room is revoked, and every node goes with it. */
  async softDelete(roomId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE shares SET revoked_at = now() WHERE data_room_id = $1 AND revoked_at IS NULL`,
        [roomId],
      );
      await manager.query(
        `UPDATE nodes SET deleted_at = now(), updated_at = now()
          WHERE data_room_id = $1 AND deleted_at IS NULL`,
        [roomId],
      );
      await manager.query(
        `UPDATE data_rooms SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [roomId],
      );
    });
  }
}
