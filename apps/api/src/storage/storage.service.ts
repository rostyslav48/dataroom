/**
 * Object storage, behind one interface.
 *
 * Bytes never pass through this API: the browser `PUT`s straight to a signed URL and later `GET`s
 * from one. That is what makes per-file upload progress real rather than animated, and it keeps a
 * 100 MB upload off the API's event loop entirely.
 *
 * Storage keys are `${dataRoomId}/${nodeId}/${versionId}` — flat, opaque, and built only from
 * UUIDs. No user-controlled path segment ever reaches storage, so a filename cannot traverse,
 * cannot collide, and cannot hot-spot a directory.
 */
export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface StoredObject {
  exists: boolean;
  sizeBytes: number;
  /**
   * The content type storage actually recorded, essence only (no `; charset=…`), lowercased.
   * `null` when the store did not report one.
   *
   * This is the byte-level fact the declared `mime_type` is checked against at `complete`. Without
   * it the allowlist is decorative: the client picks the header on its own `PUT`, so declaring
   * `application/pdf` and uploading HTML used to succeed, and `/nodes/:id/content` then served
   * attacker-controlled HTML `inline` from the storage origin.
   */
  contentType: string | null;
}

export interface UploadGrant {
  ttlSeconds: number;
  /**
   * The type the object must be stored as. Where the backend can express it, this is a *condition*
   * on the signed URL; where it cannot, it is still the value the client is told to send and the
   * value `complete` verifies against what storage recorded.
   */
  contentType: string;
  /**
   * Whether this grant may replace an object already at the key.
   *
   * Only `retry` needs it — the first grant addresses a freshly minted version UUID that nothing
   * can have written to yet. Leaving overwrite on for every grant is what let a completed version's
   * bytes be swapped out from under recipients who had already read them.
   */
  allowOverwrite: boolean;
}

export interface DownloadOptions {
  /** `inline` for the viewer, `attachment` for a download. */
  disposition: 'inline' | 'attachment';
  filename: string;
}

export interface StorageService {
  createSignedUploadUrl(key: string, grant: UploadGrant): Promise<SignedUrl>;
  createSignedDownloadUrl(
    key: string,
    ttlSeconds: number,
    options: DownloadOptions,
  ): Promise<SignedUrl>;
  stat(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('StorageService');

/** Read URLs die in a minute; a link copied out of devtools is useless almost immediately. */
export const READ_URL_TTL_SECONDS = 60;

/**
 * Write URLs live fifteen minutes.
 *
 * That is generous for a 100 MB upload even on a poor connection (~110 KB/s sustained), and it is
 * the window during which the grant is a live capability to write at that key. It was an hour,
 * which meant a version could be completed — size recorded, rollups adjusted, link shared — and
 * then have entirely different bytes written over it for the next fifty-odd minutes, with
 * `MAX_UPLOAD_BYTES` and every derived total describing a file that no longer existed.
 *
 * `retry` mints a fresh URL, so a genuinely slow upload is not stranded by this.
 */
export const WRITE_URL_TTL_SECONDS = 900;

/**
 * Compares a content type against a declared one: essence only, case-insensitive.
 *
 * `text/plain; charset=UTF-8` and `TEXT/PLAIN` are the same type; a store that appends a charset
 * to what the client sent must not be read as a mismatch.
 */
export function mimeEssence(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const essence = value.split(';')[0]?.trim().toLowerCase();
  return essence === undefined || essence === '' ? null : essence;
}

export const storageKeyFor = (dataRoomId: string, nodeId: string, versionId: string): string =>
  `${dataRoomId}/${nodeId}/${versionId}`;

/**
 * Strips anything that could break out of a `Content-Disposition` filename.
 *
 * It lives beside the interface rather than inside one implementation because a node name is user
 * input — `ResourceName` forbids only `/` and `\`, so a quote or a CRLF is a perfectly legal name —
 * and the header it ends up in is written by whichever object store is behind the interface. A
 * sanitiser that only the Supabase implementation applied would be a guarantee that disappeared the
 * day the storage backend changed.
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, '').slice(0, 200) || 'download';
}
