import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResourceName, type NodeListItem, type NodeSortField } from '@dataroom/contracts';
import { StateBlock } from '@/components/ui/StateBlock';
import { isApiClientError } from '@/lib/api';
import { errorMap, presentError } from '@/lib/errorMap';
import { Breadcrumbs } from './Breadcrumbs';
import { FolderToolbar } from './FolderToolbar';
import { LoadMoreSentinel } from './LoadMoreSentinel';
import { NewFolderDialog } from './NewFolderDialog';
import { NodeTable } from './NodeTable';
import { SkeletonRows } from './states';
import { filePath, folderPath, shareTokenOf, type BrowseContext } from './browseContext';
import { useChildren, useNodeDetail } from './useNodeQueries';
import { useRenameNode } from './mutations';
import type { NodeActions } from './NodeActionsMenu';

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const detail = useNodeDetail(nodeId, shareToken);
  const children = useChildren(nodeId, { sort, dir }, shareToken);
  const rename = useRenameNode(nodeId);

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
    const presentation = presentError(detail.error);
    return (
      <StateBlock
        tone="danger"
        title={presentation.title}
        body={presentation.body}
        action={{
          label: 'Try again',
          onClick: () => {
            void detail.refetch();
          },
        }}
        className="mx-auto max-w-2xl"
      />
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
      }
    : undefined;

  return (
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
      />

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
        <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} parentId={nodeId} />
      ) : null}
    </div>
  );
}
