import type { ListDataRoomsResponse } from '@dataroom/contracts';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { presentError } from '@/lib/errorMap';
import { RoomListItem } from './RoomListItem';

export interface RoomListProps {
  data: ListDataRoomsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Purely presentational: it takes the four states as props so each one is a one-line test with no
 * query client in sight. "Owned" and "Shared with me" stay separate sections because they mean
 * different things — one you can change, the other you can only read.
 */
export function RoomList({ data, isLoading, error, onRetry }: RoomListProps): JSX.Element {
  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="space-y-2 p-2">
        <span className="sr-only">Loading your data rooms</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    const presentation = presentError(error);
    return (
      <StateBlock
        tone="danger"
        title={presentation.title}
        body={presentation.body}
        action={{ label: 'Try again', onClick: onRetry }}
        className="m-2 p-6"
      />
    );
  }

  const owned = data?.owned ?? [];
  const shared = data?.sharedWithMe ?? [];

  if (owned.length === 0 && shared.length === 0) {
    return (
      <p className="p-3 text-sm text-ink-muted">
        No data rooms yet. Create one to start collecting documents.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {owned.length > 0 ? (
        <section aria-labelledby="rooms-owned">
          <h3 id="rooms-owned" className="px-2 pb-1 text-xs font-semibold uppercase text-ink-subtle">
            Owned
          </h3>
          <ul>
            {owned.map((room) => (
              <RoomListItem key={room.id} room={room} />
            ))}
          </ul>
        </section>
      ) : null}

      {shared.length > 0 ? (
        <section aria-labelledby="rooms-shared">
          <h3 id="rooms-shared" className="px-2 pb-1 text-xs font-semibold uppercase text-ink-subtle">
            Shared with me
          </h3>
          <ul>
            {shared.map((room) => (
              <RoomListItem key={room.id} room={room} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
