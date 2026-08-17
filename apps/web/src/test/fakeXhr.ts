import { vi } from 'vitest';

/**
 * A controllable XMLHttpRequest.
 *
 * Progress is the point of the upload UI, so the tests drive real `upload.onprogress` events
 * through this rather than asserting on an animation. Every instance registers itself so a test
 * can decide when — and whether — each request succeeds.
 */
export class FakeXhr {
  static instances: FakeXhr[] = [];

  method = '';
  url = '';
  status = 0;
  body: unknown = null;
  aborted = false;
  headers: Record<string, string> = {};

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  // ── test controls ──────────────────────────────────────────────────────────────────────────

  emitProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }

  succeed(status = 200): void {
    this.status = status;
    this.onload?.();
  }

  fail(status = 500): void {
    this.status = status;
    this.onload?.();
  }

  networkError(): void {
    this.onerror?.();
  }

  static reset(): void {
    FakeXhr.instances = [];
  }

  static last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (instance === undefined) throw new Error('No XMLHttpRequest was created');
    return instance;
  }
}

export function installFakeXhr(): void {
  FakeXhr.reset();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
}

export function restoreXhr(): void {
  vi.unstubAllGlobals();
  FakeXhr.reset();
}
