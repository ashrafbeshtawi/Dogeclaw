// Playwright config for DogeClaw end-to-end tests.
//
// Run: cd tests && npm install && npx playwright install chromium && npm test
//
// The suite assumes the dev compose stack is reachable at http://localhost:3000.
// If nothing is running, Playwright starts it via `docker compose up -d` from
// the repo root and polls /login until it responds.

const { defineConfig } = require('@playwright/test');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,        // tests share one Postgres + one agent process
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    storageState: path.join(__dirname, '.auth/state.json'),
  },

  globalSetup: require.resolve('./global-setup.js'),

  webServer: {
    command: `docker compose -f ${path.join(REPO_ROOT, 'docker-compose.yml')} up -d`,
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
