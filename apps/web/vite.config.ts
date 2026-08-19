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
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Three chunks that change at different rates, rather than one that changes on every
         * commit.
         *
         * `react-pdf`/`pdfjs-dist` is the reason this exists: it is the largest dependency in the
         * app and it is needed on exactly one route, so bundling it into the entry made every
         * first paint — including the login page — wait for a PDF renderer nobody had asked for.
         * `vendor` holds the framework, which changes only when a dependency is upgraded and is
         * therefore worth caching across deploys.
         */
        manualChunks: (id: string): string | undefined => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react-pdf|pdfjs-dist)[\\/]/.test(id)) return 'pdf';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
