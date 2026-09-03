const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('mcp tab', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('api: create, list, update, delete a server', async ({ page }) => {
    const name = await uniqueName('mcp');
    const created = await page.request.post('/api/mcp', {
      data: { name, description: 'test server', command: 'true', args: ['--flag'], env: { FOO: 'bar' } },
    });
    expect(created.ok()).toBeTruthy();
    const server = await created.json();
    expect(server.name).toBe(name);
    expect(server.description).toBe('test server');

    try {
      const list = await (await page.request.get('/api/mcp')).json();
      const row = list.servers.find(s => s.id === server.id);
      expect(row).toBeTruthy();
      // No assignment = hidden from every agent
      expect(row.agent_ids).toEqual([]);

      const updated = await page.request.put(`/api/mcp/${server.id}`, {
        data: { name, description: 'updated', command: 'true', args: [], env: {}, enabled: false },
      });
      expect(updated.ok()).toBeTruthy();
      const upd = await updated.json();
      expect(upd.description).toBe('updated');
      expect(upd.enabled).toBe(false);
    } finally {
      const del = await page.request.delete(`/api/mcp/${server.id}`);
      expect(del.ok()).toBeTruthy();
    }
  });

  test('api: agent assignment round-trips and cascades on agent delete', async ({ page }) => {
    const serverName = await uniqueName('mcp');
    const agentName = await uniqueName('agent');
    const a = await page.request.post('/api/agents', { data: { name: agentName, system_prompt: '' } });
    const agentId = (await a.json()).id;
    const created = await page.request.post('/api/mcp', {
      data: { name: serverName, command: 'true', agent_ids: [agentId] },
    });
    const server = await created.json();

    try {
      let list = await (await page.request.get('/api/mcp')).json();
      expect(list.servers.find(s => s.id === server.id).agent_ids).toEqual([agentId]);

      // Unassign via PUT with empty array
      await page.request.put(`/api/mcp/${server.id}`, {
        data: { name: serverName, command: 'true', agent_ids: [] },
      });
      list = await (await page.request.get('/api/mcp')).json();
      expect(list.servers.find(s => s.id === server.id).agent_ids).toEqual([]);

      // Re-assign, then deleting the agent must drop the assignment (FK CASCADE)
      await page.request.put(`/api/mcp/${server.id}`, {
        data: { name: serverName, command: 'true', agent_ids: [agentId] },
      });
      await page.request.delete(`/api/agents/${agentId}`);
      list = await (await page.request.get('/api/mcp')).json();
      expect(list.servers.find(s => s.id === server.id).agent_ids).toEqual([]);
    } finally {
      await page.request.delete(`/api/mcp/${server.id}`);
      await page.request.delete(`/api/agents/${agentId}`);
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

  test('api: http transport round-trips and validates url', async ({ page }) => {
    const name = await uniqueName('mcphttp');
    const created = await page.request.post('/api/mcp', {
      data: { name, transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    });
    expect(created.ok()).toBeTruthy();
    const server = await created.json();
    try {
      expect(server.transport).toBe('http');
      expect(server.url).toBe('https://mcp.example.com/mcp');
      expect(server.headers).toEqual({ Authorization: 'Bearer x' });
      expect(server.command).toBeNull();
    } finally {
      await page.request.delete(`/api/mcp/${server.id}`);
    }

    const noUrl = await page.request.post('/api/mcp', {
      data: { name: await uniqueName('mcpbad'), transport: 'http' },
    });
    expect(noUrl.status()).toBe(400);

    const badUrl = await page.request.post('/api/mcp', {
      data: { name: await uniqueName('mcpbad'), transport: 'http', url: 'not a url' },
    });
    expect(badUrl.status()).toBe(400);
  });

  test('api: discover on an unreachable http url fails cleanly', async ({ page }) => {
    const r = await page.request.post('/api/mcp/discover', {
      data: { transport: 'http', url: 'http://127.0.0.1:1/mcp' },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBeTruthy();
  });

  test('api: discover on a bogus command fails cleanly', async ({ page }) => {
    const r = await page.request.post('/api/mcp/discover', {
      data: { command: 'definitely-not-a-real-command-xyz' },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBeTruthy();
  });

  test('ui: create, assign an agent, delete a server via the modal', async ({ page }) => {
    const name = await uniqueName('mcpui');
    const agentName = await uniqueName('agent');
    const a = await page.request.post('/api/agents', { data: { name: agentName, system_prompt: '' } });
    const agentId = (await a.json()).id;

    try {
      await openAdminTab(page, 'mcp');
      await page.click('button:has-text("+ New Server")');
      await expect(page.locator('#mcpModal')).toHaveClass(/open/);

      await page.fill('#mcpName', name);
      await page.fill('#mcpDescription', 'ui test server');
      await page.fill('#mcpCommand', 'true');
      await page.fill('#mcpArgs', '--a\n--b');
      await page.fill('#mcpEnv', 'KEY=value');
      // No agents checked → hidden from every agent
      await page.click('#mcpModal .btn-save');
      await expect(page.locator('#mcpModal')).not.toHaveClass(/open/);

      const row = page.locator('#mcpTable tr', { hasText: name });
      await expect(row).toContainText('true --a --b');
      await expect(row).toContainText('hidden');
      await expect(row.locator('.badge-on')).toHaveText('on');

      // Edit: assign the agent — badge switches from "hidden" to the name
      await row.locator('button:has-text("Edit")').click();
      await page.check(`#mcpAgentsCheckboxes input[value="${agentId}"]`);
      await page.click('#mcpModal .btn-save');
      const updatedRow = page.locator('#mcpTable tr', { hasText: name });
      await expect(updatedRow).toContainText(agentName);
      await expect(updatedRow).not.toContainText('hidden');

      await updatedRow.locator('button:has-text("Delete")').click();
      await expect(page.locator('#mcpTable tr', { hasText: name })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
    }
  });
});
