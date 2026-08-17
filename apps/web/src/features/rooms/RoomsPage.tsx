import { NewRoomButton } from './NewRoomButton';
import { RoomList } from './RoomList';
import { useRooms } from './useRooms';

/**
 * The landing page. It repeats the sidebar's list on purpose: arriving at `/rooms` with an empty
 * main pane and the only content in a rail reads as a page that failed to load.
 */
export function RoomsPage(): JSX.Element {
  const rooms = useRooms();
  const isEmpty =
    rooms.data !== undefined &&
    rooms.data.owned.length === 0 &&
    rooms.data.sharedWithMe.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Your data rooms</h1>
          <p className="text-sm text-ink-muted">
            {isEmpty
              ? 'Nothing here yet.'
              : 'Rooms you own, and rooms other people have shared with you.'}
          </p>
        </div>
        <NewRoomButton />
      </div>

      <RoomList
        data={rooms.data}
        isLoading={rooms.isPending}
        error={rooms.error}
        onRetry={() => {
          void rooms.refetch();
        }}
      />
    </div>
  );
}
