import { ArrowDown, ArrowUp } from 'lucide-react';
import type { NodeSortField } from '@dataroom/contracts';

export interface NodeTableHeaderProps {
  sort: NodeSortField;
  dir: 'asc' | 'desc';
  onSortChange: (sort: NodeSortField, dir: 'asc' | 'desc') => void;
}

const COLUMNS: { field: NodeSortField; label: string; className: string }[] = [
  { field: 'name', label: 'Name', className: 'min-w-0' },
  { field: 'size', label: 'Size', className: 'hidden sm:block' },
  { field: 'updatedAt', label: 'Modified', className: 'hidden sm:block' },
];

/**
 * Sortable on name, size and modified — and nothing else. Folders always precede files and the
 * header offers no way to change that, because the API does not support it and a control that
 * silently does nothing is worse than its absence.
 */
export function NodeTableHeader({ sort, dir, onSortChange }: NodeTableHeaderProps): JSX.Element {
  return (
    <div
      role="row"
      className="grid h-9 grid-cols-[minmax(0,1fr)_6rem_7rem_2.5rem] items-center gap-3 border-b border-line bg-surface-muted px-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:grid-cols-[minmax(0,1fr)_7rem_8rem_2.5rem]"
    >
      {COLUMNS.map((column) => {
        const isActive = sort === column.field;
        return (
          <div
            key={column.field}
            role="columnheader"
            aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={column.className}
          >
            <button
              type="button"
              className="flex items-center gap-1 uppercase hover:text-ink"
              onClick={() => {
                onSortChange(column.field, isActive && dir === 'asc' ? 'desc' : 'asc');
              }}
            >
              {column.label}
              {isActive ? (
                dir === 'asc' ? (
                  <ArrowUp aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <ArrowDown aria-hidden="true" className="h-3 w-3" />
                )
              ) : null}
            </button>
          </div>
        );
      })}
      <div role="columnheader" aria-label="Actions" />
    </div>
  );
}
