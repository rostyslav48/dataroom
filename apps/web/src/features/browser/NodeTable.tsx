import { useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { NodeListItem, NodeSortField } from '@dataroom/contracts';
import { NODE_ROW_HEIGHT, NodeRow, type RenameController } from './NodeRow';
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
 * Above this many rows the list is windowed. Below it, plain DOM: windowing costs a scroll
 * container, measured heights and absolute positioning, and paying that for a folder of twelve
 * files buys nothing.
 */
export const VIRTUALIZE_THRESHOLD = 100;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = items.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => NODE_ROW_HEIGHT,
    overscan: 10,
  });

  const renderRow = (node: NodeListItem): JSX.Element => (
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
  );

  const body = ((): ReactNode => {
    if (isLoading) return <SkeletonRows />;
    if (error !== null && error !== undefined) return <ListErrorState error={error} onRetry={onRetry} />;
    if (items.length === 0) {
      return <EmptyFolderState canManage={canManage} {...(onNewFolder === undefined ? {} : { onNewFolder })} />;
    }

    if (!shouldVirtualize) {
      return <div role="rowgroup">{items.map((node) => renderRow(node))}</div>;
    }

    return (
      <div ref={scrollRef} role="rowgroup" className="max-h-[60vh] overflow-auto">
        <div style={{ height: `${String(virtualizer.getTotalSize())}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = items[virtualRow.index];
            if (node === undefined) return null;
            return (
              <div
                key={node.id}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${String(virtualRow.start)}px)`,
                }}
              >
                {renderRow(node)}
              </div>
            );
          })}
        </div>
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
