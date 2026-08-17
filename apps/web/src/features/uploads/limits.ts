import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '@dataroom/contracts';

/**
 * Client-side gates, checked before a byte moves.
 *
 * They mirror the server's rules rather than replacing them: the API rejects the same cases at
 * `init`, and it is the authority. Checking here means a 300 MB file fails in its own queue row
 * immediately instead of after a pointless round trip.
 */
export const MAX_UPLOAD_BYTES = 104_857_600;

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export interface RejectionReason {
  code: 'FILE_TOO_LARGE' | 'UNSUPPORTED_TYPE';
  message: string;
}

/** Returns why this file cannot be uploaded, or null when it can. */
export function rejectionFor(file: File): RejectionReason | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { code: 'FILE_TOO_LARGE', message: 'Larger than the 100 MB limit' };
  }
  if (!isAllowedMimeType(file.type)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message:
        file.type === ''
          ? "The browser couldn't identify this file's type"
          : `${file.type} files are not accepted`,
    };
  }
  return null;
}
