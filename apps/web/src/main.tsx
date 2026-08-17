import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

/**
 * The MSW import sits inside an `import.meta.env.DEV` branch. Vite replaces that literal with
 * `false` in a production build, Rollup drops the branch, and the mock — worker, handlers and all
 * — never reaches the bundle. CI greps `dist` for it rather than trusting this comment.
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MSW === 'true') {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  }

  const container = document.getElementById('root');
  if (container === null) throw new Error('#root is missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
