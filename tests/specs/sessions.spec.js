const { test, expect } = require('@playwright/test');
const { psql } = require('../helpers/db.js');

test.describe('chat UI session list', () => {
  let agentId;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-sess-agent', system_prompt: '' } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('seeded session shows in the sidebar with its preview', async ({ page }) => {
    const sid = `pw-sess-show-${Date.now()}`;
    const marker = `pw-preview-marker-${Date.now()}`;
    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-sess-agent', 'web');
      INSERT INTO session_messages (session_id, role, content) VALUES
        ('${sid}', 'user', 'hello'),
        ('${sid}', 'assistant', '${marker}');
    `);

    try {
      await page.goto('/');
      // Session id isn't rendered into visible text — the row shows `preview`.
      const item = page.locator('#sessions .session-item', { hasText: marker });
      await expect(item).toBeVisible();
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });

  test('deleting a session with attached crons shows a warning dialog', async ({ page, request }) => {
    const sid = `pw-sess-warn-${Date.now()}`;
    const marker = `pw-preview-warn-${Date.now()}`;
    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-sess-agent', 'web');
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'user', '${marker}');
    `);
    const r = await request.post('/api/cron-jobs', {
      data: {
        agent_id: agentId,
        session_id: sid,
        expression: '0 9 * * *',
        description: 'pw-warn-attached',
        prompt: 'do thing',
      },
    });
    expect(r.ok()).toBeTruthy();

    try {
      let warningSeen = null;
      page.on('dialog', d => {
        warningSeen = d.message();
        d.dismiss();  // cancel — we don't actually want to delete here
      });

      await page.goto('/');
      const item = page.locator('#sessions .session-item', { hasText: marker });
      await expect(item).toBeVisible();
      await item.locator('.del').click();

      // Wait until the dialog fires + message is captured
      await expect.poll(() => warningSeen).not.toBeNull();
      expect(warningSeen).toMatch(/1 scheduled job/);
      expect(warningSeen).toMatch(/pw-warn-attached/);
      expect(warningSeen).toMatch(/cron 0 9 \* \* \*/);

      // Cancel was clicked, so the session must still be there
      const list = await (await request.get('/api/sessions')).json();
      expect(list.sessions.find(s => s.id === sid)).toBeTruthy();
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });
});
