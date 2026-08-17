import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@/features/auth/AuthProvider';

/**
 * Test-only providers. Retries are off and caches are per-test so a failing request surfaces
 * immediately as the error state under test rather than after three silent attempts.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export interface ProviderOptions {
  route?: string;
  queryClient?: QueryClient;
  /** Off for leaf components, which must render from props with no session in sight. */
  withAuth?: boolean;
  /** Renders `ui` under this route pattern, so `useParams` resolves in the component under test. */
  path?: string;
}

export interface HarnessResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}): HarnessResult {
  const {
    route = '/',
    queryClient = createTestQueryClient(),
    withAuth = false,
    path,
  } = options;

  const content: ReactNode =
    path === undefined ? (
      ui
    ) : (
      <Routes>
        <Route path={path} element={ui} />
      </Routes>
    );

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        {withAuth ? <AuthProvider>{content}</AuthProvider> : content}
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}
