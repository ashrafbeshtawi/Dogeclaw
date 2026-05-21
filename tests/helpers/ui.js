// UI helpers shared by specs.

const { expect } = require('@playwright/test');

async function openAdminTab(page, tab) {
  await page.goto(`/admin#${tab}`);
  await expect(page.locator(`#tab-${tab}`)).toBeVisible();
}

async function closeOpenModal(page) {
  // Click the topmost open modal's Cancel button (any modal-overlay.open).
  await page.locator('.modal-overlay.open .btn-cancel').first().click();
}

async function uniqueName(prefix) {
  return `pw-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

module.exports = { openAdminTab, closeOpenModal, uniqueName };
