import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import {
  ALLOWED_MIME_TYPES,
  type CompleteUploadResponse,
  type InitUploadResponse,
  type NodeDto,
  type RetryUploadResponse,
} from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import { selectRows } from '../database/sql';
import { NODE_COLUMNS, toNodeDto, type NodeRow } from '../nodes/node.row';
import { NodesService } from '../nodes/nodes.service';
import { nextAvailableName } from '../nodes/name-conflict.util';
import { ancestorIds, buildPath, depthOf } from '../nodes/path.util';
import {
  READ_URL_TTL_SECONDS,
  STORAGE_SERVICE,
  WRITE_URL_TTL_SECONDS,
  storageKeyFor,
  type SignedUrl,
  type StorageService,
} from '../storage/storage.service';

export interface InitUploadInput {
  parentId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

interface VersionRow {
  id: string;
  nodeId: string;
  storageKey: string;
  sizeBytes: string;
  mimeType: string;
  status: 'pending' | 'ready';
  dataRoomId: string;
  nodePath: string;
  currentVersionId: string | null;
}

/** How many suffixes to try when two uploads race for the same name before giving up. */
const NAME_RACE_ATTEMPTS = 5;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505';

/**
 * The upload lifecycle. Bytes never pass through here — the browser `PUT`s straight to storage —
 * so this service's whole job is to make sure the metadata can never describe a file that isn't
 * really there.
 *
 *   init  →  PUT to storage (direct, XHR, real progress)  →  complete
 *              ↘ on failure: retry (same reserved node)   ↗
 *              ↘ on cancel:  abort
 *
 * A node exists from `init` but stays invisible in listings until `complete`, because a file node
 * with no current version is filtered out of every query. That is what stops a half-uploaded row
 * from ever appearing in the UI.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly nodes: NodesService,
  ) {}

  /**
   * Validates, reserves, and only then mints a URL.
   *
   * The order matters: an oversized or disallowed file is rejected without a single byte moving,
   * and the row that will describe the file exists before anything can be written to storage.
   */
  async init(input: InitUploadInput, userId: string): Promise<InitUploadResponse> {
    const parent = await this.nodes.requireRow(input.parentId);
    if (parent.type !== 'folder') {
      throw errors.invalidMoveTarget('You can only upload into a folder.');
    }

    if (input.sizeBytes > this.config.maxUploadBytes) {
      const limitMb = Math.floor(this.config.maxUploadBytes / (1024 * 1024));
      throw errors.fileTooLarge(`Files must be ${limitMb} MB or smaller.`);
    }

    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
      throw errors.unsupportedType(`Data Room does not accept ${input.mimeType} files.`);
    }

    const taken = await this.siblingNames(parent.id);

    // The unique index is the only authority on conflicts, so this loop is a retry around it
    // rather than a check before it: two uploads of the same name at the same moment both compute
    // the same suffix, one loses on 23505, and the loser tries again knowing the winner's name.
    for (let attempt = 0; attempt < NAME_RACE_ATTEMPTS; attempt += 1) {
      const finalName = nextAvailableName(input.name, taken);
      try {
        return await this.reserve(parent, finalName, input, userId);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        taken.push(finalName);
      }
    }

