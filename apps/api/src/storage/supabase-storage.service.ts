import { Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import type {
  DownloadOptions,
  SignedUrl,
  StorageService,
  StoredObject,
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

  async createSignedUploadUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(key, { upsert: true });

    if (error || !data) {
      this.logger.error({ key, err: error }, 'failed to mint a signed upload url');
      throw errors.internal('Could not start the upload. Try again.');
    }

    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
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
        // The name is sanitised anyway: a filename is user input, and it must not be able to inject
        // a header.
        options.disposition === 'attachment' ? { download: sanitizeFilename(options.filename) } : {},
      );

    if (error || !data) {
      this.logger.error({ key, err: error }, 'failed to mint a signed download url');
      throw errors.internal('Could not open the file. Try again.');
    }

    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /**
   * The size storage actually holds, which is the only size worth recording. What the client
   * declared at `init` was a hint for the cap check, and a caller that declares 1 MB and uploads
   * 500 MB is exactly what this call exists to catch.
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
    if (!object) return { exists: false, sizeBytes: 0 };

    const size = (object.metadata as { size?: number } | null)?.size;
    return { exists: true, sizeBytes: typeof size === 'number' ? size : 0 };
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    // Best-effort by design: the sweeper is the real backstop, and a failed cleanup must never
    // fail the user's request.
    if (error) this.logger.warn({ key, err: error }, 'failed to delete an object');
  }
}

/** Strips anything that could break out of a `Content-Disposition` filename. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, '').slice(0, 200) || 'download';
}
