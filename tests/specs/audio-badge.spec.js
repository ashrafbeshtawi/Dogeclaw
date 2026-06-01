const { test, expect } = require('@playwright/test');
const { psql } = require('../helpers/db.js');

// Whisper was removed in V12. The chat UI now renders an informational
// voice chip on user messages with has_audio = true, but there's no
// transcription modal anymore — the chip is purely a marker.

test.describe('media chip rendering on user messages', () => {
  let agentId;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-audio-agent', system_prompt: '' } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('voice user message renders a chip; nothing happens on click', async ({ page }) => {
    const sid = `pw-audio-${Date.now()}`;
    const body = `pw-audio-${Date.now()}`;

    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-audio-agent', 'telegram');
      INSERT INTO session_messages (session_id, role, content, has_audio)
      VALUES ('${sid}', 'user', $$${body}$$, true);
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'assistant', 'got it');
    `);

    try {
      await page.goto('/');
      const item = page.locator('#sessions .session-item', { hasText: 'got it' });
      await expect(item).toBeVisible();
      await item.click();

      const chip = page.locator('.msg.user .media-chip').first();
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('voice message');

      // No modal exists anymore; clicking the chip should be a no-op.
      await chip.click();
      await expect(page.locator('#txOverlay')).toHaveCount(0);
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });

  test('image and video chips render alongside audio when flagged', async ({ page }) => {
    const sid = `pw-media-${Date.now()}`;
    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-audio-agent', 'telegram');
      INSERT INTO session_messages (session_id, role, content, has_audio, has_image, has_video)
      VALUES ('${sid}', 'user', 'check these out', true, true, true);
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'assistant', 'cool');
    `);

    try {
      await page.goto('/');
      const item = page.locator('#sessions .session-item', { hasText: 'cool' });
      await item.click();
      const chips = page.locator('.msg.user .media-chip');
      await expect(chips).toHaveCount(3);
      await expect(chips.nth(0)).toContainText('voice message');
      await expect(chips.nth(1)).toContainText('image');
      await expect(chips.nth(2)).toContainText('video');
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });

  test('text-only user message has no media chip', async ({ page }) => {
    const sid = `pw-noaudio-${Date.now()}`;
    const marker = `pw-noaudio-marker-${Date.now()}`;
    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-audio-agent', 'web');
      INSERT INTO session_messages (session_id, role, content) VALUES
        ('${sid}', 'user', '${marker}'),
        ('${sid}', 'assistant', 'reply');
    `);

    try {
      await page.goto('/');
      const item = page.locator('#sessions .session-item', { hasText: 'reply' });
      await item.click();
      await expect(page.locator('.msg.user', { hasText: marker })).toBeVisible();
      await expect(page.locator('.msg.user .media-chip')).toHaveCount(0);
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });
});
