import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/routes';
import { createQueryClient } from '@/lib/queryClient';

const defaultClient = createQueryClient();

export interface AppProps {
  /** Injectable so tests can supply a client with their own retry and cache settings. */
  queryClient?: QueryClient;
}

export function App({ queryClient = defaultClient }: AppProps): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
