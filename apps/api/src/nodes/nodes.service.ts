import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import {
  type BreadcrumbDto,
  type DeletePreviewDto,
  type ListChildrenQuery,
  type ListChildrenResponse,
  type NodeDetailResponse,
  type NodeDto,
  type NodeSortField,
  type NodeStatsDto,
} from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { decodeCursor, encodeCursor, type CursorPayload } from '../common/cursor';
import { selectRows, updateReturning } from '../database/sql';
import type { AccessGranted } from '../permissions/access';
import { NODE_COLUMNS, toNodeDto, type NodeRow } from './node.row';
import {
  ancestorIds,
  buildPath,
  depthOf,
  isDescendantOf,
  likePrefix,
  selfAndAncestorIds,
} from './path.util';

interface SortSpec {
  /** SQL expression the page is ordered by, within a type group. */
  expression: string;
  cast: string;
}

/**
 * The sort key comes back from Postgres as text alongside the row, and goes into the cursor
 * unchanged.
 *
 * Deriving it in JavaScript instead would silently lose precision: `timestamptz` has microsecond
 * resolution and a JS `Date` has milliseconds, so a cursor built from `updatedAt.toISOString()`
 * truncates — and every row falling inside the truncated microsecond is skipped on the next page.
 * That is a data-loss bug that only appears under a `updatedAt` sort with dense timestamps, which
 * is exactly the case a manual test never reproduces.
 */
interface ListRow extends NodeRow {
  sortKey: string;
}

/**
 * Folders always sort before files, whatever the requested sort — that is not configurable, and the
 * table header does not offer it, because a listing that interleaves them is harder to scan and the
 * index that serves this query is built for it.
 */
const SORTS: Record<NodeSortField, SortSpec> = {
  name: { expression: 'lower(n.name)', cast: 'text' },
  // Files carry their own size; folders carry their cached subtree size. Within a type group
  // exactly one of the two is meaningful, which is why this COALESCE is safe.
  size: { expression: 'COALESCE(n.size_bytes, n.subtree_size_bytes)', cast: 'bigint' },
  updatedAt: { expression: 'n.updated_at', cast: 'timestamptz' },
};

