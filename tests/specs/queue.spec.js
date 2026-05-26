const { test, expect } = require('@playwright/test');
const { psql, psqlQuery } = require('../helpers/db.js');

// The periodic-mode queue (queued_messages) has no HTTP API — its writes
// happen inside the Telegram bot handler and its reads happen inside the
// per-channel timer. These tests just cover the DB invariants that the
// rest of the system relies on.

test.describe('queued_messages', () => {
  let agentId;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-queue-agent', system_prompt: '' } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('rows are cascaded when the parent channel is deleted', async ({ request }) => {
    const channelName = `pw-queue-chan-${Date.now()}`;
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: channelName, config: { token: 'fake' }, response_mode: 'periodic', response_interval: '30m' },
    });
    const channelId = (await c.json()).id;

    // Seed two queued messages directly — the bot's #enqueue path is what
    // would write these in production, but we don't have a real Telegram
    // bot to drive it from a test.
    psql(`
      INSERT INTO queued_messages (channel_id, chat_id, user_id, text)
      VALUES (${channelId}, '111', '999', 'first message'),
             (${channelId}, '111', '999', 'second message');
    `);

    const before = psqlQuery(`SELECT COUNT(*)::int FROM queued_messages WHERE channel_id = ${channelId};`);
    expect(parseInt(before[0][0], 10)).toBe(2);

    const del = await request.delete(`/api/channels/${channelId}`);
    expect(del.ok()).toBeTruthy();

    const after = psqlQuery(`SELECT COUNT(*)::int FROM queued_messages WHERE channel_id = ${channelId};`);
    expect(parseInt(after[0][0], 10)).toBe(0);
  });

  test('CHECK: chat_id is NOT NULL', async ({ request }) => {
    const c = await request.post('/api/channels', {
      data: { agent_id: agentId, type: 'telegram', name: `pw-queue-chan2-${Date.now()}`, config: { token: 'fake' }, response_mode: 'periodic', response_interval: '30m' },
    });
    const channelId = (await c.json()).id;

    let threw = false;
    try {
      psql(`INSERT INTO queued_messages (channel_id, chat_id) VALUES (${channelId}, NULL);`);
    } catch (err) {
      threw = true;
      expect(String(err.message)).toMatch(/null value in column "chat_id"|violates not-null/i);
    } finally {
      await request.delete(`/api/channels/${channelId}`);
    }
    expect(threw).toBeTruthy();
  });
});
