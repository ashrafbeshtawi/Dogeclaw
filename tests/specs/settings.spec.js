const { test, expect } = require('@playwright/test');
const { openAdminTab } = require('../helpers/ui.js');

test.describe('settings tab', () => {
  test('timezone select is populated with IANA zones', async ({ page }) => {
    await openAdminTab(page, 'settings');
    const optionCount = await page.locator('#settingTimezone option').count();
    expect(optionCount).toBeGreaterThan(100); // 400+ on a modern Chromium
    await expect(page.locator('#settingTimezone option[value="Europe/Berlin"]')).toHaveCount(1);
    await expect(page.locator('#settingTimezone option[value="America/New_York"]')).toHaveCount(1);
  });

  test('changing timezone persists and surfaces via /api/settings', async ({ page, request }) => {
    // Read current value so we can restore it after
    const before = await (await request.get('/api/settings')).json();
    const original = before.timezone || 'UTC';
    const target = original === 'Europe/Berlin' ? 'America/New_York' : 'Europe/Berlin';

    try {
      await openAdminTab(page, 'settings');
      await page.selectOption('#settingTimezone', target);
      // saveTimezone() calls load() which alerts on success path — accept dialogs
      page.on('dialog', d => d.accept());
      await page.click('button:has-text("Save")');

      // Poll the API directly to verify persistence
      await expect.poll(async () => {
        const s = await (await request.get('/api/settings')).json();
        return s.timezone;
      }).toBe(target);
    } finally {
      // Restore
      await request.put('/api/settings/timezone', { data: { value: original } });
    }
  });

  test('google search credentials save from the UI and round-trip', async ({ page, request }) => {
    const before = await (await request.get('/api/settings')).json();

    try {
      await openAdminTab(page, 'settings');
      await page.fill('#settingGoogleKey', 'pw-test-key');
      await page.fill('#settingGoogleCx', 'pw-test-cx');
      await page.locator('tr', { hasText: 'Google search' }).locator('button:has-text("Save")').click();

      await expect.poll(async () => {
        const s = await (await request.get('/api/settings')).json();
        return `${s.google_search_api_key}/${s.google_search_cx}`;
      }).toBe('pw-test-key/pw-test-cx');

      // Rendered back into the inputs after reload
      await page.reload();
      await openAdminTab(page, 'settings');
      await expect(page.locator('#settingGoogleKey')).toHaveValue('pw-test-key');
    } finally {
      await request.put('/api/settings/google_search_api_key', { data: { value: before.google_search_api_key || '' } });
      await request.put('/api/settings/google_search_cx', { data: { value: before.google_search_cx || '' } });
    }
  });

  test('new cron modal defaults its timezone to the global setting', async ({ page, request }) => {
    // Ensure a known global value
    await request.put('/api/settings/timezone', { data: { value: 'Europe/Berlin' } });

    // Need an agent + channel so the modal can open without target errors
    const a = await request.post('/api/agents', { data: { name: 'pw-tz-agent', system_prompt: '' } });
    const agentId = (await a.json()).id;
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: `pw-tz-channel-${Date.now()}`, config: { token: 'fake' }, response_mode: 'immediate' },
    });

    try {
      await openAdminTab(page, 'crons');
      await page.click('button:has-text("+ New Job")');
      await expect(page.locator('#cronModal')).toHaveClass(/open/);
      // The cron modal's TZ select should default to the settings value
      await expect(page.locator('#cronTimezone')).toHaveValue('Europe/Berlin');
    } finally {
      await request.delete(`/api/agents/${agentId}`);
    }
  });
});
