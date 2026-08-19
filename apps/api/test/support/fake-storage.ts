import {
  mimeEssence,
  type DownloadOptions,
  type SignedUrl,
  type StorageService,
  type StoredObject,
  type UploadGrant,
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
  /**
   * What the store holds, keyed by object key. `contentType` is the header the *client* wrote on
   * its `PUT` — the whole point of `complete`'s check is that it need not equal what was declared
   * at `init`, so `putObject` takes it separately.
   */
  private readonly objects = new Map<string, { sizeBytes: number; contentType: string | null }>();

  /** Every URL minted, so a test can assert TTLs and dispositions rather than guess. */
  readonly minted: Array<{
    key: string;
    kind: 'upload' | 'download';
    ttlSeconds: number;
    disposition?: 'inline' | 'attachment';
    filename?: string;
    contentType?: string;
    allowOverwrite?: boolean;
  }> = [];

  createSignedUploadUrl(key: string, grant: UploadGrant): Promise<SignedUrl> {
    this.minted.push({
      key,
      kind: 'upload',
      ttlSeconds: grant.ttlSeconds,
      contentType: grant.contentType,
      allowOverwrite: grant.allowOverwrite,
    });
    return Promise.resolve({
      url: `https://storage.test/upload/${encodeURIComponent(key)}?n=${this.minted.length}`,
      expiresAt: new Date(Date.now() + grant.ttlSeconds * 1000),
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

  /**
   * Deliberately yields the event loop before answering.
   *
   * `stat` is the one call in the upload lifecycle that sits *between* reading a version's status
   * and writing it, and against Supabase it is a network round trip. A `Promise.resolve` here
   * settles on the microtask queue, so concurrent requests never interleave across it and the
   * suite cannot see any race that window opens — a `complete` that double-counts its rollup under
   * two simultaneous callers passed cleanly until this became a macrotask.
   *
   * A fake that is faster than the real thing is not a neutral simplification; it hides exactly
   * the class of bug that only appears under load.
   */
  async stat(key: string): Promise<StoredObject> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    const object = this.objects.get(key);
    if (object === undefined) return { exists: false, sizeBytes: 0, contentType: null };
    return {
      exists: true,
      sizeBytes: object.sizeBytes,
      contentType: mimeEssence(object.contentType),
    };
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  // ── test controls ────────────────────────────────────────────────────────────

  /**
   * Stand in for the browser's `PUT`: the bytes arrive without the API ever seeing them.
   *
   * `contentType` defaults to the type the grant for this key asked for, which is what an honest
   * client sends. Pass a different one to reproduce the declare-PDF-store-HTML case.
   */
  putObject(key: string, sizeBytes: number, contentType?: string): void {
    const granted = [...this.minted]
      .reverse()
      .find((entry) => entry.kind === 'upload' && entry.key === key)?.contentType;
    this.objects.set(key, { sizeBytes, contentType: contentType ?? granted ?? null });
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
