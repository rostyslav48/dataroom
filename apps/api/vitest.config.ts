import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * SWC rather than esbuild: esbuild does not emit `design:paramtypes`, and Nest's DI reads exactly
 * that metadata to resolve constructor parameters. Without it every provider would need an
 * explicit `@Inject()`, which is a worse codebase in exchange for a test-runner detail.
 *
 * `@dataroom/contracts` is aliased to source so tests never run against a stale `dist`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@dataroom/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests start their own Postgres container; running suites in parallel would
    // start one per file and exhaust the daemon on a laptop.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/database/migrations/**',
        'src/database/data-source.ts',
        'src/database/seed.ts',
        'src/**/*.entity.ts',
      ],
      thresholds: {
        statements: 80,
        'src/**/*.service.ts': { statements: 90 },
        'src/permissions/**': { statements: 90 },
      },
    },
  },
});
