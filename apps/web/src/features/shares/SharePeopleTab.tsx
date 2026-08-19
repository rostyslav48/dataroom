import { useState } from 'react';
import type { ShareDto } from '@dataroom/contracts';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { isApiClientError } from '@/lib/api';
import { presentError } from '@/lib/errorMap';
import { EmailInput } from './EmailInput';
import { RecipientRow } from './RecipientRow';

export interface SharePeopleTabProps {
  share: ShareDto | undefined;
  isLoading: boolean;
  loadError: unknown;
  onInvite: (emails: string[]) => void;
  inviting: boolean;
  inviteError: unknown;
  onRevokeRecipient: (recipientId: string) => void;
  revokingRecipientId: string | null;
  revokeError: unknown;
  /** Revokes the whole share, ending access for everyone on it at once. */
  onRevokeShare: () => void;
  revokingShare: boolean;
}

/**
 * An invitation is refused per address, so the server's field message ("you cannot invite
 * yourself") is the one worth showing; `errorMap`'s title for `VALIDATION_FAILED` is deliberately
 * generic and would say nothing about which address was the problem.
 */
function inviteMessage(error: unknown): string {
  const detail = isApiClientError(error) ? error.details?.emails?.[0] : undefined;
  return detail ?? presentError(error).title;
}

export function SharePeopleTab({
  share,
  isLoading,
  loadError,
  onInvite,
  inviting,
  inviteError,
  onRevokeRecipient,
  revokingRecipientId,
  revokeError,
  onRevokeShare,
  revokingShare,
}: SharePeopleTabProps): JSX.Element {
  const [pending, setPending] = useState<string[]>([]);
  const recipients = share?.recipients ?? [];

  if (isLoading) {
    return (
      <div role="status" className="space-y-2 py-2">
        <span className="sr-only">Loading who has access</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }

  if (loadError !== null && loadError !== undefined) {
    return (
      <p role="alert" className="py-2 text-sm text-danger">
        {presentError(loadError).title}
      </p>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-ink-muted">
        People invited here must sign in with the Google account matching their address. Nobody else
        can open it, even with the URL.
      </p>

      <EmailInput
        emails={pending}
        onChange={setPending}
        existing={recipients
          .filter((recipient) => recipient.revokedAt === null)
          .map((recipient) => recipient.email)}
        disabled={inviting}
      />

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={pending.length === 0}
          busy={inviting}
          onClick={() => {
            onInvite(pending);
            setPending([]);
          }}
        >
          {pending.length <= 1 ? 'Invite' : `Invite ${String(pending.length)} people`}
        </Button>
        {inviteError === null || inviteError === undefined ? null : (
          <span role="alert" className="text-sm text-danger">
            {inviteMessage(inviteError)}
          </span>
        )}
      </div>

      {revokeError === null || revokeError === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {presentError(revokeError).title}
        </p>
      )}

      {recipients.length === 0 ? (
        <p className="text-sm text-ink-muted">Nobody has been invited to this item yet.</p>
      ) : (
        <>
          <ul>
            {recipients.map((recipient) => (
              <RecipientRow
                key={recipient.id}
                recipient={recipient}
                revoking={revokingRecipientId === recipient.id}
                onRevoke={onRevokeRecipient}
              />
            ))}
          </ul>

          {/*
            Removing people one at a time is the ordinary case; this is the "take it back from
            everyone, now" case, and an owner should not have to click N times to get there under
            time pressure. Both exist because they mean different things — the per-row control
            revokes one grant, this revokes the share itself, so a later invitation starts a new
            share rather than reopening an old one.
          */}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm text-ink-muted">
              Ends access for everyone invited here. It cannot be undone — you would need to invite
              them again.
            </p>
            <Button
              variant="danger"
              busy={revokingShare}
              className="shrink-0"
              onClick={onRevokeShare}
            >
              Stop sharing
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
