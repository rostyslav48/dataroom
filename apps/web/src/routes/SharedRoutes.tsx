import { Navigate, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { FolderPage } from '@/features/browser/FolderPage';
import { FileViewerPage } from '@/features/viewer/FileViewerPage';
import { filePath, folderPath, type BrowseContext } from '@/features/browser/browseContext';
import { AccessErrorScreen } from '@/features/shares/accessStates';
import { useShareResolve } from '@/features/shares/useShareResolve';
import { NotFoundPage } from './NotFoundPage';

/**
 * The `/s/:token` tree exists for one reason: a public link carries no session, so the grant
 * travels in the URL and then in the `X-Share-Token` header on every request. A *permissioned*
 * recipient is an ordinary signed-in user and browses `/rooms/...` like anyone else — which is why
 * there is no third route tree for them.
 */

function shareContext(token: string): BrowseContext {
  return { kind: 'share', token };
}

export function ShareEntryRoute(): JSX.Element {
  const { token } = useParams();
  const resolved = useShareResolve(token ?? '');

  if (token === undefined) return <NotFoundPage />;

  if (resolved.isPending) {
    return (
      <div role="status" aria-live="polite" className="mx-auto max-w-3xl space-y-3 p-6">
        <span className="sr-only">Opening the shared item</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (resolved.error !== null) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <AccessErrorScreen
          error={resolved.error}
          context={shareContext(token)}
          itemGoneIsShareRoot
          onRetry={() => {
            void resolved.refetch();
          }}
        />
      </div>
    );
  }

  const target =
    resolved.data.nodeType === 'folder'
      ? folderPath(shareContext(token), resolved.data.nodeId)
      : filePath(shareContext(token), resolved.data.nodeId);

  return <Navigate replace to={target} />;
}

export function SharedFolderRoute(): JSX.Element {
  const { token, nodeId } = useParams();
  if (token === undefined || nodeId === undefined) return <NotFoundPage />;
  return <FolderPage nodeId={nodeId} context={shareContext(token)} />;
}

export function SharedFileRoute(): JSX.Element {
  const { token, nodeId } = useParams();
  if (token === undefined || nodeId === undefined) return <NotFoundPage />;
  return <FileViewerPage nodeId={nodeId} context={shareContext(token)} />;
}