@Injectable()
export class NodesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ── reads ──────────────────────────────────────────────────────────────────

  async findRow(nodeId: string, manager?: EntityManager): Promise<NodeRow | null> {
    const [row] = await selectRows<NodeRow>(
      manager ?? this.dataSource,
      `SELECT ${NODE_COLUMNS} FROM nodes n WHERE n.id = $1 AND n.deleted_at IS NULL`,
      [nodeId],
    );
    return row ?? null;
  }

  async requireRow(nodeId: string, manager?: EntityManager): Promise<NodeRow> {
    const row = await this.findRow(nodeId, manager);
    if (!row) throw errors.itemGone();
    return row;
  }

  async getDetail(nodeId: string, access: AccessGranted): Promise<NodeDetailResponse> {
    const node = await this.requireRow(nodeId);

    const [room] = await selectRows<{ name: string }>(
      this.dataSource,
      `SELECT name FROM data_rooms WHERE id = $1`,
      [node.dataRoomId],
    );

    return {
      node: toNodeDto(node),
      breadcrumbs: await this.breadcrumbs(node, access.shareRootId),
      access: access.role,
      shareRootId: access.shareRootId,
      dataRoomName: room?.name ?? '',
    };
  }

  /**
   * Root-first, ending with the node itself, and **truncated at the caller's share root**.
   *
   * The truncation is not cosmetic. A viewer given one nested folder must not learn the names of
   * its ancestors — the folder structure of an acquisition target is itself confidential.
   */
  private async breadcrumbs(node: NodeRow, shareRootId: string): Promise<BreadcrumbDto[]> {
    const ids = selfAndAncestorIds(node.path);
    const rows = await selectRows<BreadcrumbDto>(
      this.dataSource,
      `SELECT id, name, type FROM nodes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((row): row is BreadcrumbDto => row !== undefined);

    const start = ordered.findIndex((crumb) => crumb.id === shareRootId);
    // If the share root is somehow not on this node's path, disclose nothing above the node itself.
    if (start === -1) return ordered.slice(-1);
    return ordered.slice(start);
  }

  async listChildren(
    parentId: string,
    query: ListChildrenQuery,
    _access: AccessGranted,
  ): Promise<ListChildrenResponse> {
    if (query.q !== undefined) {
      // Filename search across the subtree is designed but not built — see the README's
      // "how we would add it". The contract permits this until it ships, and the frontend does not
      // render a search input, because a visible control that 404s is worse than no control.
      throw errors.notFound('Search is not available yet.');
    }

    const sort = SORTS[query.sort];
    const direction = query.dir === 'desc' ? 'DESC' : 'ASC';
    const comparator = query.dir === 'desc' ? '<' : '>';

    const params: unknown[] = [parentId];
    let keyset = '';

    if (query.cursor !== undefined) {
      const cursor: CursorPayload = decodeCursor(query.cursor);
      const sortValue = cursor.sortValue ?? cursor.name;
      params.push(cursor.type, sortValue, cursor.id);
      // Folders before files always, so the type comparison is unconditionally ascending; the
      // requested direction applies only *within* a type group. The id tiebreak stays ascending so
      // two rows with identical sort keys can never repeat or skip.
      keyset = `
        AND (
          n.type > $2::node_type
          OR (
            n.type = $2::node_type
            AND (
              ${sort.expression} ${comparator} $3::${sort.cast}
              OR (${sort.expression} = $3::${sort.cast} AND n.id > $4::uuid)
            )
          )
        )`;
    }

    params.push(query.limit + 1);
    const limitParam = `$${params.length}`;

    const rows = await selectRows<ListRow>(
      this.dataSource,
      `SELECT ${NODE_COLUMNS},
              ${sort.expression}::text AS "sortKey"
         FROM nodes n
        WHERE n.parent_id = $1
          AND n.deleted_at IS NULL
          -- A file with no current version is an upload in flight or abandoned. It must never
          -- appear as a half-finished row in a listing.
          AND (n.type = 'folder' OR n.current_version_id IS NOT NULL)
          ${keyset}
        ORDER BY n.type ASC, ${sort.expression} ${direction}, n.id ASC
        LIMIT ${limitParam}`,
      params,
    );

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toNodeDto),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              type: last.type,
              name: last.name.toLowerCase(),
              id: last.id,
              sortValue: last.sortKey,
            })
          : null,
    };
  }

  /** Aggregate over the subtree, **excluding** the node itself. */
  async stats(nodeId: string): Promise<NodeStatsDto> {
    const node = await this.requireRow(nodeId);
    return this.aggregate(node);
  }

  /**
   * Exactly what a delete would destroy, counted rather than estimated. A destructive confirmation
   * that understates its blast radius is worse than no confirmation at all.
   */
  async deletePreview(nodeId: string): Promise<DeletePreviewDto> {
    const node = await this.requireRow(nodeId);
    const stats = await this.aggregate(node);

    const [shares] = await selectRows<{ count: string }>(
      this.dataSource,
      `SELECT count(*)::text AS count
         FROM shares s
         JOIN nodes n ON n.id = s.node_id
        WHERE s.revoked_at IS NULL
          AND n.data_room_id = $1
          AND (n.id = $2 OR n.path LIKE $3)`,
      [node.dataRoomId, node.id, likePrefix(node.path)],
    );

    return { ...stats, affectedShareCount: Number(shares?.count ?? 0) };
  }

  private async aggregate(node: NodeRow): Promise<NodeStatsDto> {
    const [row] = await selectRows<{ size: string; files: string; folders: string }>(
      this.dataSource,
      `SELECT COALESCE(sum(n.size_bytes) FILTER (WHERE n.type = 'file'), 0)::text AS size,
              count(*) FILTER (WHERE n.type = 'file')::text                      AS files,
              count(*) FILTER (WHERE n.type = 'folder')::text                    AS folders
         FROM nodes n
        WHERE n.data_room_id = $1
          AND n.path LIKE $2
          AND n.id <> $3
          AND n.deleted_at IS NULL
          AND (n.type = 'folder' OR n.current_version_id IS NOT NULL)`,
      [node.dataRoomId, likePrefix(node.path), node.id],
    );

    return {
      sizeBytes: Number(row?.size ?? 0),
      fileCount: Number(row?.files ?? 0),
      folderCount: Number(row?.folders ?? 0),
    };
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  async createFolder(parentId: string, name: string, userId: string): Promise<NodeDto> {
    const parent = await this.requireRow(parentId);
    if (parent.type !== 'folder') throw errors.invalidMoveTarget('You can only add to a folder.');

    const id = randomUUID();
    const path = buildPath(parent.path, id);

    // No pre-flight SELECT for a duplicate name: the unique index is the only authority, and a
    // check-then-insert is a TOCTOU race under concurrent creation. A 23505 becomes NAME_CONFLICT
    // in the exception filter.
    const [row] = await selectRows<NodeRow>(
      this.dataSource,
      `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
       VALUES ($1, $2, $3, 'folder', $4, $5, $6, $7)
       RETURNING ${NODE_COLUMNS.replace(/\bn\./g, '')}`,
      [id, parent.dataRoomId, parent.id, name, path, depthOf(path), userId],
    );

    return toNodeDto(row as NodeRow);
  }

  /**
   * Rename is a hard conflict on collision — never an auto-suffix. Renaming is a deliberate single
   * act, and silently altering what someone typed would be wrong. Uploads are the opposite case and
   * are suffixed (SPEC-04).
   */
  async rename(nodeId: string, name: string): Promise<NodeDto> {
    return this.dataSource.transaction(async (manager) => {
      const node = await this.requireRow(nodeId, manager);

      const [row] = await updateReturning<NodeRow>(
        manager,
        `UPDATE nodes SET name = $2, updated_at = now() WHERE id = $1
         RETURNING ${NODE_COLUMNS.replace(/\bn\./g, '')}`,
        [nodeId, name],
      );

      // A data room and its root node share a name; renaming either keeps both in step.
      if (node.parentId === null) {
        await manager.query(`UPDATE data_rooms SET name = $2, updated_at = now() WHERE id = $1`, [
          node.dataRoomId,
          name,
        ]);
      }

      return toNodeDto(row as NodeRow);
    });
  }

  /**
   * One transaction: reparent, rewrite every descendant's path and depth, then move the rollups
   * from the old ancestor chain to the new one.
   *
   * A name collision at the destination surfaces as 23505 and rolls the **whole** thing back. A
   * partially rewritten path set is not a recoverable error, it is unrecoverable corruption.
   */
  async move(nodeId: string, targetParentId: string): Promise<NodeDto> {
    return this.dataSource.transaction(async (manager) => {
      const node = await this.requireRow(nodeId, manager);
      const target = await this.findRow(targetParentId, manager);

      if (!target) throw errors.invalidMoveTarget('That destination no longer exists.');
      if (target.type !== 'folder') throw errors.invalidMoveTarget('You can only move into a folder.');
      if (target.dataRoomId !== node.dataRoomId) {
        throw errors.invalidMoveTarget('You can only move within the same data room.');
      }
      if (node.parentId === null) {
        throw errors.invalidMoveTarget("A data room's root folder cannot be moved.");
      }
      if (target.id === node.id || isDescendantOf(target.path, node.path)) {
        throw errors.cycleNotAllowed();
      }

      // Moving to where it already is: a no-op, not an error. The user asked for a state, and the
      // state already holds.
      if (target.id === node.parentId) return toNodeDto(node);

      const oldPrefix = node.path;
      const newPrefix = buildPath(target.path, node.id);
      const depthDelta = depthOf(newPrefix) - depthOf(oldPrefix);

      await manager.query(
        `UPDATE nodes SET parent_id = $2, path = $3, depth = $4, updated_at = now() WHERE id = $1`,
        [node.id, target.id, newPrefix, depthOf(newPrefix)],
      );

      await manager.query(
        `UPDATE nodes
            SET path  = $2 || substring(path from ${oldPrefix.length + 1}),
                depth = depth + $3,
                updated_at = now()
          WHERE data_room_id = $1
            AND path LIKE $4
            AND id <> $5`,
        [node.dataRoomId, newPrefix, depthDelta, likePrefix(oldPrefix), node.id],
      );

      const { size, files } = await this.rollupOf(node, manager);
      await this.adjustRollups(manager, ancestorIds(oldPrefix), -size, -files);
      await this.adjustRollups(manager, ancestorIds(newPrefix), size, files);

      const moved = await this.requireRow(node.id, manager);
      return toNodeDto(moved);
    });
  }

  /**
   * Soft-deletes the whole subtree in one transaction and auto-revokes every share rooted inside
   * it, then subtracts the subtree's rollups from the ancestors that survive.
   */
  async softDelete(nodeId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const node = await this.requireRow(nodeId, manager);

      if (node.parentId === null) {
        throw errors.validationFailed(
          { _root: ['Delete the data room instead.'] },
          "A data room's root folder cannot be deleted on its own.",
        );
      }

      const { size, files } = await this.rollupOf(node, manager);
      const prefix = likePrefix(node.path);

      await manager.query(
        `UPDATE shares
            SET revoked_at = now()
          WHERE revoked_at IS NULL
            AND node_id IN (
              SELECT id FROM nodes
               WHERE data_room_id = $1 AND (id = $2 OR path LIKE $3) AND deleted_at IS NULL
            )`,
        [node.dataRoomId, node.id, prefix],
      );

      await manager.query(
        `UPDATE nodes
            SET deleted_at = now(), updated_at = now()
          WHERE data_room_id = $1
            AND (id = $2 OR path LIKE $3)
            AND deleted_at IS NULL`,
        [node.dataRoomId, node.id, prefix],
      );

      await this.adjustRollups(manager, ancestorIds(node.path), -size, -files);
    });
  }

  // ── rollups ────────────────────────────────────────────────────────────────

  /** What this node contributes to its ancestors: a file is itself, a folder is its subtree. */
  private async rollupOf(
    node: NodeRow,
    manager: EntityManager,
  ): Promise<{ size: number; files: number }> {
    if (node.type === 'file') {
      // An in-flight upload contributes nothing until `complete` promotes it.
      if (node.currentVersionId === null) return { size: 0, files: 0 };
      return { size: Number(node.sizeBytes ?? 0), files: 1 };
    }

    const [row] = await selectRows<{ size: string; files: string }>(
      manager,
      `SELECT subtree_size_bytes::text AS size, subtree_file_count::text AS files
         FROM nodes WHERE id = $1`,
      [node.id],
    );
    return { size: Number(row?.size ?? 0), files: Number(row?.files ?? 0) };
  }

  /**
   * O(depth), not O(subtree): the ancestor ids are already known from the path, so this is one
   * indexed `= ANY(...)` update rather than a walk.
   */
  async adjustRollups(
    manager: EntityManager,
    ancestors: string[],
    sizeDelta: number,
    fileDelta: number,
  ): Promise<void> {
    if (ancestors.length === 0 || (sizeDelta === 0 && fileDelta === 0)) return;

    await manager.query(
      `UPDATE nodes
          SET subtree_size_bytes = subtree_size_bytes + $2,
              subtree_file_count = subtree_file_count + $3,
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ancestors, sizeDelta, fileDelta],
    );
  }
}
