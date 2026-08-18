import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

function countLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'item' : 'items'} in this folder`;
}

/**
 * Presentational. Every state it can be in arrives as a prop, so each one is a component test with
 * no query client, router or network in the way.
 *
 * Keyboard behaviour lives here rather than on the rows because selection does: one listener on
 * the grid sees every key, and the rows carry a roving tabindex so Tab lands on the list once
 * rather than once per row. Arrows move, Enter opens, F2 renames, Delete deletes, Escape clears.
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
  const [announcement, setAnnouncement] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);
  const lastCount = useRef<number | null>(null);
  const shouldVirtualize = items.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => NODE_ROW_HEIGHT,
    overscan: 10,
  });

  /**
   * A row count that changed after the list was first drawn means a mutation landed — a delete, a
   * move out, an upload — and that is invisible to a screen reader unless it is said out loud.
   */
  useEffect(() => {
    if (isLoading) return;
    const previous = lastCount.current;
    lastCount.current = items.length;
    if (previous === null || previous === items.length) return;
    setAnnouncement(countLabel(items.length));
  }, [items.length, isLoading]);

  // Focus follows keyboard selection only — never a click, which would fight the control clicked.
  // Runs after every render so a row that a virtualized scroll has just mounted still gets focus.
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const element = rowRefs.current.get(id);
    if (element === undefined) return;
    pendingFocus.current = null;
    element.focus();
  });

  const selectAt = (index: number): void => {
    const node = items[index];
    if (node === undefined) return;
    setSelectedId(node.id);
    pendingFocus.current = node.id;
    if (shouldVirtualize) virtualizer.scrollToIndex(index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Only when a row itself holds focus: inside the rename input, or on the name and action
    // buttons, these keys already mean something and the grid must not take them.
    if (!(event.target instanceof HTMLElement) || event.target.dataset.nodeRow === undefined) return;
    if (items.length === 0) return;

    const index = items.findIndex((item) => item.id === selectedId);
    const selected = index === -1 ? undefined : items[index];

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectAt(index === -1 ? 0 : Math.min(index + 1, items.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        selectAt(index === -1 ? items.length - 1 : Math.max(index - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        return;
      case 'End':
        event.preventDefault();
        selectAt(items.length - 1);
        return;
      case 'Enter':
        if (selected === undefined) return;
        event.preventDefault();
        onOpen(selected);
        return;
      case 'F2':
        if (selected === undefined || !canManage || actions?.onRename === undefined) return;
        event.preventDefault();
        actions.onRename(selected);
        return;
      // Backspace as well as Delete: most laptop keyboards have no forward-delete key, and a
      // shortcut that only works on a full-size keyboard is a shortcut half the users don't have.
      case 'Delete':
      case 'Backspace':
        if (selected === undefined || !canManage || actions?.onDelete === undefined) return;
        event.preventDefault();
        actions.onDelete(selected);
        return;
      case 'Escape':
        setSelectedId(null);
        return;
      default:
        return;
    }
  };

  const renderRow = (node: NodeListItem, index: number): JSX.Element => (
    <NodeRow
      key={node.id}
      node={node}
      actions={canManage ? actions : undefined}
      rename={canManage ? rename : undefined}
      isSelected={selectedId === node.id}
      // Exactly one row is in the tab order: the selected one, or the first if nothing is selected.
      isTabbable={selectedId === null ? index === 0 : selectedId === node.id}
      rowRef={(element) => {
        if (element === null) rowRefs.current.delete(node.id);
        else rowRefs.current.set(node.id, element);
      }}
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
      return <div role="rowgroup">{items.map((node, index) => renderRow(node, index))}</div>;
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
                {renderRow(node, virtualRow.index)}
              </div>
            );
          })}
        </div>
      </div>
    );
  })();

  return (
    <>
      <div
        role="grid"
        aria-label="Folder contents"
        aria-rowcount={items.length}
        onKeyDown={handleKeyDown}
        className="overflow-hidden rounded-lg border border-line bg-surface"
      >
        <div role="rowgroup">
          <NodeTableHeader sort={sort} dir={dir} onSortChange={onSortChange} />
        </div>
        {body}
        {footer}
      </div>
      {/* Outside the grid: a paragraph is not a row, and `role="grid"` may only contain rows. */}
      <p aria-live="polite" data-testid="row-count-announcement" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
