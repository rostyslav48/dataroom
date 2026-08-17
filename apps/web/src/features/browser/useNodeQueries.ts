import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  ListChildrenResponse,
  NodeDetailResponse,
  NodeSortField,
  NodeStatsDto,
} from '@dataroom/contracts';
import { getNode, getNodeStats, listChildren } from '@/lib/apiEndpoints';
import { qk } from '@/lib/queryKeys';

export interface ChildrenParams {
  sort: NodeSortField;
  dir: 'asc' | 'desc';
}

export function useNodeDetail(
  nodeId: string,
  shareToken?: string | undefined,
): UseQueryResult<NodeDetailResponse> {
  return useQuery({
    queryKey: qk.node(nodeId),
    queryFn: ({ signal }) => getNode(nodeId, { shareToken }, signal),
  });
}

/**
 * `nextCursor === null` is the only end-of-list signal: `getNextPageParam` returns the cursor
 * verbatim, so a short page with a cursor still fetches on. Inferring the end from `items.length`
 * would silently truncate a folder whenever a page came back short.
 */
export function useChildren(
  nodeId: string,
  params: ChildrenParams,
  shareToken?: string | undefined,
): UseInfiniteQueryResult<InfiniteData<ListChildrenResponse, string | null>> {
  return useInfiniteQuery({
    queryKey: qk.children(nodeId, params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listChildren(
        nodeId,
        { sort: params.sort, dir: params.dir, cursor: pageParam ?? undefined },
        { shareToken },
        signal,
      ),
    getNextPageParam: (lastPage: ListChildrenResponse) => lastPage.nextCursor,
  });
}

export function useNodeStats(
  nodeId: string,
  shareToken?: string | undefined,
): UseQueryResult<NodeStatsDto> {
  return useQuery({
    queryKey: qk.stats(nodeId),
    queryFn: ({ signal }) => getNodeStats(nodeId, { shareToken }, signal),
  });
}
