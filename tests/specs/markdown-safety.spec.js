const { test, expect } = require('@playwright/test');
const { psql } = require('../helpers/db.js');

// Assistant replies are rendered as markdown. Only http(s), mailto, relative
// and #anchor links become real links (SAFE_HREF in streaming-response.tsx);
// javascript:/data: links and raw HTML must stay inert text. Seeded as
// session history via psql — the dev stack has no model.

test.describe('markdown in assistant replies', () => {
  let agentId, modelId;

  test.beforeAll(async ({ request }) => {
    const m = await request.post('/api/models', {
      data: { name: 'pw-markdown-model', provider: 'ollama', base_url: 'http://ollama:11434', model_id: 'pw-none' },
    });
    modelId = (await m.json()).id;
    const a = await request.post('/api/agents', { data: { name: 'pw-markdown-agent', system_prompt: '', model_id: modelId } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
    if (modelId) await request.delete(`/api/models/${modelId}`);
  });

  test('javascript: and data: links and raw HTML stay inert', async ({ page }) => {
    const sid = `pw-markdown-${Date.now()}`;
    const marker = `pw-markdown-reply-${Date.now()}`;
    // No underscores in the payload: markdown would read them as emphasis.
    const img = '<img src=x onerror="window.pwMdXss=1">';
    const reply = [
      marker,
      '[js link](javascript:window.pwMdXss=1) [data link](data:text/html,<script>window.pwMdXss=1</script>)',
      '[safe link](https://example.com/pw)',
      img,
    ].join('\n\n');

    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-markdown-agent', 'web');
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'user', 'links please');
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'assistant', $$${reply}$$);
    `);

    try {
      await page.goto('/');
      await page.locator('#sessions .session-item', { hasText: marker }).click();
      const message = page.locator('.msg.assistant', { hasText: marker });
      await expect(message).toContainText('safe link');

      // The safe link is a real link; the unsafe ones are rendered without one.
      await expect(message.locator('a', { hasText: 'safe link' })).toHaveAttribute('href', 'https://example.com/pw');
      await expect(message.locator('a', { hasText: 'js link' })).toHaveCount(0);
      await expect(message.locator('a', { hasText: 'data link' })).toHaveCount(0);
      await expect(message.locator('a[href^="javascript:" i], a[href^="data:" i]')).toHaveCount(0);

      // Raw HTML shows as text and never becomes an element.
      await expect(message).toContainText(img);
      await expect(message.locator('img, script')).toHaveCount(0);

      await message.getByText('js link').click();
      expect(await page.evaluate(() => window.pwMdXss)).toBeUndefined();
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });
});
