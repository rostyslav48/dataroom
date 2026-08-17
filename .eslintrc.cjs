/**
 * One shared ESLint config for the whole workspace — no per-package overrides.
 *
 * Deliberately not type-aware: type errors are `tsc`'s job and are already enforced by
 * `pnpm typecheck`. Running the type checker twice would double CI time for no new signal.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, browser: true, es2022: true },
  reportUnusedDisableDirectives: true,
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    '*.cjs',
    'apps/web/public/**',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
    'no-restricted-syntax': [
      'error',
      {
        // SPEC-01: every environment variable is read once, through the typed config object.
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: 'Read environment variables through the typed config object, not process.env.',
      },
    ],
  },
  overrides: [
    {
      // Config, tests, migrations and scripts legitimately read process.env directly.
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/test/**',
        '**/config/**',
        '**/scripts/**',
        '**/*.config.ts',
        '**/data-source.ts',
        'e2e/**',
      ],
      rules: { 'no-restricted-syntax': 'off', 'no-console': 'off' },
    },
    {
      // Playwright's fixture signature is `async ({}, use) => …` — the empty pattern is required
      // by the API, not an oversight.
      files: ['e2e/**'],
      rules: { 'no-empty-pattern': 'off' },
    },
  ],
};
