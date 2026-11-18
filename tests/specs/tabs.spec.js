const { test, expect } = require('@playwright/test');

const TABS = ['models', 'agents', 'skills', 'channels', 'crons', 'events', 'settings'];
const LABELS = { models: 'Models', agents: 'Agents', skills: 'Skills', channels: 'Channels', crons: 'Cron Jobs', events: 'Events', settings: 'Settings' };
// The tab bar is a Rare UI GooeyNav: one button per tab, aria-current on the active one.
const tabButton = (page, t) => page.locator('#adminTabs button', { hasText: LABELS[t] });

test.describe('admin tabs', () => {
  test('default tab is Models', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#tab-models')).toBeVisible();
    for (const t of TABS.filter(x => x !== 'models')) {
      await expect(page.locator(`#tab-${t}`)).toBeHidden();
    }
    await expect(tabButton(page, 'models')).toHaveAttribute('aria-current', 'true');
  });

  for (const t of TABS) {
    test(`clicking ${t} shows only that section and updates the URL hash`, async ({ page }) => {
      await page.goto('/admin');
      await tabButton(page, t).click();
      await expect(page.locator(`#tab-${t}`)).toBeVisible();
      for (const other of TABS.filter(x => x !== t)) {
        await expect(page.locator(`#tab-${other}`)).toBeHidden();
      }
      await expect(page).toHaveURL(new RegExp(`#${t}$`));
    });
  }

  test('deep-link via #crons opens the Crons tab on first paint', async ({ page }) => {
    await page.goto('/admin#crons');
    await expect(page.locator('#tab-crons')).toBeVisible();
    await expect(tabButton(page, 'crons')).toHaveAttribute('aria-current', 'true');
  });

  test('hashchange listener switches tabs when the hash is set externally', async ({ page }) => {
    await page.goto('/admin#models');
    await page.evaluate(() => { window.location.hash = '#crons'; });
    await expect(page.locator('#tab-crons')).toBeVisible();
    await expect(page.locator('#tab-models')).toBeHidden();
  });

  test('invalid hash falls back to Models', async ({ page }) => {
    await page.goto('/admin#bogus');
    await expect(page.locator('#tab-models')).toBeVisible();
  });
});
