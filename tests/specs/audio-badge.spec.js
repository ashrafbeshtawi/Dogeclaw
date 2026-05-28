const { test, expect } = require('@playwright/test');
const { psql } = require('../helpers/db.js');

// Seeds a session containing a voice message + its transcription event_log
// row, then asserts the chat UI renders a clickable voice chip that opens a
// modal containing the transcription.

test.describe('audio message rendering', () => {
  let agentId;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-audio-agent', system_prompt: '' } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('voice user message gets a chip; clicking opens the transcription modal', async ({ page }) => {
    const sid = `pw-audio-${Date.now()}`;
    const transcript = `pw-transcript-${Date.now()}`;

    const eventId = psql(`
      INSERT INTO event_logs (kind, ref_id, status, input, output, duration_ms, meta)
      VALUES ('audio_transcription', '${sid}', 'success',
              'mime=audio/ogg size~=8KB', $$${transcript}$$, 850,
              '{"mime_type":"audio/ogg"}')
      RETURNING id;
    `).trim();

    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-audio-agent', 'telegram');
      INSERT INTO session_messages (session_id, role, content, has_audio, meta)
      VALUES ('${sid}', 'user', $$${transcript}$$, true,
              '{"transcription_event_id": ${eventId}, "telegram_message_id": 42}');
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'assistant', 'got it');
    `);

    try {
      await page.goto('/');
      const item = page.locator('#sessions .session-item', { hasText: 'got it' });
      await expect(item).toBeVisible();
      await item.click();

      // Voice chip on the user message
      const chip = page.locator('.msg.user .media-chip').first();
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('voice');

      // Clicking opens the modal with the transcript
      await chip.click();
      await expect(page.locator('#txOverlay')).toHaveClass(/open/);
      await expect(page.locator('#txBody')).toContainText(transcript);
      await expect(page.locator('#txBody')).toContainText('850 ms');
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}'; DELETE FROM event_logs WHERE id = ${eventId};`);
    }
  });

  test('user message without audio has no media chip', async ({ page }) => {
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
