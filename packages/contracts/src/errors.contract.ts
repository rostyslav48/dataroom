import { z } from 'zod';

/**
 * Error codes are the API's stable surface. The frontend switches on `code` and MUST NOT
 * parse `message` — messages are for humans and logs, and may be reworded at any time.
 *
 * Every code here has a designed UI state (SPEC-06 through SPEC-09). Adding a code without
 * a designed state is a contract violation: the frontend would fall through to a generic
 * error and the user would see nothing useful.
 */
export const ErrorCode = z.enum([
  // auth
  'UNAUTHENTICATED',      // 401 — no or expired session; client refreshes, then redirects to login
  'FORBIDDEN',            // 403 — authenticated but no grant covers this node
  'ACCESS_REVOKED',       // 403 — a grant existed and was revoked by the owner
  'SHARE_EXPIRED',        // 403 — a grant existed and passed its expiry
  'WRONG_ACCOUNT',        // 403 — a permissioned share exists for a different email than the session's

  // resource
  'NOT_FOUND',            // 404 — no such resource, or none the caller may know about
  'ITEM_GONE',            // 410 — existed, soft-deleted by the owner. Distinct from 404 on purpose:
                          //       it is the "deleted while you were viewing it" case and gets its own screen.

  // validation / conflict
  'VALIDATION_FAILED',    // 400 — body or query failed its Zod schema; see `details`
  'NAME_CONFLICT',        // 409 — sibling name already taken (rename and move only; uploads auto-suffix)
  'CYCLE_NOT_ALLOWED',    // 400 — move target is inside the moving subtree
  'INVALID_MOVE_TARGET',  // 400 — target is not a folder, or is in a different data room

  // uploads
  'FILE_TOO_LARGE',       // 413 — exceeds MAX_UPLOAD_BYTES, rejected at init before any bytes move
  'UNSUPPORTED_TYPE',     // 415 — mime type not in the allowlist
  'UPLOAD_INCOMPLETE',    // 409 — storage object missing or size mismatch at complete

  // infra
  'RATE_LIMITED',         // 429
  'INTERNAL',             // 500
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * The single error envelope. Every non-2xx response from the API has this body — there are
 * no other error shapes, including for framework-level failures, which the global filter maps in.
 */
export const ApiError = z
  .object({
    code: ErrorCode,
    message: z.string(),
    /** Field-level detail, populated for VALIDATION_FAILED. Keyed by dotted field path. */
    details: z.record(z.string(), z.array(z.string())).optional(),
    /** Correlates a user-visible failure with a server log line. */
    requestId: z.string(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiError>;

/** Canonical HTTP status per code. The backend's exception filter is driven by this map. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ACCESS_REVOKED: 403,
  SHARE_EXPIRED: 403,
  WRONG_ACCOUNT: 403,
  NOT_FOUND: 404,
  ITEM_GONE: 410,
  VALIDATION_FAILED: 400,
  NAME_CONFLICT: 409,
  CYCLE_NOT_ALLOWED: 400,
  INVALID_MOVE_TARGET: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  UPLOAD_INCOMPLETE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};
