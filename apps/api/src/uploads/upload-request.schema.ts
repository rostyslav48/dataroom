import { z } from 'zod';
import { InitUploadBody } from '@dataroom/contracts';

/**
 * The request shape the controller validates, which differs from the contract in exactly one field.
 *
 * `InitUploadBody.mimeType` is a `z.enum` of the allowlist. Validating against that enum here would
 * make a disallowed type a 400 `VALIDATION_FAILED` — but SPEC-04 requires **415 `UNSUPPORTED_TYPE`**,
 * because "we do not accept .zip" is a different thing to tell a user than "your request was
 * malformed", and the frontend's upload queue branches on the distinction to show the right row
 * state. So the boundary accepts any non-empty string and `UploadsService` decides membership.
 *
 * Every other field, and the `.strict()` rejection of unknown keys, is the contract's, unchanged.
 */
export const InitUploadRequest = InitUploadBody.extend({
  mimeType: z.string().min(1),
});
export type InitUploadRequest = z.infer<typeof InitUploadRequest>;
