import { z } from 'zod';
import {
  AccessLevel,
  EndpointDescriptor,
  IsoDateTime,
  ResourceName,
  Uuid,
} from './common.contract';

/** Data rooms. See SPEC-03 (backend) and SPEC-07 (frontend). */

export const DataRoomDto = z
  .object({
    id: Uuid,
    name: z.string(),
    /** Entry point for browsing. Always present; a room without a root node cannot exist. */
    rootNodeId: Uuid,
    ownerId: Uuid,
    ownerName: z.string(),
    /** How the *requesting* identity relates to this room. Drives layout choice on the frontend. */
    access: AccessLevel,
    /** Cached subtree rollups from the root node. Cheap — never computed per request. */
    fileCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export type DataRoomDto = z.infer<typeof DataRoomDto>;

/**
 * Not paginated. A user's room count is small by nature, and the sidebar renders all of them.
 * If that ever stops being true this becomes a CCP, not a silent truncation.
 */
export const ListDataRoomsResponse = z
  .object({
    owned: z.array(DataRoomDto),
    sharedWithMe: z.array(DataRoomDto),
  })
  .strict();
export type ListDataRoomsResponse = z.infer<typeof ListDataRoomsResponse>;

export const CreateDataRoomBody = z.object({ name: ResourceName }).strict();
export type CreateDataRoomBody = z.infer<typeof CreateDataRoomBody>;

export const UpdateDataRoomBody = z.object({ name: ResourceName }).strict();
export type UpdateDataRoomBody = z.infer<typeof UpdateDataRoomBody>;

export const dataRoomEndpoints = {
  list:   { method: 'GET',    path: '/data-rooms' },
  create: { method: 'POST',   path: '/data-rooms' },
  get:    { method: 'GET',    path: '/data-rooms/:id', acceptsShareToken: true },
  update: { method: 'PATCH',  path: '/data-rooms/:id' },
  remove: { method: 'DELETE', path: '/data-rooms/:id' },
} as const satisfies Record<string, EndpointDescriptor>;
