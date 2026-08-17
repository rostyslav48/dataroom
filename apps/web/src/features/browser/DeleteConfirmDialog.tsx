import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NodeListItem } from '@dataroom/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getDeletePreview } from '@/lib/apiEndpoints';
import { presentError } from '@/lib/errorMap';
import { qk } from '@/lib/queryKeys';
import { useDeleteNode } from './mutations';
import { DeletePreviewSummary } from './DeletePreviewSummary';

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: NodeListItem | null;
  parentId: string;
  onDeleted?: (node: NodeListItem) => void;
}

/** Above this many affected items, deleting requires typing the name. Cheap insurance. */
export const TYPE_TO_CONFIRM_THRESHOLD = 50;

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  node,
  parentId,
  onDeleted,
}: DeleteConfirmDialogProps): JSX.Element | null {
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const remove = useDeleteNode(parentId);

  const preview = useQuery({
    queryKey: qk.deletePreview(node?.id ?? ''),
    queryFn: ({ signal }) => getDeletePreview(node?.id ?? '', signal),
    // Fired when the dialog opens, not when the row is rendered: this endpoint walks a subtree.
    enabled: open && node !== null,
    gcTime: 0,
  });

  useEffect(() => {
    if (open) {
      setTyped('');
      setFailure(null);
    }
  }, [open]);

  if (node === null) return null;

  const affected =
    preview.data === undefined ? 0 : preview.data.folderCount + preview.data.fileCount;
  const needsTypedName = affected > TYPE_TO_CONFIRM_THRESHOLD;
  const nameMatches = typed.trim() === node.name;
  const canConfirm =
    preview.data !== undefined && !remove.isPending && (!needsTypedName || nameMatches);

  const confirm = (): void => {
    remove.mutate(
      { node },
      {
        onSuccess: () => {
          onOpenChange(false);
          onDeleted?.(node);
        },
        onError: (error) => {
          setFailure(presentError(error).title);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={node.type === 'folder' ? `Delete “${node.name}” and its contents?` : `Delete “${node.name}”?`}
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" disabled={!canConfirm} busy={remove.isPending} onClick={confirm}>
            Delete
          </Button>
        </>
      }
    >
      <DeletePreviewSummary
        preview={preview.data}
        isLoading={preview.isPending}
        error={preview.error}
        nodeName={node.name}
        nodeType={node.type}
      />

      {needsTypedName ? (
        <div className="mt-4">
          <label className="block text-sm font-medium text-ink" htmlFor="delete-confirm-name">
            {`This removes ${String(affected)} items. Type the folder name to confirm.`}
          </label>
          <Input
            id="delete-confirm-name"
            className="mt-1"
            autoFocus
            value={typed}
            placeholder={node.name}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
      ) : null}

      {failure === null ? null : (
        <p role="alert" className="mt-3 text-sm text-danger">
          {failure}
        </p>
      )}
    </Dialog>
  );
}
