import { useEffect, useState } from 'react';
import { ResourceName } from '@dataroom/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isApiClientError } from '@/lib/api';
import { errorMap, presentError } from '@/lib/errorMap';
import { useCreateFolder } from './mutations';

export interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
  onCreated?: (folderId: string) => void;
}

/**
 * A name conflict is reported inline under the field and the dialog stays open with the typed
 * text. Closing on failure would throw away what the user wrote to tell them it was wrong.
 */
export function NewFolderDialog({
  open,
  onOpenChange,
  parentId,
  onCreated,
}: NewFolderDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mutation = useCreateFolder(parentId);
  const { reset } = mutation;

  useEffect(() => {
    if (open) {
      setName('');
      setFieldError(null);
      reset();
    }
  }, [open, reset]);

  const submit = (): void => {
    const parsed = ResourceName.safeParse(name);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid name');
      return;
    }
    setFieldError(null);
    mutation.mutate(
      { name: parsed.data },
      {
        onSuccess: (folder) => {
          onOpenChange(false);
          onCreated?.(folder.id);
        },
        onError: (error) => {
          setFieldError(
            isApiClientError(error) && error.code === 'NAME_CONFLICT'
              ? errorMap('NAME_CONFLICT').body
              : presentError(error).title,
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New folder"
      description="Folders can be shared on their own, so grouping documents also decides who sees what."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" busy={mutation.isPending} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-ink" htmlFor="new-folder-name">
        Folder name
      </label>
      <Input
        id="new-folder-name"
        className="mt-1"
        autoFocus
        value={name}
        invalid={fieldError !== null}
        aria-describedby={fieldError === null ? undefined : 'new-folder-error'}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
      {name.length > 200 ? (
        <p className="mt-1 text-xs text-ink-subtle">{`${String(name.length)} / 255 characters`}</p>
      ) : null}
      {fieldError === null ? null : (
        <p id="new-folder-error" role="alert" className="mt-1 text-sm text-danger">
          {fieldError}
        </p>
      )}
    </Dialog>
  );
}
