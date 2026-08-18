import type {
  DownloadOptions,
  SignedUrl,
  StorageService,
  StoredObject,
} from '../../src/storage/storage.service';

/**
 * An in-memory object store for the integration tests.
 *
 * The alternative — pointing the suite at a real Supabase bucket — would make every test depend on
 * a network round trip to a third party, on credentials in CI, and on nobody else's test run
 * touching the same keys. The interface exists precisely so this substitution costs nothing, and
 * the behaviours the tests care about (an object missing at `complete`, a size that disagrees with
 * what was declared, a URL that has expired) are all reproducible here and awkward to arrange
 * against the real thing.
 */
export class FakeStorageService implements StorageService {
  private readonly objects = new Map<string, number>();

  /** Every URL minted, so a test can assert TTLs and dispositions rather than guess. */
  readonly minted: Array<{
    key: string;
    kind: 'upload' | 'download';
    ttlSeconds: number;
    disposition?: 'inline' | 'attachment';
    filename?: string;
  }> = [];

  createSignedUploadUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    this.minted.push({ key, kind: 'upload', ttlSeconds });
    return Promise.resolve({
      url: `https://storage.test/upload/${encodeURIComponent(key)}?n=${this.minted.length}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
  }

  createSignedDownloadUrl(
    key: string,
    ttlSeconds: number,
    options: DownloadOptions,
  ): Promise<SignedUrl> {
    this.minted.push({
      key,
      kind: 'download',
      ttlSeconds,
      disposition: options.disposition,
      filename: options.filename,
    });
    const download = options.disposition === 'attachment' ? `&download=${options.filename}` : '';
    return Promise.resolve({
      url: `https://storage.test/object/${encodeURIComponent(key)}?ttl=${ttlSeconds}${download}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
  }

  stat(key: string): Promise<StoredObject> {
    const size = this.objects.get(key);
    return Promise.resolve(
      size === undefined ? { exists: false, sizeBytes: 0 } : { exists: true, sizeBytes: size },
    );
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  // ── test controls ────────────────────────────────────────────────────────────

  /** Stand in for the browser's `PUT`: the bytes arrive without the API ever seeing them. */
  putObject(key: string, sizeBytes: number): void {
    this.objects.set(key, sizeBytes);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  get keys(): string[] {
    return [...this.objects.keys()];
  }

  reset(): void {
    this.objects.clear();
    this.minted.length = 0;
  }

  lastMinted(kind: 'upload' | 'download'): (typeof this.minted)[number] | undefined {
    return [...this.minted].reverse().find((entry) => entry.kind === kind);
  }
}
