// Logs in once and persists the cookie to .auth/state.json so individual
// tests can run authenticated without redoing the login dance.

const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { clearTestData } = require('./helpers/cleanup.js');

const BASE = 'http://localhost:3000';
const USER = 'admin';
const PASSWORD = 'changeme';
const STATE_PATH = path.join(__dirname, '.auth/state.json');

module.exports = async () => {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  // Drop any leftover pw-* rows from previous runs so tests start from
  // a known-clean state.
  try { clearTestData(); } catch (err) {
    console.warn('[setup] cleanup failed (DB may not be reachable yet):', err.message);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="user"]', USER);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(new RegExp(`^${BASE}/?$`), { timeout: 10_000 }),
    page.click('button[type="submit"]'),
  ]);

  await context.storageState({ path: STATE_PATH });
  await browser.close();
};
