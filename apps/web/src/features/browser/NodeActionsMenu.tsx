import { Download, FolderInput, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import type { NodeListItem } from '@dataroom/contracts';
import { DropdownMenu, type MenuItemSpec } from '@/components/ui/DropdownMenu';

/**
 * Each action is optional and an absent one is simply not offered. A menu item that opens nothing
 * is worse than a shorter menu, and "don't include unimplemented features" applies per control.
 */
export interface NodeActions {
  onRename?: ((node: NodeListItem) => void) | undefined;
  onMove?: ((node: NodeListItem) => void) | undefined;
  onShare?: ((node: NodeListItem) => void) | undefined;
  onDownload?: ((node: NodeListItem) => void) | undefined;
  onDelete?: ((node: NodeListItem) => void) | undefined;
}

export interface NodeActionsMenuProps {
  node: NodeListItem;
  actions: NodeActions;
  /** -1 outside the row that holds the roving tab stop, so Tab crosses the list once, not per row. */
  tabIndex?: number | undefined;
}

export function NodeActionsMenu({ node, actions, tabIndex }: NodeActionsMenuProps): JSX.Element | null {
  const items: MenuItemSpec[] = [];
  const { onRename, onMove, onShare, onDownload, onDelete } = actions;

  if (onRename !== undefined) {
    items.push({
      key: 'rename',
      label: 'Rename',
      icon: <Pencil aria-hidden="true" className="h-4 w-4" />,
      movesFocus: true,
      onSelect: () => {
        onRename(node);
      },
    });
  }
  if (onMove !== undefined) {
    items.push({
      key: 'move',
      label: 'Move',
      icon: <FolderInput aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        onMove(node);
      },
    });
  }
  if (onShare !== undefined) {
    items.push({
      key: 'share',
      label: 'Share',
      icon: <Share2 aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        onShare(node);
      },
    });
  }
  // Download exists for files only: there is no endpoint that zips a folder.
  if (onDownload !== undefined && node.type === 'file') {
    items.push({
      key: 'download',
      label: 'Download',
      icon: <Download aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        onDownload(node);
      },
    });
  }
  if (onDelete !== undefined) {
    items.push({
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 aria-hidden="true" className="h-4 w-4" />,
      destructive: true,
      onSelect: () => {
        onDelete(node);
      },
    });
  }

  if (items.length === 0) return null;

  return (
    <DropdownMenu
      label={`Actions for ${node.name}`}
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          {...(tabIndex === undefined ? {} : { tabIndex })}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      }
    />
  );
}
