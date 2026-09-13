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

  test('webhook_id is minted at creation and survives edits', async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: await uniqueName('agent'), system_prompt: '' } });
    const agentId = (await a.json()).id;
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: await uniqueName('channel'), token: 'fake', response_mode: 'immediate' },
    });
    const channel = await c.json();

    try {
      // DB default mints a uuid at INSERT — present from the first response
      expect(channel.webhook_id).toMatch(/^[0-9a-f-]{36}$/);

      // Rename + token rotation must not touch it
      const upd = await request.put(`/api/channels/${channel.id}`, {
        data: { name: await uniqueName('renamed'), token: 'fake-rotated', allowed_users: [1, 2] },
      });
      const row = await upd.json();
      expect(row.webhook_id).toBe(channel.webhook_id);
      expect(row.token).toBe('fake-rotated');
      expect(row.allowed_users.map(Number)).toEqual([1, 2]);

      // telegram channels require a token at creation
      const noToken = await request.post('/api/channels', {
        data: { agent_id: agentId, type: 'telegram', name: await uniqueName('channel') },
      });
      expect(noToken.status()).toBe(400);
    } finally {
      await request.delete(`/api/agents/${agentId}`);
    }
  });

  test('agent DB role cannot read channel tokens or model api keys', async ({ request }) => {
    const { psql } = require('../helpers/db.js');
    // Non-secret columns stay readable for the agent's raw SQL tool...
    expect(() => psql('SET ROLE dogeclaw; SELECT id, name, type FROM channels LIMIT 1;')).not.toThrow();
    expect(() => psql('SET ROLE dogeclaw; SELECT id, name, provider FROM models LIMIT 1;')).not.toThrow();
    // ...but the secrets are column-revoked (V18).
    expect(() => psql('SET ROLE dogeclaw; SELECT token FROM channels LIMIT 1;')).toThrow(/permission denied/);
    expect(() => psql('SET ROLE dogeclaw; SELECT webhook_id FROM channels LIMIT 1;')).toThrow(/permission denied/);
    expect(() => psql('SET ROLE dogeclaw; SELECT api_key FROM models LIMIT 1;')).toThrow(/permission denied/);
  });
});
