import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ResolveShareResponse } from '@dataroom/contracts';
import { resolveShare } from '@/lib/apiEndpoints';
import { qk } from '@/lib/queryKeys';

/**
 * Resolves a public link to its entry point. Cached under the token, so the page that redirects
 * and the page that renders the banner share one request.
 */
export function useShareResolve(token: string): UseQueryResult<ResolveShareResponse> {
  return useQuery({
    queryKey: qk.sharedLink(token),
    queryFn: ({ signal }) => resolveShare(token, signal),
    enabled: token !== '',
    retry: false,
  });
}
