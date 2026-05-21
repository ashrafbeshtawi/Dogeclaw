const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');
const { psql } = require('../helpers/db.js');

test.describe('cron jobs tab', () => {
  let agentId, channelId, channelName;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-cron-agent-fix', system_prompt: '' } });
    agentId = (await a.json()).id;
    channelName = `pw-cron-channel-fix-${Date.now()}`;
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: channelName, config: { token: 'fake' }, response_mode: 'immediate' },
    });
    channelId = (await c.json()).id;
  });

  test.afterAll(async ({ request }) => {
    // Deleting the agent cascades both channel and crons.
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('create telegram recurring cron via UI', async ({ page }) => {
    const desc = await uniqueName('cron-recur');

    await openAdminTab(page, 'crons');
    await page.click('button:has-text("+ New Job")');
    await expect(page.locator('#cronModal')).toHaveClass(/open/);

    await page.selectOption('#cronAgent', String(agentId));
    await page.selectOption('#cronTargetType', 'telegram');
    await page.selectOption('#cronChannel', String(channelId));
    await page.fill('#cronChatId', '7777777');
    await page.selectOption('#cronScheduleType', 'recurring');
    await page.fill('#cronExpression', '*/30 * * * *');
    await page.selectOption('#cronTimezone', 'Europe/Berlin');
    await page.fill('#cronDescription', desc);
    await page.fill('#cronPrompt', 'do the thing');
    await page.click('#cronModal .btn-save');
    await expect(page.locator('#cronModal')).not.toHaveClass(/open/);

    const row = page.locator('#cronsTable tr', { hasText: desc });
    await expect(row).toContainText('TG:');
    await expect(row).toContainText('7777777');
    await expect(row).toContainText('*/30 * * * *');
    await expect(row).toContainText('Europe/Berlin');
  });

  test('create one-shot cron via UI', async ({ page }) => {
    const desc = await uniqueName('cron-once');

    await openAdminTab(page, 'crons');
    await page.click('button:has-text("+ New Job")');

    await page.selectOption('#cronAgent', String(agentId));
    await page.selectOption('#cronTargetType', 'telegram');
    await page.selectOption('#cronChannel', String(channelId));
    await page.fill('#cronChatId', '8888888');
    await page.selectOption('#cronScheduleType', 'one_shot');
    await expect(page.locator('#cronExpressionField')).toBeHidden();
    await expect(page.locator('#cronRunAtField')).toBeVisible();

    // 2099-01-01 09:00 local
    await page.fill('#cronRunAt', '2099-01-01T09:00');
    await page.fill('#cronDescription', desc);
    await page.fill('#cronPrompt', 'fire once');
    await page.click('#cronModal .btn-save');

    const row = page.locator('#cronsTable tr', { hasText: desc });
    await expect(row).toContainText('at 2099-');
  });

  test('API rejects both expression and run_at', async ({ request }) => {
    const r = await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId,
        channel_id: channelId,
        chat_id: '1',
        expression: '*/5 * * * *',
        run_at: '2099-01-01T00:00:00Z',
        prompt: 'x',
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/exactly one/i);
  });

  test('API rejects a bad cron expression', async ({ request }) => {
    const r = await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId,
        channel_id: channelId,
        chat_id: '1',
        expression: 'this is not cron',
        prompt: 'x',
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/invalid cron expression/i);
  });

  test('API rejects target without channel or session', async ({ request }) => {
    const r = await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId,
        expression: '*/5 * * * *',
        prompt: 'x',
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/channel.+session/i);
  });

  test('edit cron prompt via UI', async ({ page, request }) => {
    const desc = await uniqueName('cron-edit');
    // Seed via API
    const r = await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId,
        channel_id: channelId,
        chat_id: '3',
        expression: '0 8 * * *',
        description: desc,
        prompt: 'original prompt',
      },
    });
    expect(r.ok()).toBeTruthy();

    await openAdminTab(page, 'crons');
    const row = page.locator('#cronsTable tr', { hasText: desc });
    await row.locator('button:has-text("Edit")').click();
    await expect(page.locator('#cronModal')).toHaveClass(/open/);
    // Target fields should be disabled on edit
    await expect(page.locator('#cronAgent')).toBeDisabled();
    await expect(page.locator('#cronChannel')).toBeDisabled();
    await expect(page.locator('#cronChatId')).toBeDisabled();
    await expect(page.locator('#cronEditHint')).toBeVisible();

    await page.fill('#cronPrompt', 'changed prompt');
    await page.click('#cronModal .btn-save');
    await expect(page.locator('#cronsTable tr', { hasText: desc })).toContainText('changed prompt');
  });

  test('delete cron via UI', async ({ page, request }) => {
    const desc = await uniqueName('cron-del');
    await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId, channel_id: channelId, chat_id: '4',
        expression: '0 0 * * *', description: desc, prompt: 'doomed',
      },
    });

    await openAdminTab(page, 'crons');
    const row = page.locator('#cronsTable tr', { hasText: desc });
    await row.locator('button.danger').click();
    await expect(page.locator('#cronsTable')).not.toContainText(desc);
  });

  test('FK cascade: deleting a session drops attached crons', async ({ request }) => {
    const desc = `pw-cron-cascade-sess-${Date.now()}`;
    const sid = `pw-sess-${Date.now()}`;
    psql(`INSERT INTO sessions (id, agent_id, agent_name, source) VALUES ('${sid}', ${agentId}, 'pw', 'web');`);
    const r = await request.post('/api/cron-jobs', {
      data: { agent_id: agentId, session_id: sid, expression: '0 9 * * *', description: desc, prompt: 'x' },
    });
    const jobId = (await r.json()).id;

    // Confirm it's there
    const list1 = await (await request.get('/api/cron-jobs')).json();
    expect(list1.jobs.find(j => j.id === jobId)).toBeTruthy();

    // Delete the session
    const del = await request.delete(`/api/sessions/${sid}`);
    expect(del.ok()).toBeTruthy();

    const list2 = await (await request.get('/api/cron-jobs')).json();
    expect(list2.jobs.find(j => j.id === jobId)).toBeFalsy();
  });

  test('FK cascade: deleting a channel drops attached crons', async ({ request }) => {
    // Build a disposable channel + cron
    const tmpChannelName = `pw-cron-tmpchan-${Date.now()}`;
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: tmpChannelName, config: { token: 'fake' }, response_mode: 'immediate' },
    });
    const tmpChannelId = (await c.json()).id;
    const desc = `pw-cron-cascade-chan-${Date.now()}`;
    const r = await request.post('/api/cron-jobs', {
      data: { agent_id: agentId, channel_id: tmpChannelId, chat_id: '5', expression: '0 9 * * *', description: desc, prompt: 'x' },
    });
    const jobId = (await r.json()).id;

    await request.delete(`/api/channels/${tmpChannelId}`);

    const list = await (await request.get('/api/cron-jobs')).json();
    expect(list.jobs.find(j => j.id === jobId)).toBeFalsy();
  });
});
