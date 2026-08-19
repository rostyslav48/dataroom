/**
 * The upload PUT, over XMLHttpRequest.
 *
 * `fetch` cannot report upload progress — there is no stream to observe on the request side in any
 * shipping browser — so every progress bar built on it is an animation pretending to be a
 * measurement. XHR's `upload.onprogress` is a real byte count, and this app shows nothing else.
 */

export class UploadTransportError extends Error {
  readonly status: number;
  readonly kind: 'http' | 'network' | 'aborted';

  constructor(message: string, kind: 'http' | 'network' | 'aborted', status = 0) {
    super(message);
    this.name = 'UploadTransportError';
    this.kind = kind;
    this.status = status;
  }
}

export interface PutWithProgressOptions {
  url: string;
  file: File;
  /**
   * The type this upload was **declared** as at `init`, sent verbatim.
   *
   * Storage records whatever header arrives here, and `POST /uploads/:versionId/complete` refuses
   * to promote a version whose stored type disagrees with the declared one. Sending anything else —
   * including omitting the header and letting storage guess — fails the upload at `complete`.
   */
  contentType: string;
  onProgress: (percent: number) => void;
  /** Handed the request so the caller can abort it; cancellation is a first-class case here. */
  onStart?: (xhr: XMLHttpRequest) => void;
}

export function putWithProgress({
  url,
  file,
  contentType,
  onProgress,
  onStart,
}: PutWithProgressOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (contentType !== '') xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event: ProgressEvent): void => {
      // A zero-byte file is legal, and dividing by its size is not: it reports as complete.
      const percent =
        event.lengthComputable && event.total > 0
          ? Math.min(100, Math.round((event.loaded / event.total) * 100))
          : 100;
      onProgress(percent);
    };

    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(
        new UploadTransportError(
          `Storage rejected the upload (HTTP ${String(xhr.status)})`,
          'http',
          xhr.status,
        ),
      );
    };

    xhr.onerror = (): void => {
      reject(new UploadTransportError('The connection dropped during the upload', 'network'));
    };

    xhr.ontimeout = (): void => {
      reject(new UploadTransportError('The upload timed out', 'network'));
    };

    xhr.onabort = (): void => {
      reject(new UploadTransportError('Upload canceled', 'aborted'));
    };

    onStart?.(xhr);
    xhr.send(file);
  });
}
