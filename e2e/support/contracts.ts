import { createRequire } from 'node:module';
import type * as Contracts from '@dataroom/contracts';

/**
 * The one place this suite pulls *values* out of `@dataroom/contracts`.
 *
 * `e2e` is an ES module; the contracts package publishes TypeScript's CommonJS output. Node's
 * named-export detection for CJS is a static scan, and it cannot see through the `__exportStar`
 * calls that `export * from './x'` compiles to — so `import { API_BASE } from '@dataroom/contracts'`
 * throws at load time even though the export is plainly there at runtime. `createRequire` sidesteps
 * the scan by asking CommonJS directly, which always returns the real `module.exports`.
 *
 * Types are unaffected: `import type` is erased before Node ever sees it, so every other file in
 * this suite still imports its DTO types straight from the package and gets full checking. Only
 * the runtime values come through here.
 *
 * Delete this module the day the contracts package ships an ESM build or an `exports` map.
 */
const contracts = createRequire(import.meta.url)('@dataroom/contracts') as typeof Contracts;

export const {
  API_BASE,
  SHARE_TOKEN_HEADER,
  endpoints,
  fixtures,

  ApiError,
  CompleteUploadResponse,
  DataRoomDto,
  DeletePreviewDto,
  InitUploadResponse,
  ListChildrenResponse,
  ListDataRoomsResponse,
  ListSharesResponse,
  MeResponse,
  NodeDetailResponse,
  NodeDto,
  ResolveShareResponse,
  ShareDto,
} = contracts;
