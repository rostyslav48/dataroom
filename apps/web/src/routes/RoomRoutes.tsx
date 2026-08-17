import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { StateBlock } from '@/components/ui/StateBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDataRoom } from '@/lib/apiEndpoints';
import { presentError } from '@/lib/errorMap';
import { qk } from '@/lib/queryKeys';
import { FolderPage } from '@/features/browser/FolderPage';
import { FileViewerPage } from '@/features/viewer/FileViewerPage';
import { folderPath } from '@/features/browser/browseContext';
import { NotFoundPage } from './NotFoundPage';

/**
 * `/rooms/:roomId` resolves the room's entry node and redirects to it, so every folder view has a
 * node id in its URL and a refresh lands exactly where the user was. For a room shared with the
 * caller that entry point is their share root, not the owner's root — the API decides which.
 */
export function RoomRootRoute(): JSX.Element {
  const { roomId } = useParams();
  const room = useQuery({
    queryKey: qk.room(roomId ?? ''),
    queryFn: ({ signal }) => getDataRoom(roomId ?? '', {}, signal),
    enabled: roomId !== undefined,
  });

  if (roomId === undefined) return <NotFoundPage />;

  if (room.isPending) {
    return (
      <div role="status" aria-live="polite" className="mx-auto max-w-5xl space-y-3">
        <span className="sr-only">Opening data room</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (room.error !== null) {
    const presentation = presentError(room.error);
    return (
      <StateBlock
        tone="danger"
        title={presentation.title}
        body={presentation.body}
        action={{
          label: 'Try again',
          onClick: () => {
            void room.refetch();
          },
        }}
        className="mx-auto max-w-2xl"
      />
    );
  }

  return <Navigate replace to={folderPath({ kind: 'room', roomId }, room.data.rootNodeId)} />;
}

export function RoomFolderRoute(): JSX.Element {
  const { roomId, nodeId } = useParams();
  if (roomId === undefined || nodeId === undefined) return <NotFoundPage />;
  return <FolderPage nodeId={nodeId} context={{ kind: 'room', roomId }} />;
}

export function RoomFileRoute(): JSX.Element {
  const { roomId, nodeId } = useParams();
  if (roomId === undefined || nodeId === undefined) return <NotFoundPage />;
  return <FileViewerPage nodeId={nodeId} context={{ kind: 'room', roomId }} />;
}
