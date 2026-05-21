const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('channels tab', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('create, edit, delete a telegram channel', async ({ page }) => {
    const channelName = await uniqueName('channel');
    const agentName = await uniqueName('agent');

    // Need an agent for the channel
    const a = await page.request.post('/api/agents', { data: { name: agentName, system_prompt: '' } });
    const agentId = (await a.json()).id;

    try {
      await openAdminTab(page, 'channels');
      await page.click('button:has-text("+ New Channel")');
      await expect(page.locator('#channelModal')).toHaveClass(/open/);

      await page.fill('#channelName', channelName);
      await page.selectOption('#channelAgent', String(agentId));
      await page.fill('#channelToken', 'fake-token-123');
      await page.fill('#channelUsers', '111,222');
      await page.click('#channelModal .btn-save');
      await expect(page.locator('#channelModal')).not.toHaveClass(/open/);

      const row = page.locator('#channelsTable tr', { hasText: channelName });
      await expect(row).toContainText(agentName);
      await expect(row).toContainText('immediate');
      await expect(row.locator('.badge-on')).toHaveText('on');

      // Edit: switch to periodic
      await row.locator('button:has-text("Edit")').click();
      await page.selectOption('#channelMode', 'periodic');
      await page.fill('#channelInterval', '30m');
      await page.click('#channelModal .btn-save');
      await expect(page.locator('#channelsTable')).toContainText('periodic / 30m');

      // Delete
      await row.locator('button.danger').click();
      await expect(page.locator('#channelsTable')).not.toContainText(channelName);
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
    }
  });
});
