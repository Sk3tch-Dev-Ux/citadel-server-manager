// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright E2E config for the Citadel dashboard (web/frontend).
 *
 * The repo's frontend has no automated tests yet; this is the entry point for
 * end-to-end / visual smoke tests. Tests live in ./e2e.
 *
 * Default target is the Vite dev server (127.0.0.1:5173), which proxies /api
 * and /socket.io to the backend on :3001. Override with PLAYWRIGHT_BASE_URL
 * to point at a production build (e.g. http://127.0.0.1:3001).
 *
 * Setup once:  npm install && npx playwright install
 * Run:         npm run test:e2e        (headless)
 *              npm run test:e2e:ui     (interactive UI mode)
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Uncomment to broaden coverage:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
  ],

  // Auto-start the dev server unless one is already running. Disabled when
  // PLAYWRIGHT_BASE_URL is set (assume the target is already up). The dev
  // server runs setup.js then backend + Vite via concurrently.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        timeout: 180 * 1000,
        reuseExistingServer: !process.env.CI,
      },
});
