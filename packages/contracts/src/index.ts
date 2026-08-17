/**
 * @dataroom/contracts — the FE/BE boundary.
 *
 * FROZEN after Wave 0. Changes follow the Contract Change Protocol in
 * ProjectPlan/00-method-and-rules.md. Neither track edits this package directly.
 */

export * from './common.contract';
export * from './errors.contract';
export * from './auth.contract';
export * from './data-rooms.contract';
export * from './nodes.contract';
export * from './uploads.contract';
export * from './shares.contract';

/** Namespaced so `fixtures.nodes` cannot collide with a DTO export. */
export * as fixtures from './fixtures';

import { authEndpoints } from './auth.contract';
import { dataRoomEndpoints } from './data-rooms.contract';
import { nodeEndpoints } from './nodes.contract';
import { uploadEndpoints } from './uploads.contract';
import { shareEndpoints } from './shares.contract';

/**
 * Every endpoint in the API, in one object.
 *
 * The backend declares its routes from these paths and the frontend builds its client and MSW
 * handlers from them, so a path typo is a compile error rather than a 404 discovered at
 * integration. A contract test asserts that the set of registered Nest routes exactly equals
 * the set of paths here — no undocumented endpoints, no unimplemented ones.
 */
export const endpoints = {
  auth: authEndpoints,
  dataRooms: dataRoomEndpoints,
  nodes: nodeEndpoints,
  uploads: uploadEndpoints,
  shares: shareEndpoints,
} as const;
