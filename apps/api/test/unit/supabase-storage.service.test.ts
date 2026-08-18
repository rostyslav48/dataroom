import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` is hoisted above the imports, so the spy has to be hoisted with it — a plain `const`
// here is still in its temporal dead zone when the factory runs.
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { DomainError } from '../../src/common/domain-error';
import type { AppConfig } from '../../src/config/app.config';
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service';

interface StoredEntry {
  name: string;
  metadata: { size?: number } | null;
}

/**
 * The bucket API, recorded rather than reimplemented. Every test asserts on what the service asked
 * Supabase for, because that is the whole of its behaviour: this class holds no state and makes no
 * decisions — it translates.
 */
class FakeBucket {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  signedUpload: { data: { signedUrl: string } | null; error: { message: string } | null } = {
    data: { signedUrl: 'https://project.supabase.co/upload/signed' },
    error: null,
  };

  signedDownload: { data: { signedUrl: string } | null; error: { message: string } | null } = {
    data: { signedUrl: 'https://project.supabase.co/object/signed' },
    error: null,
  };

  listed: { data: StoredEntry[] | null; error: { message: string } | null } = {
    data: [],
    error: null,
  };

  removed: { error: { message: string } | null } = { error: null };

  createSignedUploadUrl(...args: unknown[]): typeof this.signedUpload {
    this.calls.push({ method: 'createSignedUploadUrl', args });
    return this.signedUpload;
  }

  createSignedUrl(...args: unknown[]): typeof this.signedDownload {
    this.calls.push({ method: 'createSignedUrl', args });
    return this.signedDownload;
  }

  list(...args: unknown[]): typeof this.listed {
    this.calls.push({ method: 'list', args });
    return this.listed;
  }

  remove(...args: unknown[]): typeof this.removed {
    this.calls.push({ method: 'remove', args });
    return this.removed;
  }

  argsOf(method: string): unknown[] {
    const call = this.calls.find((entry) => entry.method === method);
    expect(call, `${method} was called`).toBeDefined();
    return (call as { args: unknown[] }).args;
  }
}

const config = {
  storage: {
    url: 'https://project.supabase.co',
    serviceRoleKey: 'service-role-key',
    bucket: 'documents',
  },
} as AppConfig;

describe('SupabaseStorageService', () => {
  let bucket: FakeBucket;
  let from: ReturnType<typeof vi.fn>;
  let service: SupabaseStorageService;

  beforeEach(() => {
    bucket = new FakeBucket();
    from = vi.fn(() => bucket);
    createClient.mockReset();
    createClient.mockReturnValue({ storage: { from } });
    service = new SupabaseStorageService(config);
  });

  describe('construction', () => {
    it('uses the service-role key and keeps no session', () => {
      // A persisted session in a server process is shared state between requests, and this client
      // is only ever used as the one privileged identity that can reach a private bucket.
      expect(createClient).toHaveBeenCalledWith('https://project.supabase.co', 'service-role-key', {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    });

    it('reads the bucket from config rather than hardcoding one', async () => {
      await service.delete('room/node/version');
      expect(from).toHaveBeenCalledWith('documents');
    });
  });

  describe('createSignedUploadUrl', () => {
    it('returns the signed url with an expiry the requested number of seconds out', async () => {
      const before = Date.now();
      const signed = await service.createSignedUploadUrl('room/node/version', 3600);

      expect(signed.url).toBe('https://project.supabase.co/upload/signed');
      const ttlMs = signed.expiresAt.getTime() - before;
      expect(ttlMs).toBeGreaterThanOrEqual(3_600_000 - 1_000);
      expect(ttlMs).toBeLessThanOrEqual(3_600_000 + 1_000);
    });

    it('upserts, so a retry writes over the reservation instead of failing', async () => {
      await service.createSignedUploadUrl('room/node/version', 3600);
      expect(bucket.argsOf('createSignedUploadUrl')).toEqual([
        'room/node/version',
        { upsert: true },
      ]);
    });

    it('turns a storage failure into an internal error, disclosing nothing', async () => {
      bucket.signedUpload = { data: null, error: { message: 'bucket "documents" not found' } };

      const error = await service.createSignedUploadUrl('room/node/version', 3600).catch((e) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INTERNAL');
      // The bucket name and the provider's phrasing stay in the log, not in the response.
      expect((error as DomainError).message).not.toContain('documents');
    });

    it('fails rather than returning an unsigned url when data comes back empty', async () => {
      bucket.signedUpload = { data: null, error: null };
      await expect(service.createSignedUploadUrl('room/node/version', 3600)).rejects.toBeInstanceOf(
        DomainError,
      );
    });
  });

  describe('createSignedDownloadUrl', () => {
    it('asks for a plain url when the disposition is inline', async () => {
      const signed = await service.createSignedDownloadUrl('room/node/version', 60, {
        disposition: 'inline',
        filename: 'NDA.pdf',
      });

      expect(signed.url).toBe('https://project.supabase.co/object/signed');
      // No `download` option: passing one would make the viewer's iframe save the file instead of
      // rendering it.
      expect(bucket.argsOf('createSignedUrl')).toEqual(['room/node/version', 60, {}]);
    });

    it('passes the filename as `download` when the disposition is an attachment', async () => {
      await service.createSignedDownloadUrl('room/node/version', 60, {
        disposition: 'attachment',
        filename: 'NDA.pdf',
      });

      expect(bucket.argsOf('createSignedUrl')).toEqual([
        'room/node/version',
        60,
        { download: 'NDA.pdf' },
      ]);
    });

    it('sanitises the filename on the way out, even though callers already do', async () => {
      // Defence in depth at the last line before a user-controlled string becomes a header. The
      // sanitiser is idempotent, so keeping it here costs nothing and a caller that forgets costs
      // a header injection.
      await service.createSignedDownloadUrl('room/node/version', 60, {
        disposition: 'attachment',
        filename: 'in"voice\r\nX-Injected: 1.pdf',
      });

      const [, , options] = bucket.argsOf('createSignedUrl');
      expect(options).toEqual({ download: 'invoiceX-Injected: 1.pdf' });
    });

    it('turns a storage failure into an internal error', async () => {
      bucket.signedDownload = { data: null, error: { message: 'Object not found' } };

      const error = await service
        .createSignedDownloadUrl('room/node/version', 60, {
          disposition: 'inline',
          filename: 'NDA.pdf',
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INTERNAL');
    });

    it('expires in the seconds it was given, not in the seconds Supabase was given', async () => {
      const before = Date.now();
      const signed = await service.createSignedDownloadUrl('room/node/version', 60, {
        disposition: 'inline',
        filename: 'NDA.pdf',
      });
      expect(signed.expiresAt.getTime() - before).toBeLessThanOrEqual(61_000);
      expect(signed.expiresAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('stat', () => {
    it('lists the object’s own directory and matches the name exactly', async () => {
      bucket.listed = { data: [{ name: 'version', metadata: { size: 2048 } }], error: null };

      const object = await service.stat('room/node/version');

      expect(object).toEqual({ exists: true, sizeBytes: 2048 });
      expect(bucket.argsOf('list')).toEqual(['room/node', { limit: 1, search: 'version' }]);
    });

    it('reports a missing object rather than throwing', async () => {
      bucket.listed = { data: [], error: null };
      expect(await service.stat('room/node/version')).toEqual({ exists: false, sizeBytes: 0 });
    });

    it('does not accept a near-miss that `search` happened to return', async () => {
      // Supabase's `search` is a prefix match, so a sibling key can come back. Treating it as the
      // object would let `complete` promote a version against somebody else's bytes.
      bucket.listed = { data: [{ name: 'version-2', metadata: { size: 9999 } }], error: null };
      expect(await service.stat('room/node/version')).toEqual({ exists: false, sizeBytes: 0 });
    });

    it('treats an object with no size metadata as existing but empty', async () => {
      bucket.listed = { data: [{ name: 'version', metadata: null }], error: null };
      // `complete` compares sizes exactly, so a zero here rejects the upload — the honest outcome
      // when storage will not say how big the object is.
      expect(await service.stat('room/node/version')).toEqual({ exists: true, sizeBytes: 0 });
    });

    it('handles a key with no prefix', async () => {
      bucket.listed = { data: [{ name: 'orphan', metadata: { size: 1 } }], error: null };
      await service.stat('orphan');
      expect(bucket.argsOf('list')).toEqual(['', { limit: 1, search: 'orphan' }]);
    });

    it('throws when storage cannot answer, rather than reporting the object missing', async () => {
      // The difference matters: "missing" makes `complete` tell the user their upload failed, and
      // the sweeper would eventually delete a file that is really there.
      bucket.listed = { data: null, error: { message: 'timeout' } };

      const error = await service.stat('room/node/version').catch((e) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INTERNAL');
    });
  });

  describe('delete', () => {
    it('removes the one key it was given', async () => {
      await service.delete('room/node/version');
      expect(bucket.argsOf('remove')).toEqual([['room/node/version']]);
    });

    it('never throws, because a failed cleanup must not fail the user’s request', async () => {
      // The rows are already gone by the time this runs — `abort` succeeded from the caller's
      // point of view — and the orphaned object is the sweeper's problem.
      bucket.removed = { error: { message: 'permission denied' } };
      await expect(service.delete('room/node/version')).resolves.toBeUndefined();
    });
  });
});
