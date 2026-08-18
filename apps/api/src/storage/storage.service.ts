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
}

export interface DownloadOptions {
  /** `inline` for the viewer, `attachment` for a download. */
  disposition: 'inline' | 'attachment';
  filename: string;
}

export interface StorageService {
  createSignedUploadUrl(key: string, ttlSeconds: number): Promise<SignedUrl>;
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

/** Write URLs live an hour: long enough for a 100 MB upload on a poor connection. */
export const WRITE_URL_TTL_SECONDS = 3600;

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
