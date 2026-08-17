import type { NodeDto, NodeType } from '@dataroom/contracts';

/**
 * The shape every node query selects. Raw SQL rather than the repository API because the
 * interesting queries here — keyset pagination, subtree rewrites, rollup deltas — are the ones an
 * ORM expresses worst, and hiding them behind a query builder would make them harder to review,
 * not easier.
 */
export const NODE_COLUMNS = `
  n.id,
  n.data_room_id       AS "dataRoomId",
  n.parent_id          AS "parentId",
  n.type,
  n.name,
  n.path,
  n.depth,
  n.size_bytes         AS "sizeBytes",
  n.mime_type          AS "mimeType",
  n.subtree_size_bytes AS "subtreeSizeBytes",
  n.subtree_file_count AS "subtreeFileCount",
  n.current_version_id AS "currentVersionId",
  n.created_at         AS "createdAt",
  n.updated_at         AS "updatedAt",
  n.deleted_at         AS "deletedAt"
`;

export interface NodeRow {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  depth: number;
  /** `bigint` arrives as a string from a raw query. */
  sizeBytes: string | number | null;
  mimeType: string | null;
  subtreeSizeBytes: string | number;
  subtreeFileCount: number;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const toNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

/**
 * Folder-only fields are null on files and file-only fields are null on folders — the contract is
 * explicit about this, and the frontend renders "—" rather than "0 B" for a null, so a zero here
 * would be a visible lie about an unknown size.
 */
export function toNodeDto(row: NodeRow): NodeDto {
  const isFolder = row.type === 'folder';
  return {
    id: row.id,
    dataRoomId: row.dataRoomId,
    parentId: row.parentId,
    type: row.type,
    name: row.name,
    sizeBytes: isFolder ? null : toNumber(row.sizeBytes),
    mimeType: isFolder ? null : row.mimeType,
    subtreeSizeBytes: isFolder ? (toNumber(row.subtreeSizeBytes) ?? 0) : null,
    subtreeFileCount: isFolder ? row.subtreeFileCount : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
