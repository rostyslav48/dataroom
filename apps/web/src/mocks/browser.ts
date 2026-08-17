import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * Browser mocking, imported only from a `import.meta.env.DEV` branch so Rollup drops this module
 * (and all of MSW with it) from the production bundle. CI greps `dist` to prove it.
 *
 * One-time local setup, because the worker script is generated rather than committed (Vite would
 * copy anything in `public/` into `dist`, which is what the CI check forbids):
 *
 *   pnpm --filter @dataroom/web exec msw init public/
 */
export async function startMocks(): Promise<void> {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}
