import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResourceName, type NodeListItem, type NodeSortField } from '@dataroom/contracts';
import { isApiClientError } from '@/lib/api';
import { errorMap, presentError } from '@/lib/errorMap';
import { Breadcrumbs } from './Breadcrumbs';
import { FolderToolbar } from './FolderToolbar';
import { LoadMoreSentinel } from './LoadMoreSentinel';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { MoveDialog } from './MoveDialog';
import { NewFolderDialog } from './NewFolderDialog';
import { NodeTable } from './NodeTable';
import { SkeletonRows } from './states';
import { filePath, folderPath, shareTokenOf, type BrowseContext } from './browseContext';
import { useChildren, useNodeDetail } from './useNodeQueries';
import { useRenameNode } from './mutations';
import type { NodeActions } from './NodeActionsMenu';
import { DropZoneOverlay } from '@/features/uploads/DropZoneOverlay';
import { useUploadStore } from '@/features/uploads/uploadStore';
import { downloadNode } from '@/features/viewer/download';
import { ShareDialog } from '@/features/shares/ShareDialog';
import { AccessErrorScreen } from '@/features/shares/accessStates';
import { SharedLayout } from '@/features/shares/SharedLayout';
import { useSharedByName } from '@/features/shares/useSharedBy';
import { useShareResolve } from '@/features/shares/useShareResolve';

export interface FolderPageProps {
  nodeId: string;
  context: BrowseContext;
}

/**
 * The working surface.
 *
 * Layout comes from `NodeDetailResponse.access`, never from the route: a permissioned viewer who
 * lands on `/rooms/...` gets read-only chrome, because the server's own answer decides, not the URL
 * they happen to be on.
 */
