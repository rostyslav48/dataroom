import { useEffect, useState } from 'react';
import type { NodeListItem } from '@dataroom/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { presentError } from '@/lib/errorMap';
import { FolderTreePicker } from './FolderTreePicker';
import { useMoveNode } from './mutations';

export interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: NodeListItem | null;
  /** The folder currently being viewed, which is also the node's current parent. */
  parentId: string;
  rootId: string;
  rootName: string;
  shareToken?: string | undefined;
  onMoved?: (node: NodeListItem, targetParentId: string) => void;
}

export function MoveDialog({
  open,
  onOpenChange,
  node,
  parentId,
  rootId,
  rootName,
  shareToken,
  onMoved,
}: MoveDialogProps): JSX.Element | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const move = useMoveNode(parentId);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setFailure(null);
    }
  }, [open]);

  if (node === null) return null;

  const submit = (): void => {
    if (selectedId === null) return;
    move.mutate(
      { node, targetParentId: selectedId },
      {
        onSuccess: () => {
          onOpenChange(false);
          onMoved?.(node, selectedId);
        },
        onError: (error) => {
          // Rejections here are explanatory — a cycle, a name clash at the destination, a target
          // in another data room — so they belong next to the picker, not in a passing toast.
          setFailure(presentError(error).body);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Move “${node.name}”`}
      description="Pick the folder to move it into. Sharing follows the item, so a move can change who can reach it."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={selectedId === null}
            busy={move.isPending}
            onClick={submit}
          >
            Move here
          </Button>
        </>
      }
    >
      <FolderTreePicker
        rootId={rootId}
        rootName={rootName}
        movingNode={node}
        currentParentId={parentId}
        selectedId={selectedId}
        onSelect={setSelectedId}
        shareToken={shareToken}
      />
      {failure === null ? null : (
        <p role="alert" className="mt-3 text-sm text-danger">
          {failure}
        </p>
      )}
    </Dialog>
  );
}
