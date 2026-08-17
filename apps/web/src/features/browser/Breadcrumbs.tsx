import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { BreadcrumbDto } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { folderPath, type BrowseContext } from './browseContext';

export interface BreadcrumbItemProps {
  crumb: BreadcrumbDto;
  context: BrowseContext;
  isCurrent: boolean;
}

export function BreadcrumbItem({ crumb, context, isCurrent }: BreadcrumbItemProps): JSX.Element {
  return (
    <li className="flex min-w-0 items-center">
      {isCurrent ? (
        <span aria-current="page" className="truncate font-medium text-ink">
          {crumb.name}
        </span>
      ) : (
        <Link to={folderPath(context, crumb.id)} className="truncate text-ink-muted hover:text-ink">
          {crumb.name}
        </Link>
      )}
    </li>
  );
}

export interface BreadcrumbsProps {
  crumbs: BreadcrumbDto[];
  context: BrowseContext;
  /** Defensive truncation: the API already stops at the share root, and the UI must not undo it. */
  shareRootId: string;
  className?: string;
}

const COLLAPSE_ABOVE = 4;

/**
 * Renders only what the server sent. A viewer's trail starts at their share root, so the names of
 * folders above it never appear here — reconstructing a fuller path from ids the client happens to
 * hold would leak exactly what the backend went to the trouble of truncating.
 */
export function Breadcrumbs({
  crumbs,
  context,
  shareRootId,
  className,
}: BreadcrumbsProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const rootIndex = crumbs.findIndex((crumb) => crumb.id === shareRootId);
  const visible = rootIndex > 0 ? crumbs.slice(rootIndex) : crumbs;
  const collapse = !expanded && visible.length > COLLAPSE_ABOVE;

  const shown = collapse ? [visible[0], ...visible.slice(-2)] : visible;
  const hiddenCount = visible.length - shown.length;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {shown.map((crumb, index) => {
          if (crumb === undefined) return null;
          const isCurrent = crumb.id === visible[visible.length - 1]?.id;
          return (
            <div key={crumb.id} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              ) : null}
              {collapse && index === 1 ? (
                <>
                  <button
                    type="button"
                    aria-label={`Show ${String(hiddenCount)} hidden folders`}
                    className="rounded px-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
                    onClick={() => {
                      setExpanded(true);
                    }}
                  >
                    …
                  </button>
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                </>
              ) : null}
              <BreadcrumbItem crumb={crumb} context={context} isCurrent={isCurrent} />
            </div>
          );
        })}
      </ol>
    </nav>
  );
}
