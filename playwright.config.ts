import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, E2E_PORT } from './tests/e2e/env';

export default defineConfig({
  testDir: './tests/e2e',
  // One database and one worker process between them, so specs cannot overlap.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A production build because a cold `next dev` compile leaves pages unhydrated long enough for
    // a click to submit natively; its own distDir keeps it from clobbering a running dev server.
    command: `npx prisma migrate deploy && npx next build && npx next start --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    env: E2E_ENV,
    timeout: 240_000,
    // Anything already on the port is serving some other database; set E2E_PORT to move it.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
