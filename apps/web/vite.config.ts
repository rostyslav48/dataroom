import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `@dataroom/contracts` resolves to source rather than to its built `dist`, so the web app can
 * never be built against a stale copy of the boundary it is supposed to honour.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dataroom/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: { port: 5173 },
  build: { sourcemap: true },
});
