import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a running web app and API.
 *
 * In CI (the E2E job in .github/workflows/test.yml) Playwright starts both
 * servers against that job's throwaway Postgres and Redis. Anywhere else, set
 * E2E_BASE_URL to an environment where creating test accounts is acceptable:
 * the suite never starts servers on a developer or production host by itself,
 * because the API's background workers talk to the local Docker daemon.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const startServers = !process.env.E2E_BASE_URL && !!process.env.CI

export const STORAGE_STATE = 'playwright/.auth/user.json'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The github reporter turns failures into annotations on the check run.
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'public', testMatch: /auth\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'dashboard',
      testMatch: /dashboard\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
  webServer: startServers
    ? [
        {
          command: 'pnpm --filter @guildserver/api exec tsx src/index.ts',
          url: 'http://localhost:4000/health',
          timeout: 120_000,
          reuseExistingServer: false,
        },
        {
          command: 'pnpm --filter @guildserver/web start',
          url: 'http://localhost:3000',
          timeout: 120_000,
          reuseExistingServer: false,
        },
      ]
    : undefined,
})
