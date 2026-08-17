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
  onSelect: (node: NodeListItem) => void;
  onOpen: (node: NodeListItem) => void;
}

export const NODE_ROW_HEIGHT = 44;

export function NodeRow({
  node,
  actions,
  rename,
  isSelected,
  onSelect,
  onOpen,
}: NodeRowProps): JSX.Element {
  const isRenaming = rename !== undefined && rename.activeId === node.id;
  return (
    <div
      role="row"
      aria-selected={isSelected}
      data-testid={`node-row-${node.id}`}
      onMouseDown={() => {
        onSelect(node);
      }}
      className={cn(
        'grid h-11 grid-cols-[minmax(0,1fr)_6rem_7rem_2.5rem] items-center gap-3 border-b border-line px-3 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_8rem_2.5rem]',
        isSelected ? 'bg-accent-subtle' : 'bg-surface hover:bg-surface-muted',
      )}
    >
      <div role="gridcell" className="min-w-0">
        <NodeNameCell
          node={node}
          isRenaming={isRenaming}
          renameError={isRenaming ? rename?.error : null}
          renameBusy={isRenaming ? rename?.busy : false}
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
      <div role="gridcell" className="hidden sm:block">
        <NodeSizeCell node={node} />
      </div>
      <div role="gridcell" className="hidden sm:block">
        <NodeUpdatedCell updatedAt={node.updatedAt} />
      </div>
      <div role="gridcell" className="justify-self-end">
        {actions === undefined ? null : <NodeActionsMenu node={node} actions={actions} />}
      </div>
    </div>
  );
}
