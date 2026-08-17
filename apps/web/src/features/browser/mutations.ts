import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { ListChildrenResponse, NodeDto, NodeListItem } from '@dataroom/contracts';
import { createFolder, deleteNode, moveNode, renameNode } from '@/lib/apiEndpoints';
import { childrenKeyPrefix, qk } from '@/lib/queryKeys';

/**
 * Mutations over the folder tree, with optimistic cache updates and rollback.
 *
 * Rename in particular has to feel instant: a 300 ms round trip before the name changes reads as
 * lag on an edit the user has already committed in their head. Every optimistic write snapshots
 * the affected caches first and restores them verbatim on error, so a failure leaves the list
 * exactly as it was rather than half-updated.
 */

export type ChildrenCache = InfiniteData<ListChildrenResponse, string | null>;
type Snapshot = [readonly unknown[], ChildrenCache | undefined][];

function patchChildren(
  queryClient: QueryClient,
  parentId: string,
  updater: (items: NodeListItem[]) => NodeListItem[],
): void {
  queryClient.setQueriesData<ChildrenCache>(
    { queryKey: childrenKeyPrefix(parentId) },
    (current) =>
      current === undefined
        ? current
        : {
            ...current,
            pages: current.pages.map((page) => ({ ...page, items: updater(page.items) })),
          },
  );
}

function snapshotChildren(queryClient: QueryClient, parentId: string): Snapshot {
  return queryClient.getQueriesData<ChildrenCache>({ queryKey: childrenKeyPrefix(parentId) });
}

function restore(queryClient: QueryClient, snapshot: Snapshot): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

/** Invalidate the folder's listing, its own detail and the rollups shown up the tree. */
function invalidateFolder(queryClient: QueryClient, parentId: string, nodeId?: string): void {
  void queryClient.invalidateQueries({ queryKey: childrenKeyPrefix(parentId) });
  void queryClient.invalidateQueries({ queryKey: qk.node(parentId) });
  void queryClient.invalidateQueries({ queryKey: qk.stats(parentId) });
  void queryClient.invalidateQueries({ queryKey: qk.rooms() });
  if (nodeId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: qk.node(nodeId) });
  }
}

export interface RenameVariables {
  node: NodeListItem;
  name: string;
}

export function useRenameNode(parentId: string): UseMutationResult<
  NodeDto,
  unknown,
  RenameVariables,
  { snapshot: Snapshot }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ node, name }: RenameVariables) => renameNode(node.id, name),
    onMutate: async ({ node, name }) => {
      await queryClient.cancelQueries({ queryKey: childrenKeyPrefix(parentId) });
      const snapshot = snapshotChildren(queryClient, parentId);
      patchChildren(queryClient, parentId, (items) =>
        items.map((item) => (item.id === node.id ? { ...item, name } : item)),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context !== undefined) restore(queryClient, context.snapshot);
    },
    onSettled: (_data, _error, variables) => {
      invalidateFolder(queryClient, parentId, variables.node.id);
    },
  });
}

export interface CreateFolderVariables {
  name: string;
}

export function useCreateFolder(parentId: string): UseMutationResult<
  NodeDto,
  unknown,
  CreateFolderVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name }: CreateFolderVariables) => createFolder(parentId, name),
    onSuccess: () => {
      invalidateFolder(queryClient, parentId);
    },
  });
}

export interface MoveVariables {
  node: NodeListItem;
  targetParentId: string;
}

export function useMoveNode(parentId: string): UseMutationResult<
  NodeDto,
  unknown,
  MoveVariables,
  { snapshot: Snapshot }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ node, targetParentId }: MoveVariables) => moveNode(node.id, targetParentId),
    onMutate: async ({ node, targetParentId }) => {
      await queryClient.cancelQueries({ queryKey: childrenKeyPrefix(parentId) });
      const snapshot = snapshotChildren(queryClient, parentId);
      if (targetParentId !== parentId) {
        patchChildren(queryClient, parentId, (items) => items.filter((item) => item.id !== node.id));
      }
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context !== undefined) restore(queryClient, context.snapshot);
    },
    onSettled: (_data, _error, variables) => {
      invalidateFolder(queryClient, parentId, variables.node.id);
      invalidateFolder(queryClient, variables.targetParentId);
    },
  });
}

export interface DeleteVariables {
  node: NodeListItem;
}

export function useDeleteNode(parentId: string): UseMutationResult<
  void,
  unknown,
  DeleteVariables,
  { snapshot: Snapshot }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ node }: DeleteVariables) => deleteNode(node.id),
    onMutate: async ({ node }) => {
      await queryClient.cancelQueries({ queryKey: childrenKeyPrefix(parentId) });
      const snapshot = snapshotChildren(queryClient, parentId);
      patchChildren(queryClient, parentId, (items) => items.filter((item) => item.id !== node.id));
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context !== undefined) restore(queryClient, context.snapshot);
    },
    onSettled: (_data, _error, variables) => {
      invalidateFolder(queryClient, parentId);
      void queryClient.removeQueries({ queryKey: qk.node(variables.node.id) });
    },
  });
}