    throw errors.nameConflict('Too many uploads with that name at once. Try again.');
  }

  private async reserve(
    parent: NodeRow,
    finalName: string,
    input: InitUploadInput,
    userId: string,
  ): Promise<InitUploadResponse> {
    const nodeId = randomUUID();
    const versionId = randomUUID();
    const path = buildPath(parent.path, nodeId);
    const storageKey = storageKeyFor(parent.dataRoomId, nodeId, versionId);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
         VALUES ($1, $2, $3, 'file', $4, $5, $6, $7)`,
        [nodeId, parent.dataRoomId, parent.id, finalName, path, depthOf(path), userId],
      );
      await manager.query(
        `INSERT INTO file_versions
           (id, node_id, version, storage_key, size_bytes, mime_type, status, uploaded_by)
         VALUES ($1, $2, 1, $3, $4, $5, 'pending', $6)`,
        [versionId, nodeId, storageKey, input.sizeBytes, input.mimeType, userId],
      );
    });

    const { url, expiresAt } = await this.storage.createSignedUploadUrl(
      storageKey,
      WRITE_URL_TTL_SECONDS,
    );

    return {
      nodeId,
      versionId,
      uploadUrl: url,
      uploadExpiresAt: expiresAt.toISOString(),
      // Returned even when unchanged, so the client can compare and surface a silent rename.
      finalName,
    };
  }

  /**
   * Promotes the pending version and makes the node visible.
   *
   * The size recorded is the one **storage reports**, not the one the client declared: the declared
   * number was only ever a hint for the cap check, and trusting it would let a caller declare 1 MB
   * and store 500 MB.
   */
  async complete(versionId: string): Promise<CompleteUploadResponse> {
    const version = await this.requireVersion(versionId);

    // Idempotent: a client that retries `complete` after a dropped response must not double-count
    // the file into every ancestor's rollup.
    if (version.status === 'ready') {
      return { node: toNodeDto(await this.nodes.requireRow(version.nodeId)) };
    }

    const object = await this.storage.stat(version.storageKey);
    if (!object.exists) {
      throw errors.uploadIncomplete('The file never finished uploading. Try again.');
    }
    if (object.sizeBytes !== Number(version.sizeBytes)) {
      // Exact equality: object storage neither pads nor normalises, so any difference means the
      // upload was truncated or the declaration was a lie. The version stays pending for the
      // sweeper either way.
      throw errors.uploadIncomplete('The uploaded file does not match what was expected.');
    }

    const node = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE file_versions SET status = 'ready', size_bytes = $2 WHERE id = $1`,
        [versionId, object.sizeBytes],
      );
      await manager.query(
        `UPDATE nodes
            SET current_version_id = $2, size_bytes = $3, mime_type = $4, updated_at = now()
          WHERE id = $1`,
        [version.nodeId, versionId, object.sizeBytes, version.mimeType],
      );

      await this.nodes.adjustRollups(manager, ancestorIds(version.nodePath), object.sizeBytes, 1);
      return this.nodes.requireRow(version.nodeId, manager);
    });

    return { node: toNodeDto(node) };
  }

  /**
   * A fresh URL for the **same** reserved node and version.
   *
   * This endpoint is the entire reason a failed upload never re-runs `init`: that would reserve a
   * second node and auto-suffix its name, so one flaky connection would litter a folder with
   * `report (2).pdf`, `report (3).pdf`.
   */
  async retry(versionId: string): Promise<RetryUploadResponse> {
    const version = await this.requireVersion(versionId);
    if (version.status === 'ready') {
      throw errors.notFound('That upload already finished.');
    }

    const { url, expiresAt } = await this.storage.createSignedUploadUrl(
      version.storageKey,
      WRITE_URL_TTL_SECONDS,
    );
    return { uploadUrl: url, uploadExpiresAt: expiresAt.toISOString() };
  }

  /**
   * Cancel: drop the placeholder so the folder does not carry an invisible reservation, and delete
   * the object best-effort. The sweeper is the real backstop; this is the courtesy for the common
   * case where the user is still there to click cancel.
   */
  async abort(versionId: string): Promise<void> {
    const version = await this.requireVersion(versionId);
    if (version.status === 'ready') {
      throw errors.notFound('That upload already finished.');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM file_versions WHERE id = $1`, [versionId]);
      // Only the placeholder this upload created: a node that already has a ready version is a
      // real file and stays.
      await manager.query(`DELETE FROM nodes WHERE id = $1 AND current_version_id IS NULL`, [
        version.nodeId,
      ]);
    });

    await this.storage.delete(version.storageKey);
  }

  /**
   * `content` and `download` both land here. Access has already been decided by `ReadAccessGuard`;
   * the URL is minted only afterwards, so a signed URL can never be produced for a node the caller
   * may not read.
   */
  async signedUrlFor(
    nodeId: string,
    disposition: 'inline' | 'attachment',
  ): Promise<SignedUrl> {
    const node = await this.nodes.requireRow(nodeId);
    if (node.type !== 'file' || node.currentVersionId === null) {
      throw errors.notFound('That item has no file to open.');
    }

    const [version] = await selectRows<{ storageKey: string }>(
      this.dataSource,
      `SELECT storage_key AS "storageKey" FROM file_versions WHERE id = $1`,
      [node.currentVersionId],
    );
    if (!version) throw errors.notFound('That item has no file to open.');

    return this.storage.createSignedDownloadUrl(version.storageKey, READ_URL_TTL_SECONDS, {
      disposition,
      filename: node.name,
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async siblingNames(parentId: string): Promise<string[]> {
    const rows = await selectRows<{ name: string }>(
      this.dataSource,
      `SELECT name FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL`,
      [parentId],
    );
    return rows.map((row) => row.name);
  }

  private async requireVersion(versionId: string, manager?: EntityManager): Promise<VersionRow> {
    const [row] = await selectRows<VersionRow>(
      manager ?? this.dataSource,
      `SELECT v.id,
              v.node_id       AS "nodeId",
              v.storage_key   AS "storageKey",
              v.size_bytes    AS "sizeBytes",
              v.mime_type     AS "mimeType",
              v.status,
              n.data_room_id  AS "dataRoomId",
              n.path          AS "nodePath",
              n.current_version_id AS "currentVersionId"
         FROM file_versions v
         JOIN nodes n ON n.id = v.node_id
        WHERE v.id = $1 AND n.deleted_at IS NULL`,
      [versionId],
    );

    if (!row) throw errors.notFound('No upload in progress for that id.');
    return row;
  }

  /**
   * Everything a sweep needs to know about an abandoned upload, in one query.
   * Exposed for the sweeper and for its test; nothing else calls it.
   */
  async findAbandonedVersions(olderThanHours: number): Promise<
    Array<{ id: string; nodeId: string; storageKey: string }>
  > {
    return selectRows<{ id: string; nodeId: string; storageKey: string }>(
      this.dataSource,
      `SELECT v.id, v.node_id AS "nodeId", v.storage_key AS "storageKey"
         FROM file_versions v
        WHERE v.status = 'pending'
          AND v.created_at < now() - ($1 || ' hours')::interval`,
      [String(olderThanHours)],
    );
  }

  async discardVersion(versionId: string, nodeId: string, storageKey: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM file_versions WHERE id = $1`, [versionId]);
      await manager.query(`DELETE FROM nodes WHERE id = $1 AND current_version_id IS NULL`, [
        nodeId,
      ]);
    });
    await this.storage.delete(storageKey);
  }

  /** Used by the content controller's tests to assert the node was resolvable at all. */
  async nodeDtoFor(nodeId: string): Promise<NodeDto> {
    return toNodeDto(await this.nodes.requireRow(nodeId));
  }

  /** `NODE_COLUMNS` is re-exported so the uploads tests can build the same projection. */
  static readonly NODE_COLUMNS = NODE_COLUMNS;
}
