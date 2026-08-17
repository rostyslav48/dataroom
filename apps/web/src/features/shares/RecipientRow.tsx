import { useState } from 'react';
import type { ShareRecipientDto } from '@dataroom/contracts';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export type RecipientStatus = 'Invited' | 'Active' | 'Revoked';

export function statusOf(recipient: ShareRecipientDto): RecipientStatus {
  if (recipient.revokedAt !== null) return 'Revoked';
  return recipient.acceptedAt === null ? 'Invited' : 'Active';
}

export interface RecipientRowProps {
  recipient: ShareRecipientDto;
  onRevoke: (recipientId: string) => void;
  revoking: boolean;
}

/**
 * "Invited" means the address has no account yet — the grant waits for their first sign-in. Saying
 * so removes the most common support question in permissioned sharing: "I shared it, why can't
 * they see it?"
 */
export function RecipientRow({ recipient, onRevoke, revoking }: RecipientRowProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const status = statusOf(recipient);

  return (
    <li className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{recipient.email}</span>
      <span
        className={cn(
          'rounded px-2 py-0.5 text-xs',
          status === 'Active'
            ? 'bg-accent-subtle text-accent'
            : status === 'Invited'
              ? 'bg-surface-sunken text-ink-muted'
              : 'bg-danger-subtle text-danger',
        )}
      >
        {status}
      </span>

      {status === 'Revoked' ? null : confirming ? (
        <span className="flex items-center gap-1">
          <span className="text-xs text-ink-muted">{`Remove ${recipient.email}?`}</span>
          <Button
            size="sm"
            variant="danger"
            busy={revoking}
            onClick={() => {
              onRevoke(recipient.id);
            }}
          >
            Remove
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          aria-label={`Remove access for ${recipient.email}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Remove
        </Button>
      )}
    </li>
  );
}
