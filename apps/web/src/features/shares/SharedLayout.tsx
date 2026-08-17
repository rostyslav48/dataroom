import { Eye } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SharedLayoutProps {
  /** Display name of the owner, when the caller is entitled to know it. */
  ownerName?: string | undefined;
  itemName: string;
  /** True on the `/s/:token` tree, which has no app shell around it. */
  standalone: boolean;
  children: ReactNode;
}

/**
 * Read-only chrome.
 *
 * It contains no rename, move, delete, upload or share control — not disabled ones, none at all.
 * Read-only is enforced server-side; this layout exists so the interface never offers an action
 * the guard would refuse. Anything a viewer sees here is something they can actually do.
 */
export function SharedLayout({
  ownerName,
  itemName,
  standalone,
  children,
}: SharedLayoutProps): JSX.Element {
  return (
    <div className={standalone ? 'flex min-h-full flex-col bg-surface-muted' : ''}>
      {standalone ? (
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <span className="text-sm font-semibold text-ink">Data Room</span>
          <span aria-hidden="true" className="text-ink-subtle">
            /
          </span>
          <span className="truncate text-sm text-ink-muted">{itemName}</span>
        </header>
      ) : null}

      <div className={standalone ? 'mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6' : ''}>
        <p
          data-testid="shared-banner"
          className="mb-4 flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted"
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          <span>
            {ownerName === undefined
              ? 'Shared with you · view only'
              : `Shared by ${ownerName} · view only`}
          </span>
        </p>
        {children}
      </div>
    </div>
  );
}
