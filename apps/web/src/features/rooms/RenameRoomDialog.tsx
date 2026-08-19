import { useEffect, useState } from 'react';
import { ResourceName } from '@dataroom/contracts';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { presentError } from '@/lib/errorMap';
import { useRenameRoom } from './useRooms';

export interface RenameRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  currentName: string;
}

export function RenameRoomDialog({
  open,
  onOpenChange,
  roomId,
  currentName,
}: RenameRoomDialogProps): JSX.Element {
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { renameRoom, isPending, error, reset } = useRenameRoom(roomId);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setFieldError(null);
      reset();
    }
  }, [currentName, open, reset]);

  const submit = (): void => {
    const parsed = ResourceName.safeParse(name);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid name');
      return;
    }
    if (parsed.data === currentName) {
      onOpenChange(false);
      return;
    }

    setFieldError(null);
    void renameRoom(parsed.data)
      .then(() => {
        onOpenChange(false);
      })
      .catch(() => {
        // The mutation error is rendered below; keep the dialog and the user's input intact.
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename data room"
      description="The room and its root folder will use the new name."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" busy={isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-ink" htmlFor="rename-room-name">
        Name
      </label>
      <Input
        id="rename-room-name"
        className="mt-1"
        value={name}
        autoFocus
        invalid={fieldError !== null}
        aria-describedby={fieldError === null ? undefined : 'rename-room-error'}
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
        <p id="rename-room-error" role="alert" className="mt-1 text-sm text-danger">
          {fieldError}
        </p>
      )}
      {error === null || error === undefined ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          {presentError(error).title}
        </p>
      )}
    </Dialog>
  );
}
