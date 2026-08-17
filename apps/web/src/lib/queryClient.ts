import { QueryClient } from '@tanstack/react-query';

/**
 * `refetchOnWindowFocus` is deliberately on: it is what resolves the "someone deleted this folder
 * while you were looking at it" case (ProjectDesc/06-edge-cases.md). The viewer tabs back, the
 * refetch returns `ITEM_GONE`, and the error boundary renders the gone state — no polling.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        staleTime: 10_000,
        retry: false,
      },
      mutations: { retry: false },
    },
  });
}
