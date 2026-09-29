const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('models tab', () => {
  test.beforeEach(async ({ page }) => {
    // Auto-accept confirm() dialogs (delete buttons use them).
    page.on('dialog', d => d.accept());
  });

  test('create, edit, delete an Ollama model', async ({ page }) => {
    const name = await uniqueName('model');
    const renamed = await uniqueName('renamed');

    await openAdminTab(page, 'models');

    // --- Create ---
    await page.click('button:has-text("+ New Model")');
    await expect(page.locator('#modelModal')).toHaveClass(/open/);
    await page.fill('#modelName', name);
    // provider defaults to "ollama" — API-key field should be hidden
    await expect(page.locator('#apiKeyRow')).toBeHidden();
    await page.fill('#modelModelId', 'gemma3:1b');
    await page.click('#modelModal .btn-save');
    await expect(page.locator('#modelModal')).not.toHaveClass(/open/);
    await expect(page.locator('#modelsTable')).toContainText(name);

    // --- Edit (rename) ---
    const row = page.locator('#modelsTable tr', { hasText: name });
    await row.locator('button:has-text("Edit")').click();
    await expect(page.locator('#modelModal')).toHaveClass(/open/);
    await page.fill('#modelName', renamed);
    await page.click('#modelModal .btn-save');
    await expect(page.locator('#modelsTable')).toContainText(renamed);
    await expect(page.locator('#modelsTable')).not.toContainText(name);

    // --- Delete ---
    const renamedRow = page.locator('#modelsTable tr', { hasText: renamed });
    await renamedRow.locator('button.danger').click();
    await expect(page.locator('#modelsTable')).not.toContainText(renamed);
  });

  test('switching to OpenRouter provider reveals the API key field', async ({ page }) => {
    await openAdminTab(page, 'models');
    await page.click('button:has-text("+ New Model")');
    await expect(page.locator('#apiKeyRow')).toBeHidden();
    await page.selectOption('#modelProvider', 'openrouter');
    await expect(page.locator('#apiKeyRow')).toBeVisible();
    await page.selectOption('#modelProvider', 'ollama');
    await expect(page.locator('#apiKeyRow')).toBeHidden();
  });
});

// API-level: what the JSON error middleware turns a Postgres constraint
// violation into. Before it existed these came back as an HTML 500 that the
// admin UI's api() helper could not parse.
test.describe('models API errors', () => {
  test('duplicate name is a 409 with a JSON reason', async ({ request }) => {
    const name = await uniqueName('pw-model-dup');
    const first = await request.post('/api/models', { data: { name, model_id: 'gemma3:1b' } });
    expect(first.ok()).toBeTruthy();
    const { id } = await first.json();
    try {
      const second = await request.post('/api/models', { data: { name, model_id: 'gemma3:1b' } });
      expect(second.status()).toBe(409);
      expect((await second.json()).error).toContain('already exists');
    } finally {
      await request.delete(`/api/models/${id}`);
    }
  });

  test('non-numeric id is a 400, not an HTML 500', async ({ request }) => {
    const r = await request.delete('/api/models/not-a-number');
    expect(r.status()).toBe(400);
    expect(r.headers()['content-type']).toContain('application/json');
  });
});
