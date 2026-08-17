import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import type { ShareDto } from '@dataroom/contracts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { copyText } from '@/lib/browser';
import { presentError } from '@/lib/errorMap';
import { formatDate } from '@/lib/format';

export type ExpiryChoice = 'never' | '7d' | '30d';

export function expiryToIso(choice: ExpiryChoice, now = new Date()): string | null {
  if (choice === 'never') return null;
  const days = choice === '7d' ? 7 : 30;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface ShareLinkTabProps {
  link: ShareDto | undefined;
  isCreating: boolean;
  createError: unknown;
  onCreate: (expiry: ExpiryChoice) => void;
  onRevoke: () => void;
  revoking: boolean;
  revokeError: unknown;
  /** True once this tab has been opened; the link is minted then, never on dialog open. */
  activated: boolean;
}

/**
 * The public-link tab.
 *
 * A link is minted the first time this tab is opened — not when the dialog opens. Merely looking
 * at the sharing settings of an acquisition data room must not create a URL that grants anyone
 * holding it read access.
 */
export function ShareLinkTab({
  link,
  isCreating,
  createError,
  onCreate,
  onRevoke,
  revoking,
  revokeError,
  activated,
}: ShareLinkTabProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryChoice>('never');

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  if (!activated || isCreating) {
    return (
      <div role="status" className="space-y-2 py-2">
        <span className="sr-only">Preparing the link</span>
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (createError !== null && createError !== undefined) {
    return (
      <div className="py-2">
        <p role="alert" className="text-sm text-danger">
          {presentError(createError).title}
        </p>
        <Button
          className="mt-2"
          onClick={() => {
            onCreate(expiry);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (link === undefined || link.url === null) {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-ink-muted">
          There is no active link for this item. Anyone you give a new link to will be able to view
          it, and they can forward it.
        </p>
        <div className="flex items-end gap-2">
          <ExpirySelect value={expiry} onChange={setExpiry} />
          <Button
            variant="primary"
            leadingIcon={<Link2 aria-hidden="true" className="h-4 w-4" />}
            onClick={() => {
              onCreate(expiry);
            }}
          >
            Create link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-ink-muted">
        <strong className="font-medium text-ink">Anyone with this link can view</strong> this item
        and everything inside it, and they can forward the link. Set an expiry to limit how long
        that lasts.
      </p>

      <div className="flex items-center gap-2">
        <Input readOnly value={link.url} aria-label="Public link URL" className="font-mono text-xs" />
        <Button
          leadingIcon={
            copied ? (
              <Check aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Copy aria-hidden="true" className="h-4 w-4" />
            )
          }
          onClick={() => {
            void copyText(link.url ?? '').then((ok) => {
              setCopied(ok);
            });
          }}
        >
          {/* The confirmation belongs on the button that was clicked, not in a toast across the page. */}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <p className="text-sm text-ink-muted">
        {link.expiresAt === null
          ? 'This link does not expire.'
          : `Expires on ${formatDate(link.expiresAt)}.`}
      </p>

      {revokeError === null || revokeError === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {presentError(revokeError).title}
        </p>
      )}

      {confirmingRevoke ? (
        <div className="rounded-md border border-danger/40 bg-danger-subtle p-3">
          <p className="text-sm text-ink">
            Revoking stops this link working for everyone who has it, immediately.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" busy={revoking} onClick={onRevoke}>
              Revoke link
            </Button>
            <Button
              onClick={() => {
                setConfirmingRevoke(false);
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => {
            setConfirmingRevoke(true);
          }}
        >
          Revoke link
        </Button>
      )}
    </div>
  );
}

interface ExpirySelectProps {
  value: ExpiryChoice;
  onChange: (value: ExpiryChoice) => void;
}

function ExpirySelect({ value, onChange }: ExpirySelectProps): JSX.Element {
  return (
    <div>
      <label className="block text-sm font-medium text-ink" htmlFor="share-link-expiry">
        Expiry
      </label>
      <select
        id="share-link-expiry"
        className="mt-1 h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as ExpiryChoice);
        }}
      >
        <option value="never">No expiry</option>
        <option value="7d">7 days</option>
        <option value="30d">30 days</option>
      </select>
    </div>
  );
}
