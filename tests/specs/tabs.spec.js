const { test, expect } = require('@playwright/test');

const TABS = ['models', 'agents', 'skills', 'channels', 'crons', 'settings'];

test.describe('admin tabs', () => {
  test('default tab is Models', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#tab-models')).toBeVisible();
    for (const t of TABS.filter(x => x !== 'models')) {
      await expect(page.locator(`#tab-${t}`)).toBeHidden();
    }
    await expect(page.locator('.tab-button[data-tab="models"]')).toHaveClass(/active/);
  });

  for (const t of TABS) {
    test(`clicking ${t} shows only that section and updates the URL hash`, async ({ page }) => {
      await page.goto('/admin');
      await page.click(`.tab-button[data-tab="${t}"]`);
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
    await expect(page.locator('.tab-button[data-tab="crons"]')).toHaveClass(/active/);
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
