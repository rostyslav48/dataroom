import { z } from 'zod';
import { Email, EndpointDescriptor, IsoDateTime, Uuid } from './common.contract';
import { NodeType } from './nodes.contract';

/** Sharing. See SPEC-05 (backend) and SPEC-09 (frontend). */

export const ShareType = z.enum(['public_link', 'permissioned']);
export type ShareType = z.infer<typeof ShareType>;

/**
 * Only `viewer` exists in the MVP. The field is present so that adding `editor` is an enum
 * change plus a permission matrix, not a remodel — see ProjectDesc/07-scaling-notes.md §3.
 * Every consumer must already treat this as a value, never as an implied constant.
 */
export const ShareRole = z.enum(['viewer']);
export type ShareRole = z.infer<typeof ShareRole>;

export const ShareRecipientDto = z
  .object({
    id: Uuid,
    email: Email,
    /** Null until the invitee first signs in with a matching Google account. */
    userId: Uuid.nullable(),
    invitedAt: IsoDateTime,
    acceptedAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime.nullable(),
  })
  .strict();
export type ShareRecipientDto = z.infer<typeof ShareRecipientDto>;

export const ShareDto = z
  .object({
    id: Uuid,
    nodeId: Uuid,
    nodeName: z.string(),
    nodeType: NodeType,
    type: ShareType,
    role: ShareRole,
    /**
     * Absolute URL for a public link. Null for permissioned shares, and null once revoked.
     * The raw token is never returned separately — the frontend only ever needs the URL.
     */
    url: z.string().url().nullable(),
    expiresAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime.nullable(),
    /** Empty for public links. */
    recipients: z.array(ShareRecipientDto),
    createdAt: IsoDateTime,
  })
  .strict();
export type ShareDto = z.infer<typeof ShareDto>;

export const CreateShareBody = z
  .object({
    type: ShareType,
    expiresAt: IsoDateTime.nullable().default(null),
    /** Required and non-empty for `permissioned`; must be omitted or empty for `public_link`. */
    recipients: z.array(Email).max(50).default([]),
  })
  .strict()
  .refine(
    (v) => (v.type === 'permissioned' ? v.recipients.length > 0 : v.recipients.length === 0),
    { message: 'permissioned shares require recipients; public links must have none', path: ['recipients'] },
  );
export type CreateShareBody = z.infer<typeof CreateShareBody>;

export const AddRecipientsBody = z
  .object({ emails: z.array(Email).min(1).max(50) })
  .strict();
export type AddRecipientsBody = z.infer<typeof AddRecipientsBody>;

export const ListSharesResponse = z.object({ shares: z.array(ShareDto) }).strict();
export type ListSharesResponse = z.infer<typeof ListSharesResponse>;

/**
 * `GET /shared/:token` — the only unauthenticated data endpoint. Resolves a public link to its
 * entry point so the frontend knows where to start browsing.
 *
 * Deliberately minimal: it reveals the shared node's own name and nothing about its ancestors,
 * siblings, or the owner's other content. Rate-limited, and served with `X-Robots-Tag: noindex`.
 */
export const ResolveShareResponse = z
  .object({
    shareId: Uuid,
    nodeId: Uuid,
    nodeName: z.string(),
    nodeType: NodeType,
    role: ShareRole,
    expiresAt: IsoDateTime.nullable(),
    /** Display name only, for the "Shared by …" banner. No email, no user id. */
    ownerName: z.string(),
  })
  .strict();
export type ResolveShareResponse = z.infer<typeof ResolveShareResponse>;

export const shareEndpoints = {
  listForNode:     { method: 'GET',    path: '/nodes/:id/shares' },
  create:          { method: 'POST',   path: '/nodes/:id/shares' },
  /** The owner's revocation console — every live share across one room. */
  listForRoom:     { method: 'GET',    path: '/data-rooms/:id/shares' },
  addRecipients:   { method: 'POST',   path: '/shares/:id/recipients' },
  revokeRecipient: { method: 'DELETE', path: '/shares/:id/recipients/:recipientId' },
  revoke:          { method: 'DELETE', path: '/shares/:id' },
  resolve:         { method: 'GET',    path: '/shared/:token', public: true },
} as const satisfies Record<string, EndpointDescriptor>;
