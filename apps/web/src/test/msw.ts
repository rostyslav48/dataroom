import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from '@/mocks/server';
import { resetDb } from '@/mocks/db';
import { clearForcedErrors } from '@/mocks/errorMode';
import { resetApiClientState } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';

const TEST_API_ORIGIN = 'http://localhost:3000';

/**
 * Call once at the top of a test file that talks to the API. Each test starts from the fixture
 * tree, with no forced errors and no session state carried over from the last one — otherwise a
 * mutation in one test quietly changes the world the next one asserts against.
 */
export function useMockApi(): void {
  beforeAll(() => {
    vi.stubEnv('VITE_API_URL', TEST_API_ORIGIN);
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    resetDb();
    clearForcedErrors();
    resetApiClientState();
    tokenStore.clear();
  });

  afterAll(() => {
    server.close();
    vi.unstubAllEnvs();
  });
}
