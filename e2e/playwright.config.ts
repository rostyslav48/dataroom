import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a *running* stack — locally the dev servers, in CI/at sync points the deployed
 * URLs. It never starts the API itself: the flows under test include real storage and real
 * cookies, and a suite that spins up a stubbed stack proves nothing about either.
 *
 *   E2E_WEB_URL   where the web app is served     (default: local Vite)
 *   E2E_API_URL   where the API is served         (default: local Nest)
 *   DATABASE_URL  the database that stack talks to — the harness seeds identities directly
 *   JWT_ACCESS_SECRET  used to mint test sessions without driving Google's login page
 */
const webUrl = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
