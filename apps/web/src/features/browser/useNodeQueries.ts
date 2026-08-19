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

/**
 * `staleTime: 0` on both node queries, against the client's 10-second default.
 *
 * `06-edge-cases.md` decides the delete-while-viewing case outright — the viewer's next request or
 * focus-refetch gets `410 ITEM_GONE` and the gone state renders, "**never a blank screen or a stale
 * cache**". `refetchOnWindowFocus` alone does not deliver that: TanStack Query skips the refetch
 * while the data is still fresh, so for ten seconds after a deletion tabbing back did nothing and
 * the viewer went on reading a folder that no longer existed.
 *
 * Scoped to the node reads rather than raised to `refetchOnWindowFocus: 'always'` globally, because
 * `/shared/:token` is rate-limited to 10 requests a minute per IP and refetching *it* on every focus
 * would spend that budget on a value that does not change.
 */
export function useNodeDetail(
  nodeId: string,
  shareToken?: string | undefined,
): UseQueryResult<NodeDetailResponse> {
  return useQuery({
    queryKey: qk.node(nodeId),
    queryFn: ({ signal }) => getNode(nodeId, { shareToken }, signal),
    staleTime: 0,
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
    staleTime: 0,
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
