import { useState, type ReactNode } from 'react';
import type { NodeListItem, NodeSortField } from '@dataroom/contracts';
import { NodeRow, type RenameController } from './NodeRow';
import type { NodeActions } from './NodeActionsMenu';
import { NodeTableHeader } from './NodeTableHeader';
import { EmptyFolderState, ListErrorState, SkeletonRows } from './states';

export interface NodeTableProps {
  items: NodeListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  sort: NodeSortField;
  dir: 'asc' | 'desc';
  onSortChange: (sort: NodeSortField, dir: 'asc' | 'desc') => void;
  /** False for a viewer. Drives whether row actions exist at all, not whether they are enabled. */
  canManage: boolean;
  actions?: NodeActions | undefined;
  onOpen: (node: NodeListItem) => void;
  /** Omitted where renaming is not offered; there is then no inline edit mode at all. */
  rename?: RenameController | undefined;
  onNewFolder?: (() => void) | undefined;
  /** Load-more sentinel and its own loading/error states, supplied by the page. */
  footer?: ReactNode;
}

/**
 * Presentational. Every state it can be in arrives as a prop, so each one is a component test with
 * no query client, router or network in the way.
 */
export function NodeTable({
  items,
  isLoading,
  error,
  onRetry,
  sort,
  dir,
  onSortChange,
  canManage,
  actions,
  onOpen,
  rename,
  onNewFolder,
  footer,
}: NodeTableProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const body = ((): ReactNode => {
    if (isLoading) return <SkeletonRows />;
    if (error !== null && error !== undefined) return <ListErrorState error={error} onRetry={onRetry} />;
    if (items.length === 0) {
      return <EmptyFolderState canManage={canManage} {...(onNewFolder === undefined ? {} : { onNewFolder })} />;
    }
    return (
      <div role="rowgroup">
        {items.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            actions={canManage ? actions : undefined}
            rename={canManage ? rename : undefined}
            isSelected={selectedId === node.id}
            onSelect={(selected) => {
              setSelectedId(selected.id);
            }}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  })();

  return (
    <div
      role="grid"
      aria-label="Folder contents"
      aria-rowcount={items.length}
      className="overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div role="rowgroup">
        <NodeTableHeader sort={sort} dir={dir} onSortChange={onSortChange} />
      </div>
      {body}
      {footer}
    </div>
  );
}
