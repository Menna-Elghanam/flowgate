import { defineConfig, devices } from '@playwright/test';

/**
 * Acceptance tests run against the real stack (web + API + Postgres + Redis) with the demo
 * seed loaded: `docker compose up -d && pnpm db:migrate && pnpm --filter @flowgate/api db:reset`.
 * Each test uses unique titles, so they can run again without resetting the database.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'pnpm --dir ../.. dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
