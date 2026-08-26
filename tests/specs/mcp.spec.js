const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('mcp tab', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('api: create, list, update, delete a server', async ({ page }) => {
    const name = await uniqueName('mcp');
    const created = await page.request.post('/api/mcp', {
      data: { name, command: 'true', args: ['--flag'], env: { FOO: 'bar' }, allowed_tools: ['one'] },
    });
    expect(created.ok()).toBeTruthy();
    const server = await created.json();
    expect(server.name).toBe(name);
    expect(server.allowed_tools).toEqual(['one']);

    try {
      const list = await (await page.request.get('/api/mcp')).json();
      expect(list.servers.some(s => s.id === server.id)).toBeTruthy();

      // Full-row update; allowed_tools null (= all) must round-trip.
      const updated = await page.request.put(`/api/mcp/${server.id}`, {
        data: { name, command: 'true', args: [], env: {}, allowed_tools: null, enabled: false },
      });
      expect(updated.ok()).toBeTruthy();
      const row = await updated.json();
      expect(row.allowed_tools).toBeNull();
      expect(row.enabled).toBe(false);
    } finally {
      const del = await page.request.delete(`/api/mcp/${server.id}`);
      expect(del.ok()).toBeTruthy();
    }
  });

  test('api: rejects invalid names and missing fields', async ({ page }) => {
    const bad = await page.request.post('/api/mcp', {
      data: { name: 'has spaces!', command: 'true' },
    });
    expect(bad.status()).toBe(400);

    const missing = await page.request.post('/api/mcp', { data: { name: 'x' } });
    expect(missing.status()).toBe(400);
  });

  test('api: discover on a bogus command fails cleanly', async ({ page }) => {
    const r = await page.request.post('/api/mcp/discover', {
      data: { command: 'definitely-not-a-real-command-xyz' },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBeTruthy();
  });

  test('ui: create, edit, delete a server via the modal', async ({ page }) => {
    const name = await uniqueName('mcpui');

    await openAdminTab(page, 'mcp');
    await page.click('button:has-text("+ New Server")');
    await expect(page.locator('#mcpModal')).toHaveClass(/open/);

    await page.fill('#mcpName', name);
    await page.fill('#mcpCommand', 'true');
    await page.fill('#mcpArgs', '--a\n--b');
    await page.fill('#mcpEnv', 'KEY=value');
    await page.click('#mcpModal .btn-save');
    await expect(page.locator('#mcpModal')).not.toHaveClass(/open/);

    const row = page.locator('#mcpTable tr', { hasText: name });
    await expect(row).toContainText('true --a --b');
    await expect(row).toContainText('0 allowed');
    await expect(row.locator('.badge-on')).toHaveText('on');

    // Edit: switch to expose-all
    await row.locator('button:has-text("Edit")').click();
    await page.check('#mcpAllowAll');
    await page.click('#mcpModal .btn-save');
    await expect(page.locator('#mcpTable tr', { hasText: name })).toContainText('all');

    await page.locator('#mcpTable tr', { hasText: name }).locator('button:has-text("Delete")').click();
    await expect(page.locator('#mcpTable tr', { hasText: name })).toHaveCount(0);
  });
});