export function FolderPage({ nodeId, context }: FolderPageProps): JSX.Element {
  const navigate = useNavigate();
  const shareToken = shareTokenOf(context);
  const [sort, setSort] = useState<NodeSortField>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeListItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<NodeListItem | null>(null);
  const [shareTarget, setShareTarget] = useState<NodeListItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enqueue = useUploadStore((store) => store.enqueue);

  const detail = useNodeDetail(nodeId, shareToken);
  const children = useChildren(nodeId, { sort, dir }, shareToken);
  const rename = useRenameNode(nodeId);
  const resolvedShare = useShareResolve(shareToken ?? '');
  const sharedBy = useSharedByName(context, detail.data?.node.dataRoomId ?? '');

  const openNode = useCallback(
    (node: NodeListItem) => {
      void navigate(
        node.type === 'folder' ? folderPath(context, node.id) : filePath(context, node.id),
      );
    },
    [context, navigate],
  );

  const commitRename = useCallback(
    (node: NodeListItem, name: string) => {
      if (name === node.name) {
        setRenamingId(null);
        setRenameError(null);
        return;
      }
      const parsed = ResourceName.safeParse(name);
      if (!parsed.success) {
        setRenameError(parsed.error.issues[0]?.message ?? 'Enter a valid name');
        return;
      }
      rename.mutate(
        { node, name: parsed.data },
        {
          onSuccess: () => {
            setRenamingId(null);
            setRenameError(null);
          },
          onError: (error) => {
            // The input stays open with the typed text; a toast here would lose the user's work.
            setRenameError(
              isApiClientError(error) && error.code === 'NAME_CONFLICT'
                ? errorMap('NAME_CONFLICT').body
                : presentError(error).title,
            );
          },
        },
      );
    },
    [rename],
  );

  if (detail.isPending) {
    return (
      <div className="mx-auto max-w-5xl">
        <SkeletonRows />
      </div>
    );
  }

  if (detail.error !== null) {
    // Layout and recovery both come from the server's own answer: each access failure has its own
    // designed screen, chosen by `code`, never by guessing from the URL.
    return (
      <div className="mx-auto max-w-2xl">
        <AccessErrorScreen
          error={detail.error}
          context={context}
          nodeId={nodeId}
          shareRootId={resolvedShare.data?.nodeId}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      </div>
    );
  }

  const canManage = detail.data.access === 'owner';
  const items = children.data?.pages.flatMap((page) => page.items) ?? [];
  const openNewFolder = (): void => {
    setNewFolderOpen(true);
  };

  const actions: NodeActions | undefined = canManage
    ? {
        onRename: (node) => {
          setRenamingId(node.id);
          setRenameError(null);
        },
        onMove: (node) => {
          setMoveTarget(node);
        },
        onShare: (node) => {
          setShareTarget(node);
        },
        onDownload: (node) => {
          setActionError(null);
          void downloadNode(node.id, node.name, shareToken).catch((error: unknown) => {
            setActionError(presentError(error).title);
          });
        },
        onDelete: (node) => {
          setDeleteTarget(node);
        },
      }
    : undefined;

  const body = (
    <div className="mx-auto max-w-5xl">
      <Breadcrumbs
        crumbs={detail.data.breadcrumbs}
        context={context}
        shareRootId={detail.data.shareRootId}
        className="mb-3"
      />

      <FolderToolbar
        folderName={detail.data.node.name}
        fileCount={detail.data.node.subtreeFileCount}
        sizeBytes={detail.data.node.subtreeSizeBytes}
        onNewFolder={canManage ? openNewFolder : undefined}
        onShare={
          canManage
            ? () => {
                setShareTarget(detail.data.node);
              }
            : undefined
        }
        onUpload={
          canManage
            ? () => {
                fileInputRef.current?.click();
              }
            : undefined
        }
      />

      {canManage ? (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Choose files to upload"
          className="sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            if (chosen.length > 0) enqueue(chosen, nodeId);
            event.target.value = '';
          }}
        />
      ) : null}

      {actionError === null ? null : (
        <p role="alert" className="mb-3 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <NodeTable
        items={items}
        isLoading={children.isPending}
        // A failed *next* page keeps the rows already loaded and reports itself in the footer;
        // only a first page that never arrived replaces the table with an error state.
        error={children.isError && items.length === 0 ? children.error : null}
        onRetry={() => {
          void children.refetch();
        }}
        sort={sort}
        dir={dir}
        onSortChange={(nextSort, nextDir) => {
          setSort(nextSort);
          setDir(nextDir);
        }}
        canManage={canManage}
        actions={actions}
        onOpen={openNode}
        rename={
          canManage
            ? {
                activeId: renamingId,
                error: renameError,
                busy: rename.isPending,
                onCommit: commitRename,
                onCancel: () => {
                  setRenamingId(null);
                  setRenameError(null);
                },
              }
            : undefined
        }
        onNewFolder={canManage ? openNewFolder : undefined}
        footer={
          <LoadMoreSentinel
            hasNextPage={children.hasNextPage}
            isFetchingNextPage={children.isFetchingNextPage}
            error={children.isError && items.length > 0 ? children.error : null}
            onLoadMore={() => {
              void children.fetchNextPage();
            }}
          />
        }
      />

      {canManage ? (
        <>
          <DropZoneOverlay parentId={nodeId} folderName={detail.data.node.name} />
          <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} parentId={nodeId} />
          <DeleteConfirmDialog
            open={deleteTarget !== null}
            onOpenChange={(next) => {
              if (!next) setDeleteTarget(null);
            }}
            node={deleteTarget}
            parentId={nodeId}
          />
          <ShareDialog
            open={shareTarget !== null}
            onOpenChange={(next) => {
              if (!next) setShareTarget(null);
            }}
            node={shareTarget}
          />
          <MoveDialog
            open={moveTarget !== null}
            onOpenChange={(next) => {
              if (!next) setMoveTarget(null);
            }}
            node={moveTarget}
            parentId={nodeId}
            rootId={detail.data.shareRootId}
            rootName={detail.data.breadcrumbs[0]?.name ?? detail.data.dataRoomName}
            shareToken={shareToken}
          />
        </>
      ) : null}
    </div>
  );

  if (canManage) return body;

  // `access: 'viewer'` renders read-only chrome even on a `/rooms/...` URL — the response decides.
  return (
    <SharedLayout
      ownerName={sharedBy}
      itemName={detail.data.node.name}
      standalone={context.kind === 'share'}
    >
      {body}
    </SharedLayout>
  );
}
