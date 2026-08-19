import { Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import {
  mimeEssence,
  sanitizeFilename,
  type DownloadOptions,
  type SignedUrl,
  type StorageService,
  type StoredObject,
  type UploadGrant,
} from './storage.service';

/**
 * Supabase Storage, used as an S3-shaped object store and nothing else — no Supabase Auth, no RLS,
 * no client SDK in the browser. Every access decision stays in `PermissionService`, which is the
 * right posture for a product whose entire value proposition is access control.
 *
 * The service-role key lives only here, on the server. It is never sent to the browser and never
 * given a `VITE_` prefix.
 */
@Injectable()
export class SupabaseStorageService implements StorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const { url, serviceRoleKey, bucket } = config.storage;
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = bucket;
  }

  /**
   * `upsert` is passed through from the grant rather than hard-coded on, so only `retry` can
   * overwrite. See `UploadGrant.allowOverwrite`.
   *
   * The grant's `contentType` is **not** expressible as a condition on a Supabase signed upload
   * URL — the JS client's `createSignedUploadUrl` takes only `upsert`, and the token it signs
   * carries no content-type claim. It is enforced on the way out instead: `complete` reads back
   * what storage recorded and refuses to promote a version whose stored type disagrees with the
   * declared one (`UploadsService.complete`). Moving to the S3-compatible endpoint, where a
   * presigned `PUT` *can* carry a `Content-Type` condition, would let the grant itself refuse the
   * write — this interface exists so that swap costs one file.
   */
  async createSignedUploadUrl(key: string, grant: UploadGrant): Promise<SignedUrl> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(key, { upsert: grant.allowOverwrite });

    if (error || !data) {
      this.logger.error({ key, err: error }, 'failed to mint a signed upload url');
      throw errors.internal('Could not start the upload. Try again.');
    }

    return { url: data.signedUrl, expiresAt: new Date(Date.now() + grant.ttlSeconds * 1000) };
  }

  async createSignedDownloadUrl(
    key: string,
    ttlSeconds: number,
    options: DownloadOptions,
  ): Promise<SignedUrl> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(
        key,
        ttlSeconds,
        // Supabase turns `download` into the Content-Disposition filename and encodes it itself.
        // Sanitised again here, even though callers already sanitise: this is the last line before
        // a user-controlled string becomes a header, and it is idempotent, so the cost of keeping
        // it is nothing and the cost of a caller that forgets is a header injection.
        options.disposition === 'attachment' ? { download: sanitizeFilename(options.filename) } : {},
      );

    if (error || !data) {
      this.logger.error({ key, err: error }, 'failed to mint a signed download url');
      throw errors.internal('Could not open the file. Try again.');
    }

    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /**
   * The size **and type** storage actually holds, which are the only ones worth recording. What the
   * client declared at `init` was a hint for the cap check and the allowlist; a caller that declares
   * `1 MB, application/pdf` and stores `500 MB, text/html` is exactly what this call exists to
   * catch. The browser writes both of those headers itself on a direct `PUT`, so neither is a fact
   * about the file until storage confirms it.
   */
  async stat(key: string): Promise<StoredObject> {
    const lastSlash = key.lastIndexOf('/');
    const prefix = lastSlash === -1 ? '' : key.slice(0, lastSlash);
    const name = key.slice(lastSlash + 1);

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { limit: 1, search: name });

    if (error) {
      this.logger.error({ key, err: error }, 'failed to stat an object');
      throw errors.internal('Could not verify the upload. Try again.');
    }

    const object = data?.find((entry) => entry.name === name);
    if (!object) return { exists: false, sizeBytes: 0, contentType: null };

    const metadata = object.metadata as { size?: number; mimetype?: string } | null;
    return {
      exists: true,
      sizeBytes: typeof metadata?.size === 'number' ? metadata.size : 0,
      contentType: mimeEssence(metadata?.mimetype),
    };
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    // Best-effort by design: the sweeper is the real backstop, and a failed cleanup must never
    // fail the user's request.
    if (error) this.logger.warn({ key, err: error }, 'failed to delete an object');
  }
}
