import { z } from 'zod';

/**
 * Shared primitives. Every other contract file builds on these.
 *
 * Conventions used throughout the contracts package:
 *   - A schema and its inferred type share a name (`export const X` + `export type X`).
 *     TypeScript keeps values and types in separate namespaces, so this is legal and means a
 *     consumer writes `X` whether it needs the validator or the type.
 *   - All response objects are `.strict()`. An unexpected field is a contract violation and must
 *     fail loudly in contract tests rather than being silently ignored.
 *   - All timestamps are ISO-8601 UTC strings on the wire. Never Date objects, never epoch numbers.
 */

export const Uuid = z.string().uuid();
export type Uuid = z.infer<typeof Uuid>;

export const IsoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Email comparison is case-insensitive everywhere; normalise to lowercase at the edge. */
export const Email = z.string().email().transform((v) => v.toLowerCase());
export type Email = z.infer<typeof Email>;

/**
 * Name rules for anything a user can name — data rooms, folders, files.
 *
 * Lives here rather than beside any one resource because all three share it, and because the
 * same rules are enforced in three places: this schema, the DB CHECK constraint, and the
 * frontend field validator. All three derive from here so they cannot disagree.
 */
export const ResourceName = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty')
  .max(255, 'Name cannot exceed 255 characters')
  .refine((v) => !/[/\\]/.test(v), 'Name cannot contain / or \\')
  .transform((v) => v.normalize('NFC'));
export type ResourceName = z.infer<typeof ResourceName>;

/**
 * Opaque keyset cursor: base64url of `JSON.stringify({ t, n, i })` where `t` is the node type,
 * `n` is the lowercased name, and `i` is the node id.
 *
 * JSON rather than a delimited string on purpose — names may contain any character except `/`
 * and `\`, so any single-character delimiter would eventually collide with a real name and
 * produce a subtly wrong page boundary.
 *
 * Clients treat this as fully opaque and pass it back unmodified. The encoding is
 * backend-internal and may change without a contract break.
 */
export const Cursor = z.string().min(1).max(512);
export type Cursor = z.infer<typeof Cursor>;

export const PaginationQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/**
 * Every list response uses this envelope. `nextCursor === null` means the end of the collection
 * has been reached — it is the only end-of-list signal. Clients must not infer the end from
 * `items.length < limit`, because a filtered page can be short mid-collection.
 */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: Cursor.nullable(),
    })
    .strict();

export type Paginated<T> = { items: T[]; nextCursor: string | null };

/**
 * What the requesting identity may do with the resource being returned.
 *
 * The frontend chooses its layout from this field, never from the URL — see SPEC-09. A `viewer`
 * response also carries `shareRootId`.
 */
export const AccessLevel = z.enum(['owner', 'viewer']);
export type AccessLevel = z.infer<typeof AccessLevel>;

/**
 * Descriptor shape used by every contract file's `endpoints` export.
 *
 * Both tracks read these instead of hardcoding paths: the backend to declare routes, the
 * frontend to build its client and MSW handlers. A path typo becomes a compile error rather
 * than a 404 discovered at integration.
 */
export interface EndpointDescriptor {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path template with `:param` placeholders, relative to `API_BASE`. */
  readonly path: string;
  /** True when the endpoint accepts an `X-Share-Token` header for anonymous access. */
  readonly acceptsShareToken?: boolean;
  /** True when the endpoint may be called with no session at all. */
  readonly public?: boolean;
}

export const API_BASE = '/api/v1' as const;

/** Header carrying a public-link token for anonymous share browsing. */
export const SHARE_TOKEN_HEADER = 'x-share-token' as const;
