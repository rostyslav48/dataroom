import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * The Node-side mock server used by component tests. Same handlers as the browser worker, so a
 * test and a dev session exercise identical behaviour.
 */
export const server = setupServer(...handlers);
