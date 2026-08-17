import { Download, FolderInput, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import type { NodeListItem } from '@dataroom/contracts';
import { DropdownMenu, type MenuItemSpec } from '@/components/ui/DropdownMenu';

export interface NodeActions {
  onRename: (node: NodeListItem) => void;
  onMove: (node: NodeListItem) => void;
  onShare: (node: NodeListItem) => void;
  onDownload: (node: NodeListItem) => void;
  onDelete: (node: NodeListItem) => void;
}

export interface NodeActionsMenuProps {
  node: NodeListItem;
  actions: NodeActions;
}

/**
 * Download is offered for files only. Folders have no download endpoint — server-side zipping is
 * out of scope — so the item is absent rather than present-and-broken.
 */
export function NodeActionsMenu({ node, actions }: NodeActionsMenuProps): JSX.Element {
  const items: MenuItemSpec[] = [
    {
      key: 'rename',
      label: 'Rename',
      icon: <Pencil aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        actions.onRename(node);
      },
    },
    {
      key: 'move',
      label: 'Move',
      icon: <FolderInput aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        actions.onMove(node);
      },
    },
    {
      key: 'share',
      label: 'Share',
      icon: <Share2 aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        actions.onShare(node);
      },
    },
  ];

  if (node.type === 'file') {
    items.push({
      key: 'download',
      label: 'Download',
      icon: <Download aria-hidden="true" className="h-4 w-4" />,
      onSelect: () => {
        actions.onDownload(node);
      },
    });
  }

  items.push({
    key: 'delete',
    label: 'Delete',
    icon: <Trash2 aria-hidden="true" className="h-4 w-4" />,
    destructive: true,
    onSelect: () => {
      actions.onDelete(node);
    },
  });

  return (
    <DropdownMenu
      label={`Actions for ${node.name}`}
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      }
    />
  );
}
