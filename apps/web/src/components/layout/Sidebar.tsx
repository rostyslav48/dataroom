import { cn } from '@/lib/cn';
import { RoomList } from '@/features/rooms/RoomList';
import { NewRoomButton } from '@/features/rooms/NewRoomButton';
import { useRooms } from '@/features/rooms/useRooms';

export interface SidebarProps {
  /** Controls the drawer on narrow screens; on large screens the rail is always visible. */
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps): JSX.Element {
  const rooms = useRooms();

  return (
    <nav
      aria-label="Data rooms"
      onClick={onNavigate}
      className={cn(
        'w-64 shrink-0 overflow-y-auto border-r border-line bg-surface p-3',
        open ? 'block' : 'hidden lg:block',
      )}
    >
      <NewRoomButton className="mb-4 w-full" />
      <RoomList
        data={rooms.data}
        isLoading={rooms.isPending}
        error={rooms.error}
        onRetry={() => {
          void rooms.refetch();
        }}
      />
    </nav>
  );
}
