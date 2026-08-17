import type { NodeListItem } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { NodeNameCell } from './NodeNameCell';
import { NodeSizeCell } from './NodeSizeCell';
import { NodeUpdatedCell } from './NodeUpdatedCell';
import { NodeActionsMenu, type NodeActions } from './NodeActionsMenu';

export interface NodeRowProps {
  node: NodeListItem;
  /** Absent for a viewer: `SharedLayout` omits mutation controls entirely, never disabled ones. */
  actions?: NodeActions | undefined;
  isRenaming: boolean;
  renameError?: string | null | undefined;
  renameBusy?: boolean | undefined;
  isSelected: boolean;
  onSelect: (node: NodeListItem) => void;
  onOpen: (node: NodeListItem) => void;
  onRenameCommit: (node: NodeListItem, name: string) => void;
  onRenameCancel: () => void;
}

export const NODE_ROW_HEIGHT = 44;

export function NodeRow({
  node,
  actions,
  isRenaming,
  renameError,
  renameBusy,
  isSelected,
  onSelect,
  onOpen,
  onRenameCommit,
  onRenameCancel,
}: NodeRowProps): JSX.Element {
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
          renameError={renameError}
          renameBusy={renameBusy ?? false}
          onOpen={() => {
            onOpen(node);
          }}
          onRenameCommit={(name) => {
            onRenameCommit(node, name);
          }}
          onRenameCancel={onRenameCancel}
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
