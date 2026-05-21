const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('agents tab', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('create, edit, delete an agent', async ({ page, request }) => {
    const name = await uniqueName('agent');

    await openAdminTab(page, 'agents');
    await page.click('button:has-text("+ New Agent")');
    await expect(page.locator('#agentModal')).toHaveClass(/open/);

    await page.fill('#agentName', name);
    await page.fill('#agentPrompt', 'You are a test agent.');
    // model select includes a "(default)" empty option — leave empty for now
    await page.click('#agentModal .btn-save');
    await expect(page.locator('#agentModal')).not.toHaveClass(/open/);
    await expect(page.locator('#agentsTable')).toContainText(name);

    // Edit: change the system prompt
    const row = page.locator('#agentsTable tr', { hasText: name });
    await row.locator('button:has-text("Edit")').click();
    await page.fill('#agentPrompt', 'Updated prompt.');
    await page.click('#agentModal .btn-save');
    await expect(page.locator('#agentsTable')).toContainText('Updated prompt.');

    // Delete
    await row.locator('button.danger').click();
    await expect(page.locator('#agentsTable')).not.toContainText(name);
  });

  test('agent appears in Channel-modal dropdown', async ({ page }) => {
    const name = await uniqueName('agent');

    // Create via API to keep this test fast
    const res = await page.request.post('/api/agents', {
      data: { name, system_prompt: '' },
    });
    expect(res.ok()).toBeTruthy();

    await openAdminTab(page, 'channels');
    await page.click('button:has-text("+ New Channel")');
    await expect(page.locator('#channelModal')).toHaveClass(/open/);
    await expect(page.locator('#channelAgent')).toContainText(name);

    // Cleanup
    const agentId = (await res.json()).id;
    await page.request.delete(`/api/agents/${agentId}`);
  });
});
