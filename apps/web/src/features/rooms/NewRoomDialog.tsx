import { useEffect, useState } from 'react';
import { ResourceName } from '@dataroom/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { presentError } from '@/lib/errorMap';
import { useCreateRoom } from './useRooms';

export interface NewRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (roomId: string) => void;
}

/**
 * Name validation uses the contract's own `ResourceName` schema rather than a retyped regex, so
 * the client, the API and the database CHECK constraint cannot drift apart on what a legal name is.
 */
export function NewRoomDialog({ open, onOpenChange, onCreated }: NewRoomDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { createRoom, isPending, error, reset } = useCreateRoom();

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
    void createRoom(parsed.data)
      .then((room) => {
        onOpenChange(false);
        onCreated(room.id);
      })
      .catch(() => {
        // Rendered from `error` below: a failed create keeps the dialog open with the typed name.
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New data room"
      description="A data room holds one deal's documents. You can share any folder inside it later."
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
            Create
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-ink" htmlFor="new-room-name">
        Name
      </label>
      <Input
        id="new-room-name"
        className="mt-1"
        value={name}
        autoFocus
        invalid={fieldError !== null}
        aria-describedby={fieldError === null ? undefined : 'new-room-error'}
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
        <p id="new-room-error" role="alert" className="mt-1 text-sm text-danger">
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
