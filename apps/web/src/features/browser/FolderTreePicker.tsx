import type { NodeListItem } from '@dataroom/contracts';
import { FolderTreeNode, type DisabledReasonInput } from './FolderTreeNode';

export interface FolderTreePickerProps {
  rootId: string;
  rootName: string;
  movingNode: NodeListItem;
  currentParentId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  shareToken?: string | undefined;
}

export function disabledReasonFor(
  input: DisabledReasonInput,
  movingNode: NodeListItem,
  currentParentId: string,
): string | null {
  if (input.node.id === movingNode.id) {
    return `“${movingNode.name}” can't be moved inside itself.`;
  }
  if (input.insideMovingSubtree) {
    return `This folder is inside “${movingNode.name}”, which is the folder being moved.`;
  }
  if (input.node.id === currentParentId) {
    return `“${movingNode.name}” is already here.`;
  }
  return null;
}

/**
 * A tree, not a dropdown: choosing a destination is a navigation problem, and a flat list of every
 * folder in a data room stops being usable at about twenty entries.
 */
export function FolderTreePicker({
  rootId,
  rootName,
  movingNode,
  currentParentId,
  selectedId,
  onSelect,
  shareToken,
}: FolderTreePickerProps): JSX.Element {
  return (
    <ul
      role="tree"
      aria-label="Choose a destination folder"
      className="max-h-72 overflow-y-auto rounded-md border border-line p-1"
    >
      <FolderTreeNode
        id={rootId}
        name={rootName}
        depth={0}
        defaultExpanded
        selectedId={selectedId}
        onSelect={onSelect}
        disabledReason={(input) => disabledReasonFor(input, movingNode, currentParentId)}
        insideMovingSubtree={false}
        movingNodeId={movingNode.id}
        shareToken={shareToken}
      />
    </ul>
  );
}
