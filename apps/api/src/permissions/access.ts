import { DomainError, errors } from '../common/domain-error';

/**
 * The answer to the only authorization question this application asks: *may this identity read
 * this node, and as what?*
 *
 * A denial carries its **reason**, not just a boolean, because the six reasons have six different
 * screens. "403" alone is the most confusing failure in every sharing product: the user cannot
 * tell whether to ask for access again, sign in as someone else, or give up.
 */
export type DeniedReason =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ACCESS_REVOKED'
  | 'SHARE_EXPIRED'
  | 'WRONG_ACCOUNT'
  | 'ITEM_GONE';

export interface AccessGranted {
  granted: true;
  role: 'owner' | 'viewer';
  /**
   * Where this caller's grant begins. Breadcrumbs are truncated here, so a viewer given one nested
   * folder never learns the names of its ancestors — which would disclose the folder structure of
   * an acquisition target.
   */
  shareRootId: string;
  /** The share that granted it, or null for an owner. */
  shareId: string | null;
}

export interface AccessDenied {
  granted: false;
  reason: DeniedReason;
  /**
   * For `WRONG_ACCOUNT` only, and masked (`v•••@example.com`): enough for someone to recognise
   * which of their own accounts was invited, not enough to harvest a third party's address from a
   * node id.
   */
  invitedEmailHint?: string;
}

export type Access = AccessGranted | AccessDenied;

export const denied = (reason: DeniedReason, invitedEmailHint?: string): AccessDenied => ({
  granted: false,
  reason,
  ...(invitedEmailHint === undefined ? {} : { invitedEmailHint }),
});

/** `viewer@example.com` → `v•••@example.com`. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/** The single mapping from a denial to the error the client sees. */
export function accessError(access: AccessDenied): DomainError {
  switch (access.reason) {
    case 'NOT_FOUND':
      return errors.notFound();
    case 'ITEM_GONE':
      return errors.itemGone();
    case 'ACCESS_REVOKED':
      return errors.accessRevoked();
    case 'SHARE_EXPIRED':
      return errors.shareExpired();
    case 'WRONG_ACCOUNT':
      return new DomainError(
        'WRONG_ACCOUNT',
        'This was shared with a different account.',
        access.invitedEmailHint ? { invitedEmail: [access.invitedEmailHint] } : undefined,
      );
    case 'FORBIDDEN':
      return errors.forbidden();
  }
}
