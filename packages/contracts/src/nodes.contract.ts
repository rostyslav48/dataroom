import { z } from 'zod';
import {
  AccessLevel,
  EndpointDescriptor,
  IsoDateTime,
  PaginationQuery,
  ResourceName,
  Uuid,
  paginated,
} from './common.contract';

/**
 * Nodes — folders and files in one shape. See SPEC-03 (backend) and SPEC-07 (frontend).
 *
 * Folders and files share a table and a DTO because rename, move, delete, share and
 * breadcrumb are identical operations for both. File-only fields are null on folders and
 * folder-only fields are null on files; the discriminator is `type`.
 */

export const NodeType = z.enum(['folder', 'file']);
export type NodeType = z.infer<typeof NodeType>;

export const NodeDto = z
  .object({
    id: Uuid,
    dataRoomId: Uuid,
    /** null only for a data room's root node. */
    parentId: Uuid.nullable(),
    type: NodeType,
    name: z.string(),

    // ---- file only (null on folders) ----
    /** Size of the current version. */
    sizeBytes: z.number().int().nonnegative().nullable(),
    mimeType: z.string().nullable(),

    // ---- folder only (null on files) ----
    /** Cached subtree rollups. Rendered directly in listings; never computed per row. */
    subtreeSizeBytes: z.number().int().nonnegative().nullable(),
    subtreeFileCount: z.number().int().nonnegative().nullable(),

    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export type NodeDto = z.infer<typeof NodeDto>;

/**
 * One breadcrumb segment. The backend truncates this array at the caller's share root, so a
 * viewer given a nested folder never learns the names of its ancestors. The frontend renders
 * whatever it receives and must not attempt to reconstruct a fuller path.
 */
export const BreadcrumbDto = z
  .object({ id: Uuid, name: z.string(), type: NodeType })
  .strict();
export type BreadcrumbDto = z.infer<typeof BreadcrumbDto>;

/**
 * `GET /nodes/:id`. Carries everything a folder or file page needs for its first paint
 * except the children, which are paginated separately.
 */
export const NodeDetailResponse = z
  .object({
    node: NodeDto,
    /** Root-first, includes the node itself as the last element. */
    breadcrumbs: z.array(BreadcrumbDto),
    access: AccessLevel,
    /**
     * The node at which this caller's grant begins. Equals the data room's root node for an
     * owner. Breadcrumbs never extend above it.
     */
    shareRootId: Uuid,
    dataRoomName: z.string(),
  })
  .strict();
export type NodeDetailResponse = z.infer<typeof NodeDetailResponse>;

export const NodeSortField = z.enum(['name', 'size', 'updatedAt']);
export type NodeSortField = z.infer<typeof NodeSortField>;

export const ListChildrenQuery = PaginationQuery.extend({
  sort: NodeSortField.default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  /**
   * Optional filename filter. When present the search scope changes from *children of* this
   * node to *the whole subtree under* it, and each item carries `parentBreadcrumbs` so the
   * user can see where a hit lives. Extra-credit feature — backend may return 501-equivalent
   * NOT_FOUND until implemented; the frontend must not render the search input until it works.
   */
  q: z.string().trim().min(1).max(255).optional(),
}).strict();
export type ListChildrenQuery = z.infer<typeof ListChildrenQuery>;

/** Folders always sort before files regardless of `sort`/`dir`. This is not configurable. */
export const NodeListItem = NodeDto.extend({
  /** Present only in search results (`q` supplied). Ancestors between share root and item. */
  parentBreadcrumbs: z.array(BreadcrumbDto).optional(),
});
export type NodeListItem = z.infer<typeof NodeListItem>;

export const ListChildrenResponse = paginated(NodeListItem);
export type ListChildrenResponse = z.infer<typeof ListChildrenResponse>;

export const CreateFolderBody = z
  .object({ parentId: Uuid, name: ResourceName })
  .strict();
export type CreateFolderBody = z.infer<typeof CreateFolderBody>;

/** Rename. Conflicts are a hard 409 NAME_CONFLICT — never silently suffixed. */
export const RenameNodeBody = z.object({ name: ResourceName }).strict();
export type RenameNodeBody = z.infer<typeof RenameNodeBody>;

export const MoveNodeBody = z.object({ parentId: Uuid }).strict();
export type MoveNodeBody = z.infer<typeof MoveNodeBody>;

/**
 * Subtree rollup. Used by the folder header and, via `delete-preview`, by the delete warning.
 * Counts exclude the node itself.
 */
export const NodeStatsDto = z
  .object({
    sizeBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    folderCount: z.number().int().nonnegative(),
  })
  .strict();
export type NodeStatsDto = z.infer<typeof NodeStatsDto>;

/**
 * What a delete would destroy. Computed exactly, never estimated — a destructive confirmation
 * that understates its blast radius is worse than no confirmation.
 */
export const DeletePreviewDto = NodeStatsDto.extend({
  /** Live shares rooted inside this subtree that deletion will auto-revoke. */
  affectedShareCount: z.number().int().nonnegative(),
}).strict();
export type DeletePreviewDto = z.infer<typeof DeletePreviewDto>;

export const nodeEndpoints = {
  get:           { method: 'GET',    path: '/nodes/:id',                acceptsShareToken: true },
  children:      { method: 'GET',    path: '/nodes/:id/children',       acceptsShareToken: true },
  stats:         { method: 'GET',    path: '/nodes/:id/stats',          acceptsShareToken: true },
  deletePreview: { method: 'GET',    path: '/nodes/:id/delete-preview' },
  createFolder:  { method: 'POST',   path: '/folders' },
  rename:        { method: 'PATCH',  path: '/nodes/:id' },
  move:          { method: 'POST',   path: '/nodes/:id/move' },
  remove:        { method: 'DELETE', path: '/nodes/:id' },
  /** Both 302 to a short-lived signed storage URL. Never proxy bytes through the API. */
  content:       { method: 'GET',    path: '/nodes/:id/content',        acceptsShareToken: true },
  download:      { method: 'GET',    path: '/nodes/:id/download',       acceptsShareToken: true },
} as const satisfies Record<string, EndpointDescriptor>;
