import { defineConfig, devices } from '@playwright/test';

// Critical user flows in a real browser, against `npm start` (wrangler dev
// with the production headers from public/_headers). Not part of the deploy
// gate: the Workers Builds image cannot start Chromium. Run before pushing UI changes.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:40460',
    serviceWorkers: 'block'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:40460',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
