import type { NodeListItem } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { NodeNameCell } from './NodeNameCell';
import { NodeSizeCell } from './NodeSizeCell';
import { NodeUpdatedCell } from './NodeUpdatedCell';
import { NodeActionsMenu, type NodeActions } from './NodeActionsMenu';

/**
 * Inline renaming, as one optional bundle. A page that cannot rename — a shared view, or one
 * whose mutation is not wired — passes nothing, and the cell has no edit mode at all rather than
 * a handler that quietly does nothing.
 */
export interface RenameController {
  activeId: string | null;
  error?: string | null | undefined;
  busy?: boolean | undefined;
  onCommit: (node: NodeListItem, name: string) => void;
  onCancel: () => void;
}

export interface NodeRowProps {
  node: NodeListItem;
  /** Absent for a viewer: `SharedLayout` omits mutation controls entirely, never disabled ones. */
  actions?: NodeActions | undefined;
  rename?: RenameController | undefined;
  isSelected: boolean;
  /** The one row in the tab order. Its controls come with it; the other rows' step aside. */
  isTabbable?: boolean | undefined;
  rowRef?: ((element: HTMLDivElement | null) => void) | undefined;
  onSelect: (node: NodeListItem) => void;
  onOpen: (node: NodeListItem) => void;
}

export const NODE_ROW_HEIGHT = 44;

/**
 * Below `md` the row stops being a table row and becomes a list entry: the name on one line and
 * its size and date on a quieter second one. The values move rather than disappearing, because on
 * a tablet "which of these is the big one" is the same question it is on a desktop.
 */
export function NodeRow({
  node,
  actions,
  rename,
  isSelected,
  isTabbable = false,
  rowRef,
  onSelect,
  onOpen,
}: NodeRowProps): JSX.Element {
  const isRenaming = rename !== undefined && rename.activeId === node.id;
  const controlTabIndex = isTabbable ? 0 : -1;

  return (
    <div
      ref={rowRef}
      role="row"
      data-node-row={node.id}
      aria-selected={isSelected}
      data-testid={`node-row-${node.id}`}
      tabIndex={isTabbable ? 0 : -1}
      onMouseDown={() => {
        onSelect(node);
      }}
      // Selection follows focus, as it does in any single-select grid: tabbing into the list or
      // clicking a control inside a row makes that row the one the shortcuts act on.
      onFocus={() => {
        onSelect(node);
      }}
      className={cn(
        'grid h-11 grid-cols-[minmax(0,1fr)_auto_2.5rem] grid-rows-[1fr_auto] items-center gap-x-3 border-b border-line px-3 text-sm',
        'md:grid-cols-[minmax(0,1fr)_7rem_8rem_2.5rem] md:grid-rows-1',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent focus-visible:ring-offset-0',
        isSelected ? 'bg-accent-subtle' : 'bg-surface hover:bg-surface-muted',
      )}
    >
      <div role="gridcell" className="col-span-2 col-start-1 row-start-1 min-w-0 md:col-span-1">
        <NodeNameCell
          node={node}
          isRenaming={isRenaming}
          renameError={isRenaming ? rename?.error : null}
          renameBusy={isRenaming ? rename?.busy : false}
          tabIndex={controlTabIndex}
          onOpen={() => {
            onOpen(node);
          }}
          onRenameCommit={(name) => {
            rename?.onCommit(node, name);
          }}
          onRenameCancel={() => {
            rename?.onCancel();
          }}
        />
      </div>
      <div
        role="gridcell"
        className={cn(
          'col-start-1 row-start-2 pl-6 text-xs leading-none md:col-start-2 md:row-start-1 md:pl-0 md:text-sm',
          isRenaming ? 'hidden md:block' : '',
        )}
      >
        <NodeSizeCell node={node} />
      </div>
      <div
        role="gridcell"
        className={cn(
          'col-start-2 row-start-2 text-xs leading-none md:col-start-3 md:row-start-1 md:text-sm',
          isRenaming ? 'hidden md:block' : '',
        )}
      >
        <NodeUpdatedCell updatedAt={node.updatedAt} />
      </div>
      <div
        role="gridcell"
        className="col-start-3 row-span-2 row-start-1 justify-self-end md:col-start-4 md:row-span-1"
      >
        {actions === undefined ? null : (
          <NodeActionsMenu node={node} actions={actions} tabIndex={controlTabIndex} />
        )}
      </div>
    </div>
  );
}
