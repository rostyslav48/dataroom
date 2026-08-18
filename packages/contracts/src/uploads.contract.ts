import { z } from 'zod';
import { EndpointDescriptor, IsoDateTime, ResourceName, Uuid } from './common.contract';
import { NodeDto } from './nodes.contract';

/**
 * Upload lifecycle. See SPEC-04 (backend) and SPEC-08 (frontend).
 *
 * Bytes never pass through the API. The flow is:
 *
 *   init  →  PUT to storage (direct, XHR, real progress)  →  complete
 *              ↘ on failure: retry (same reserved node)   ↗
 *              ↘ on cancel:  abort
 *
 * A node exists from `init` but stays invisible in listings until `complete`, because a file
 * node with no current version is filtered out. That is what prevents a half-uploaded row
 * from ever appearing in the UI.
 */

/**
 * Mime allowlist. PDF is the only previewable type; the rest upload and download normally.
 * Enforced at init, before a signed URL is issued.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const AllowedMimeType = z.enum(ALLOWED_MIME_TYPES);
export type AllowedMimeType = z.infer<typeof AllowedMimeType>;

export const PREVIEWABLE_MIME_TYPES = ['application/pdf'] as const;

export const InitUploadBody = z
  .object({
    parentId: Uuid,
    name: ResourceName,
    /**
     * Client-declared size. Used ONLY for the cap check, so a bad actor cannot get a URL for a
     * huge file. The size actually recorded comes from storage at `complete`.
     *
     * Zero is legal: an empty file is ordinary, and rejecting it with a validation error the user
     * cannot act on is the surprise `06-edge-cases.md` decided against. See CCP-5.
     */
    sizeBytes: z.number().int().nonnegative(),
    /**
     * Any non-empty string on the wire. Allowlist membership is a *domain* rule, not a shape rule:
     * a type outside `ALLOWED_MIME_TYPES` is `415 UNSUPPORTED_TYPE`, never `400 VALIDATION_FAILED`.
     * "We do not accept .zip" is a different thing to tell a user than "your request was
     * malformed", and the upload queue branches on the difference. Validating the enum here would
     * make `UNSUPPORTED_TYPE` — a code this package defines and maps to 415 — unreachable. See CCP-8.
     */
    mimeType: z.string().min(1),
  })
  .strict();
export type InitUploadBody = z.infer<typeof InitUploadBody>;

export const InitUploadResponse = z
  .object({
    nodeId: Uuid,
    versionId: Uuid,
    uploadUrl: z.string().url(),
    uploadExpiresAt: IsoDateTime,
    /**
     * The name actually reserved. Differs from the requested name when a sibling conflict was
     * auto-resolved (`report.pdf` → `report (2).pdf`). The frontend MUST surface the difference
     * in the queue row — a silent rename is a surprise the user discovers later.
     */
    finalName: z.string(),
  })
  .strict();
export type InitUploadResponse = z.infer<typeof InitUploadResponse>;

/**
 * Promotes the pending version to ready and makes the node visible. The backend verifies the
 * object exists in storage and that its real size matches; a mismatch is UPLOAD_INCOMPLETE and
 * the version stays pending for the sweeper.
 */
export const CompleteUploadResponse = z.object({ node: NodeDto }).strict();
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponse>;

/**
 * Fresh signed URL for the SAME reserved node and version.
 *
 * This endpoint exists specifically so a failed upload is never retried by calling `init`
 * again — that would reserve a second node and auto-suffix its name, so a flaky connection
 * would litter the folder with `report (2).pdf`, `report (3).pdf`.
 */
export const RetryUploadResponse = z
  .object({ uploadUrl: z.string().url(), uploadExpiresAt: IsoDateTime })
  .strict();
export type RetryUploadResponse = z.infer<typeof RetryUploadResponse>;

export const uploadEndpoints = {
  init:     { method: 'POST', path: '/uploads/init' },
  complete: { method: 'POST', path: '/uploads/:versionId/complete' },
  retry:    { method: 'POST', path: '/uploads/:versionId/retry' },
  abort:    { method: 'POST', path: '/uploads/:versionId/abort' },
} as const satisfies Record<string, EndpointDescriptor>;

/**
 * Frontend-only upload queue item. Lives here rather than in the web app because the shape is
 * derived from the upload contract and both the queue component and its tests depend on it
 * staying aligned with the endpoints above.
 */
export const UploadStatus = z.enum([
  'queued',
  'initializing',
  'uploading',
  'finalizing',
  'done',
  'error',
  'canceled',
]);
export type UploadStatus = z.infer<typeof UploadStatus>;

export interface UploadQueueItem {
  /** Client-generated, stable across retries. Not a server id. */
  localId: string;
  file: File;
  parentId: string;
  status: UploadStatus;
  /** 0–100, from XHR `progress` events. Only meaningful while `status === 'uploading'`. */
  progress: number;
  requestedName: string;
  /** Set after init; differs from `requestedName` when auto-suffixed. */
  finalName?: string;
  nodeId?: string;
  versionId?: string;
  error?: { code: string; message: string };
}

/** Max simultaneous PUTs. Beyond ~3 the browser queues anyway and progress bars stall confusingly. */
export const UPLOAD_CONCURRENCY = 3;
