import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { NewRoomDialog } from './NewRoomDialog';

export interface NewRoomButtonProps {
  className?: string;
}

export function NewRoomButton({ className }: NewRoomButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <Button
        variant="primary"
        className={className}
        leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
        onClick={() => {
          setOpen(true);
        }}
      >
        New data room
      </Button>
      <NewRoomDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(roomId) => {
          void navigate(`/rooms/${roomId}`);
        }}
      />
    </>
  );
}
